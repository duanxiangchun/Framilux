import type { BodyPose, DevicePose, FaceBox, PerceptionFrame, SceneKind, SceneProfile } from "../core/contracts";
import { CONTRACT_VERSION } from "../core/contracts";
import { LightStatsPerceptor } from "./light-stats";
import { MediaPipePerceptor, type PerceptionCapabilities, type PerceptorTiming } from "./mediapipe-perceptor";

export interface BusInitResult {
  capabilities: PerceptionCapabilities;
  errors: string[];
}

/**
 * L2 感知总线：一帧视频 → 一个 PerceptionFrame（归一化坐标 + 采集时刻时间戳）。
 *
 * 串行执行（face → pose → light），因为 docs/01 §5 规定推理走单一队列保证延迟可预测；
 * 调用方是 FrameGate，它保证同一时刻只有一帧在处理。
 */
export class PerceptionBus {
  private mp: MediaPipePerceptor | null = null;
  private readonly light = new LightStatsPerceptor();
  private timings: PerceptorTiming[] = [];
  private lastTsMs = -1;
  private profileOverride: SceneKind | null = null;

  async init(): Promise<BusInitResult> {
    this.mp = await MediaPipePerceptor.create();
    return { capabilities: this.mp.capabilities, errors: this.mp.capabilities.errors };
  }

  get capabilities(): PerceptionCapabilities | null {
    return this.mp?.capabilities ?? null;
  }

  get lastTimings(): PerceptorTiming[] {
    return this.timings;
  }

  setProfileOverride(kind: SceneKind | null): void {
    this.profileOverride = kind;
  }

  get profileOverrideKind(): SceneKind | null {
    return this.profileOverride;
  }

  analyze(
    video: HTMLVideoElement,
    captureTsNs: number,
    devicePose: DevicePose,
    frameSize: { w: number; h: number },
  ): PerceptionFrame {
    const tAll = performance.now();

    // MediaPipe 要求毫秒整数且严格递增，同毫秒重复会直接抛错
    let tsMs = Math.round(captureTsNs / 1e6);
    if (tsMs <= this.lastTsMs) tsMs = this.lastTsMs + 1;
    this.lastTsMs = tsMs;

    const { faces, pose, timings } = this.mp
      ? this.mp.analyze(video, tsMs)
      : { faces: [] as FaceBox[], pose: null as BodyPose | null, timings: [{ id: "face", ms: 0, ok: false, note: "感知层未初始化" }] as PerceptorTiming[] };

    const tLight = performance.now();
    const { light, saliency } = this.light.measure(video, faces);
    const lightMs = performance.now() - tLight;

    this.timings = [
      ...timings,
      { id: "light", ms: lightMs, ok: true, note: "160×90 直方图 + 块梯度显著图（降级）" },
      { id: "total", ms: performance.now() - tAll, ok: true, note: "感知合计" },
    ];

    return {
      tsNs: captureTsNs,
      contractVersion: CONTRACT_VERSION,
      frameSize: { w: frameSize.w, h: frameSize.h },
      devicePose: { ...devicePose },
      lens: { equivFocalMm: 26, zoomRatio: 1, fovDeg: 70 },
      faces,
      pose: pose ?? undefined,
      saliency,
      lines: [],
      scene: this.inferScene(faces.length > 0 || pose != null),
      light,
    };
  }

  /**
   * M1 的场景画像只是占位启发式：有主体就当人像，否则风景。
   * Places365 在 M3 接入（docs/05），届时替换成「场景标签 + 光照统计」的融合（docs/03 §3 待办）。
   */
  private inferScene(hasSubject: boolean): SceneProfile {
    if (this.profileOverride) {
      return { profile: this.profileOverride, confidence: 1, topLabels: [["manual", 1]] };
    }
    return hasSubject
      ? { profile: "portrait", confidence: 0.4, topLabels: [["subject", 0.4]] }
      : { profile: "landscape", confidence: 0.3, topLabels: [] };
  }
}
