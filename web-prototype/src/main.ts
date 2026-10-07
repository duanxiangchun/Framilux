/**
 * Framilux Web 原型入口（M1 步骤 1–2）
 *
 * 数据流（docs/01 §3 的 Web 等价物）：
 *   getUserMedia 取流(CameraSource/L0)
 *     → rAF 驱动 FrameGate 节流到 10 fps / 忙时丢帧(L1)
 *       → 渲染层画三分线 + debug HUD(L4)
 *
 * 后续步骤往这条链路里插：MediaPipe 感知(L2) → core-composition 规则(L3) → 引导叠加。
 */

import "./styles.css";
import { CameraSource, CameraError, type FacingMode } from "./capture/CameraSource";
import { FrameGate, type FrameGateStats } from "./capture/FrameGate";
import { OverlayRenderer } from "./render/OverlayRenderer";

/** Fast 通路帧率（docs/01 §4）：实时引导 10 fps */
const CAPTURE_TARGET_FPS = 10;

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html 缺少 #${id} 元素`);
  return el as T;
}

const stage = requireEl<HTMLDivElement>("stage");
const video = requireEl<HTMLVideoElement>("video");
const canvas = requireEl<HTMLCanvasElement>("overlay");
const hint = requireEl<HTMLDivElement>("hint");
const hintText = requireEl<HTMLParagraphElement>("hint-text");
const btnRetry = requireEl<HTMLButtonElement>("btn-retry");
const btnSwitch = requireEl<HTMLButtonElement>("btn-switch");
const btnGrid = requireEl<HTMLButtonElement>("btn-grid");
const btnHud = requireEl<HTMLButtonElement>("btn-hud");
const selFps = requireEl<HTMLSelectElement>("sel-fps");

const gate = new FrameGate({ targetFps: CAPTURE_TARGET_FPS });
const renderer = new OverlayRenderer(canvas, { showGrid: true, showHud: true });
const camera = new CameraSource(video);

let facing: FacingMode = "user";
let started = false;
let rafId = 0;

function syncCanvasSize(): void {
  const rect = stage.getBoundingClientRect();
  renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
}

function sourceText(): string {
  const info = camera.info;
  if (!info) return "未连接";
  const side = info.facingMode === "user" ? "前置" : "后置";
  const fps = info.frameRate > 0 ? ` @${info.frameRate}fps` : "";
  return `${info.width}×${info.height}${fps} · ${side}`;
}

function renderNow(): void {
  renderer.render({
    videoW: video.videoWidth,
    videoH: video.videoHeight,
    captureTsNs: camera.captureTsNs,
    hasFrameTiming: camera.hasFrameTiming,
    mirrored: facing === "user",
    gate: gate.stats(),
    sourceText: sourceText(),
    online: navigator.onLine,
  });
}

function frame(nowMs: number): void {
  rafId = requestAnimationFrame(frame);
  if (!started) return;
  // 闸门在"上一帧仍处理中"时直接丢帧：永远算最新的一帧，不做队列堆积
  gate.run(nowMs, renderNow).catch((err: unknown) => {
    console.error("[framilux] 帧处理失败", err);
  });
}

function showHint(message: string): void {
  hintText.textContent = message;
  hint.hidden = false;
}

function hideHint(): void {
  hint.hidden = true;
}

function applyMirror(): void {
  video.classList.toggle("mirrored", facing === "user");
}

async function startCamera(): Promise<void> {
  hideHint();
  btnSwitch.disabled = true;
  try {
    await camera.start({ facingMode: facing, width: 1280, height: 720, frameRate: 30 });
    gate.reset();
    applyMirror();
    syncCanvasSize();
    started = true;
    if (rafId === 0) rafId = requestAnimationFrame(frame);
  } catch (err) {
    started = false;
    const msg =
      err instanceof CameraError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    showHint(msg);
    video.srcObject = null;
  } finally {
    btnSwitch.disabled = false;
  }
}

function stopCamera(): void {
  started = false;
  camera.stop();
}

btnRetry.addEventListener("click", () => {
  void startCamera();
});

btnSwitch.addEventListener("click", () => {
  facing = facing === "user" ? "environment" : "user";
  stopCamera();
  void startCamera();
});

btnGrid.addEventListener("click", () => {
  renderer.showGrid = !renderer.showGrid;
  btnGrid.setAttribute("aria-pressed", String(renderer.showGrid));
});

btnHud.addEventListener("click", () => {
  renderer.showHud = !renderer.showHud;
  btnHud.setAttribute("aria-pressed", String(renderer.showHud));
});

selFps.addEventListener("change", () => {
  gate.setTargetFps(Number(selFps.value));
});

if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(syncCanvasSize).observe(stage);
}
window.addEventListener("resize", syncCanvasSize);

document.addEventListener("visibilitychange", () => {
  // 切后台时 rAF 会自动停；回前台把闸门间隔重置，避免拿旧时间戳判断
  if (!document.hidden) gate.reset();
});

window.framilux = {
  gate,
  camera,
  renderer,
  gateStats: (): FrameGateStats => gate.stats(),
};

declare global {
  interface Window {
    /** 供浏览器控制台调参用（M1 步骤 7 会把同样的数字做成 debug 面板） */
    framilux?: {
      gate: FrameGate;
      camera: CameraSource;
      renderer: OverlayRenderer;
      gateStats: () => FrameGateStats;
    };
  }
}

syncCanvasSize();
renderNow();
void startCamera();
