/**
 * 三端共享契约的 TS 侧实现 —— 对应 docs/04-interface-contracts.md §7。
 *
 * 改这里等于改三端，必须同步 `CONTRACT_VERSION`（docs/04 开头）。
 * 本文件（以及整个 core/ 目录）禁止引用任何浏览器 / 相机 / 图形 API，保证可单测、可移植。
 */

export const CONTRACT_VERSION = "0.1.0";

export type NormPoint = { x: number; y: number };
export type NormRect = { l: number; t: number; r: number; b: number };

export const rectW = (r: NormRect): number => r.r - r.l;
export const rectH = (r: NormRect): number => r.b - r.t;
export const rectArea = (r: NormRect): number => rectW(r) * rectH(r);
export const rectCenter = (r: NormRect): NormPoint => ({
  x: (r.l + r.r) / 2,
  y: (r.t + r.b) / 2,
});

/** 与 docs/03 §3 的 6 个画像一一对应；微距并入 food（主体尺度由 R3 subjectRatio 处理） */
export type SceneKind =
  | "portrait"
  | "landscape"
  | "architecture"
  | "street"
  | "food"
  | "night";

export interface DevicePose {
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
}

export interface LensInfo {
  equivFocalMm: number;
  zoomRatio: number;
  fovDeg: number;
}

export interface FaceBox {
  rect: NormRect;
  landmarks: NormPoint[];
  score: number;
  yawDeg?: number | null;
}

export interface BodyPose {
  /** 17 点，COCO 顺序 */
  keypoints: NormPoint[];
  scores: number[];
}

export interface SaliencyMap {
  w: number;
  h: number;
  /** [0,1]，行优先 */
  data: Float32Array;
}

export interface LineSeg {
  start: NormPoint;
  end: NormPoint;
  score: number;
}

export interface SceneProfile {
  topLabels: Array<[string, number]>;
  profile: SceneKind;
  confidence: number;
}

export interface LightStats {
  meanLuma: number;
  highlightClipRatio: number;
  shadowClipRatio: number;
  colorTempK: number;
  faceMeanLuma?: number;
  faceLeftRightDiff?: number;
  /** 背景/人脸亮度比 */
  backlightRatio?: number;
}

export interface DepthInfo {
  w: number;
  h: number;
  data: Float32Array;
  isMetric: boolean;
}

export interface PerceptionFrame {
  /** 采集时刻（不是推理完成时刻），单调时钟纳秒：Web = performance.now() * 1e6 */
  tsNs: number;
  contractVersion: string;
  frameSize: { w: number; h: number };
  devicePose: DevicePose;
  lens: LensInfo;
  faces: FaceBox[];
  pose?: BodyPose;
  saliency?: SaliencyMap;
  lines: LineSeg[];
  scene: SceneProfile;
  light: LightStats;
  depth?: DepthInfo | null;
  /** 慢通路数据的新鲜度 */
  staleMs?: number;
}

/** 规则层（docs/04 §4）—— R 编号与 docs/03 §2 一一对应 */
export interface RuleResult {
  ruleId: string;
  /** [0,1] */
  score: number;
  /** 来自场景画像（docs/03 §3 权重表） */
  weight: number;
}

/**
 * 三分构图几何常量（docs/03 R1）
 * 归一化坐标 [0,1]，原点左上；像素换算只允许发生在渲染层。
 */
export const THIRD_VALUES: readonly number[] = [1 / 3, 2 / 3];
export const THIRD_POINTS: readonly NormPoint[] = [
  { x: 1 / 3, y: 1 / 3 },
  { x: 2 / 3, y: 1 / 3 },
  { x: 1 / 3, y: 2 / 3 },
  { x: 2 / 3, y: 2 / 3 },
];
