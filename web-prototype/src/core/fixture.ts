import type { FaceBox, NormRect, PerceptionFrame, SaliencyMap, SceneKind } from "./contracts";
import { CONTRACT_VERSION } from "./contracts";

/**
 * 固定输入的构造器：单测、回归对比、debug 面板的「注入模拟帧」都用它，
 * 保证 Android / Web 两端实现能对同一组输入比结果（docs/04 §7）。
 */
export function makeFrame(patch: Partial<PerceptionFrame> = {}): PerceptionFrame {
  return {
    tsNs: 1_000_000_000,
    contractVersion: CONTRACT_VERSION,
    frameSize: { w: 1280, h: 720 },
    devicePose: { rollDeg: 0, pitchDeg: 0, yawDeg: 0, source: "imu" },
    lens: { equivFocalMm: 26, zoomRatio: 1, fovDeg: 70 },
    faces: [],
    lines: [],
    scene: { topLabels: [], profile: "portrait", confidence: 0.5 },
    light: { meanLuma: 0.5, highlightClipRatio: 0, shadowClipRatio: 0, colorTempK: 5500 },
    ...patch,
  };
}

export function face(rect: NormRect, yawDeg: number | null = null, score = 0.9): FaceBox {
  return { rect, landmarks: [], score, yawDeg };
}

export const NO_IMU = { rollDeg: 0, pitchDeg: 0, yawDeg: 0, source: "none" } as const;

export function scene(profile: SceneKind): PerceptionFrame["scene"] {
  return { topLabels: [], profile, confidence: 0.5 };
}

/** 4×4 显著图，全部质量集中在一个格子上 */
export function saliencyAt(cx: number, cy: number): SaliencyMap {
  const w = 4;
  const h = 4;
  const data = new Float32Array(w * h);
  data[cy * w + cx] = 1;
  return { w, h, data };
}

/** 均匀显著图（质心在画面正中） */
export function saliencyFlat(w = 8, h = 8): SaliencyMap {
  return { w, h, data: new Float32Array(w * h).fill(1) };
}

/** 中心精确落在 (1/3, 1/3) 的框 */
/** debug 面板「注入模拟帧」用的一帧：人像、侧脸朝右、主体偏小偏左上（典型待纠正构图） */
export function fixtureFrame(): PerceptionFrame {
  return makeFrame({
    devicePose: { rollDeg: 2.5, pitchDeg: 0, yawDeg: 0, source: "imu" },
    faces: [face({ l: 0.22, t: 0.16, r: 0.4, b: 0.44 }, 28)],
    scene: scene("portrait"),
    light: { meanLuma: 0.45, highlightClipRatio: 0.012, shadowClipRatio: 0.02, colorTempK: 5200, faceMeanLuma: 0.5, backlightRatio: 1.2 },
    saliency: saliencyAt(1, 1),
  });
}

export const THIRD_BOX: NormRect = { l: 1 / 3 - 1 / 12, t: 1 / 3 - 1 / 12, r: 1 / 3 + 1 / 12, b: 1 / 3 + 1 / 12 };
export const CENTER_BOX: NormRect = { l: 0.4, t: 0.4, r: 0.6, b: 0.6 };