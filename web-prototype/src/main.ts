/**
 * Framilux Web 原型入口（M1 完整链路）
 *
 *   CameraSource(L0) → FrameGate(10fps/丢帧, L1) → MediaPipe 人脸+姿态 + 光照统计(L2)
 *     → CompositionPipeline：R1–R6/R10/R11 打分 + 引导求解 + 平滑迟滞(L3)
 *       → OverlayRenderer 60fps 读快照画叠加层(L4) + DebugPanel(L5)
 *
 * 离线红线：本文件与整个 src/ 不发起任何网络请求；wasm 与模型都是本地文件。
 */

import "./styles.css";
import { CameraSource, CameraError, type FacingMode } from "./capture/CameraSource";
import { FrameGate } from "./capture/FrameGate";
import type { PerceptionFrame, SceneKind, SceneWeights } from "./core/contracts";
import { fixtureFrame } from "./core/fixture";
import { CompositionPipeline } from "./core/pipeline";
import { DEFAULT_SCENE_KIND, weightsFor } from "./core/scene-weights";
import { isStaleFrame } from "./core/smoother";
import { renderAdviceText } from "./core/texts";
import { DevicePoseSource } from "./perception/device-pose";
import { PerceptionBus } from "./perception/perception-bus";
import { DEFAULT_LAYERS, OverlayRenderer, type LayerToggles } from "./render/OverlayRenderer";
import { DebugPanel } from "./ui/debug-panel";

/** Fast 通路帧率（docs/01 §4）：实时引导 10 fps */
const CAPTURE_TARGET_FPS = 10;

function requireEl<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("index.html 缺少 #" + id + " 元素");
  return node as T;
}

const stage = requireEl<HTMLDivElement>("stage");
const video = requireEl<HTMLVideoElement>("video");
const canvas = requireEl<HTMLCanvasElement>("overlay");
const panelRoot = requireEl<HTMLElement>("panel");
const hint = requireEl<HTMLDivElement>("hint");
const hintText = requireEl<HTMLParagraphElement>("hint-text");
const btnRetry = requireEl<HTMLButtonElement>("btn-retry");
const btnSwitch = requireEl<HTMLButtonElement>("btn-switch");
const btnPanel = requireEl<HTMLButtonElement>("btn-panel");
const selFps = requireEl<HTMLSelectElement>("sel-fps");

const gate = new FrameGate({ targetFps: CAPTURE_TARGET_FPS });
const renderer = new OverlayRenderer(canvas);
const camera = new CameraSource(video);
const devicePose = new DevicePoseSource();
const bus = new PerceptionBus();
const pipeline = new CompositionPipeline();

let layers: LayerToggles = { ...DEFAULT_LAYERS };
let facing: FacingMode = "user";
let started = false;
let paused = false;
let rafId = 0;
let lastSnapshot: ReturnType<CompositionPipeline["process"]>["snapshot"] | null = null;
let lastAdviceText = "";
let latencyMs: number | null = null;
let injected = false;

function sourceText(): string {
  if (injected) return "模拟帧（不依赖摄像头）";
  const info = camera.info;
  if (!info) return "未连接";
  const side = info.facingMode === "user" ? "前置" : "后置";
  const fps = info.frameRate > 0 ? " @" + info.frameRate + "fps" : "";
  return info.width + "×" + info.height + fps + " · " + side;
}

function buildStatus() {
  const stats = gate.stats();
  return {
    snapshot: lastSnapshot,
    adviceText: lastAdviceText,
    timings: bus.lastTimings,
    capabilities: bus.capabilities,
    gate: {
      targetFps: stats.targetFps,
      effectiveFps: stats.effectiveFps,
      seen: stats.seen,
      processed: stats.processed,
      droppedThrottle: stats.droppedByThrottle,
      droppedBusy: stats.droppedWhileBusy,
      lastProcessMs: stats.lastProcessMs,
    },
    latencyMs,
    source: sourceText(),
    online: navigator.onLine,
    saliencyDegraded: true,
  };
}

const panel = new DebugPanel(panelRoot, layers, {
  onWeightsChange: (weights: SceneWeights) => pipeline.setWeights(weights),
  onProfileChange: (kind: SceneKind | null) => bus.setProfileOverride(kind),
  onLayersChange: (next: LayerToggles) => {
    layers = next;
  },
  onPauseChange: (value: boolean) => {
    paused = value;
  },
  onInjectFixture: () => {
    injected = true;
    // 清空平滑器状态：否则上一帧的"最短展示时长"会把新建议压住，看起来像规则没生效
    pipeline.reset();
    latencyMs = null;
  },
  onEnableOrientation: () => {
    void (async () => {
      const granted = await DevicePoseSource.requestPermission();
      if (!granted) {
        showHint("水平仪权限被拒绝：R2 水平规则将不参与打分（桌面浏览器通常没有该传感器）。");
        return;
      }
      devicePose.start();
      hideHint();
    })();
  },
});

function syncCanvasSize(): void {
  const rect = stage.getBoundingClientRect();
  renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
}

function showHint(message: string): void {
  hintText.textContent = message;
  hint.hidden = false;
}

function hideHint(): void {
  hint.hidden = true;
}

async function startCamera(): Promise<void> {
  hideHint();
  btnSwitch.disabled = true;
  try {
    await camera.start({ facingMode: facing, width: 1280, height: 720, frameRate: 30 });
    gate.reset();
    pipeline.reset();
    video.classList.toggle("mirrored", facing === "user");
    syncCanvasSize();
    started = true;
    injected = false;
    if (rafId === 0) rafId = requestAnimationFrame(loop);
  } catch (err) {
    started = false;
    const msg = err instanceof CameraError ? err.message : err instanceof Error ? err.message : String(err);
    showHint(msg + " 没有摄像头也可以点右侧「注入模拟帧」，用固定特征查看规则与叠加层效果。");
    if (rafId === 0) rafId = requestAnimationFrame(loop);
  } finally {
    btnSwitch.disabled = false;
  }
}

function analyzeFrame(): void {
  // 模拟模式：没有摄像头也能按 10fps 反复喂同一组固定特征，
  // 这样权重滑块、场景画像、平滑迟滞都能立刻看到效果。
  if (injected) {
    const f = fixtureFrame();
    f.tsNs = Math.round(performance.now() * 1e6); // 时间戳必须推进，否则迟滞永不切换
    const { snapshot } = pipeline.process(f);
    lastSnapshot = snapshot;
    lastAdviceText = renderAdviceText(snapshot.mainAdvice);
    return;
  }
  if (!started) return;
  const captureTsNs = camera.captureTsNs;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w <= 0 || h <= 0) return;
  // 超过 200ms 的旧帧不参与融合（docs/04 §2）
  if (isStaleFrame(captureTsNs, performance.now() * 1e6)) return;
  latencyMs = performance.now() - captureTsNs / 1e6;

  const frame: PerceptionFrame = bus.analyze(video, captureTsNs, devicePose.current, { w, h });
  const { snapshot } = pipeline.process(frame);
  lastSnapshot = snapshot;
  lastAdviceText = renderAdviceText(snapshot.mainAdvice);
}

/** 渲染与推理解耦：60fps 读最新快照（docs/01 §3） */
function loop(): void {
  rafId = requestAnimationFrame(loop);
  renderer.render({
    videoW: video.videoWidth,
    videoH: video.videoHeight,
    mirrored: facing === "user" && started,
    snapshot: lastSnapshot,
    adviceText: lastAdviceText,
    layers,
  });
  if (!paused) {
    gate.run(performance.now(), analyzeFrame).catch((err: unknown) => {
      console.error("[framilux] 帧处理失败", err);
    });
    panel.update(buildStatus());
  }
}

btnRetry.addEventListener("click", () => void startCamera());
btnSwitch.addEventListener("click", () => {
  facing = facing === "user" ? "environment" : "user";
  started = false;
  camera.stop();
  void startCamera();
});
btnPanel.addEventListener("click", () => {
  const hidden = document.body.classList.toggle("panel-hidden");
  btnPanel.setAttribute("aria-pressed", String(!hidden));
});
selFps.addEventListener("change", () => gate.setTargetFps(Number(selFps.value)));

if (typeof ResizeObserver !== "undefined") new ResizeObserver(syncCanvasSize).observe(stage);
window.addEventListener("resize", syncCanvasSize);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) gate.reset();
});

declare global {
  interface Window {
    /** 控制台逃生口：window.framilux.pipeline.setWeights({...}) 之类 */
    framilux?: {
      gate: FrameGate;
      camera: CameraSource;
      renderer: OverlayRenderer;
      pipeline: CompositionPipeline;
      bus: PerceptionBus;
      panel: DebugPanel;
    };
  }
}

window.framilux = { gate, camera, renderer, pipeline, bus, panel };

async function boot(): Promise<void> {
  syncCanvasSize();
  pipeline.setWeights(weightsFor(DEFAULT_SCENE_KIND));
  const init = await bus.init();
  panel.setCapabilities(init.capabilities);
  if (init.capabilities.errors.length > 0) console.warn("[framilux] 感知层初始化告警", init.capabilities.errors);
  if (!init.capabilities.face) {
    showHint("感知模型未就绪：先在 web-prototype 下跑 pnpm assets 拉取本地 wasm 与 .task 模型。");
  }
  await startCamera();
}

void boot();
