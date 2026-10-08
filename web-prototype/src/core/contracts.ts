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
  /** 姿态来源：桌面浏览器常无传感器，此时 source="none"，依赖它的规则权重置 0（docs/04 §8） */
  source?: "imu" | "none";
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

/* ============================================================================
 * 决策层契约（docs/04 §4）—— 纯逻辑，禁止引用任何浏览器 / 相机 / 图形 API
 * ========================================================================== */

/** 规则编号与 docs/03 §2 的 R 编号一一对应 */
export type RuleId = string;

export type Dir = "left" | "right" | "up" | "down";

export type GuidanceAction =
  | { kind: "pan"; dir: "left" | "right"; magnitude: number }
  | { kind: "tilt"; dir: "up" | "down"; magnitude: number }
  | { kind: "zoom"; dir: "in" | "out"; magnitude: number }
  | { kind: "roll"; deg: number }
  | { kind: "subject"; magnitude: number } // "找主体"
  | { kind: "hold" };

/** 文案一律走 textKey + 本地化资源，禁止在规则里硬编码中文（docs/06 §4） */
export interface Advice {
  /** 越小越优先：水平=10 / 光=20 / 位置=30 / 占比留白=40 / 风格=50 */
  priority: number;
  textKey: string;
  args: Record<string, number>;
  action: GuidanceAction;
}

export interface RuleResult {
  ruleId: RuleId;
  /** [0,1]，1 = 最理想 */
  score: number;
  /** 实际参与加权的权重（可能被规则内部降档或置 0） */
  weight: number;
  advice?: Advice | null;
  /** 模型/传感器缺失时为 false —— 权重记 0 并在 debug 面板标红，不崩溃（docs/04 §8） */
  available: boolean;
  /** 供 debug 面板展示的关键中间量，例如 "d=0.213 · 中心构图豁免" */
  detail?: string;
}

export interface CompositionRule {
  id: RuleId;
  /** docs/03 的 R 编号，便于 debug 面板与文档对照 */
  title: string;
  evaluate(f: PerceptionFrame, weights: SceneWeights): RuleResult;
}

export interface ScoreBreakdown {
  /** Σw·f / Σw */
  total01: number;
  /** 1..5，映射公式见 docs/03 §4 */
  display: number;
  perRule: Map<RuleId, RuleResult>;
  /** 参与计算的有效权重和（0 表示全部规则不可用） */
  weightSum: number;
}

export interface Arrow {
  /** 归一化位移方向与幅度（未做离散化，用于渲染箭头长度） */
  dx: number;
  dy: number;
}

export interface Guidance {
  total01: number;
  displayScore: number;
  mainAdvice: Advice | null;
  /** 主建议来自哪条规则（可空：找主体 / 可以拍了 这类由求解器直接给的提示） */
  mainRuleId: string | null;
  subjectBox: NormRect | null;
  /** 建议主体位置（虚影框） */
  targetBox: NormRect | null;
  arrow: Arrow | null;
  horizonTiltDeg: number | null;
  zoomHint: "in" | "out" | "ok";
  /** 构图已经很好（可提示"可以拍了"） */
  ready: boolean;
}

/** 平滑后发布给 UI 的不可变快照（docs/01 §7） */
export interface GuidanceSnapshot {
  tsNs: number;
  displayScore: number;
  total01: number;
  mainAdvice: Advice | null;
  mainRuleId: string | null;
  subjectBox: NormRect | null;
  targetBox: NormRect | null;
  arrow: Arrow | null;
  horizonTiltDeg: number | null;
  zoomHint: "in" | "out" | "ok";
  ready: boolean;
  perRule: RuleResult[];
  /** 平滑前的原始值，供 debug 对比 */
  raw: Guidance;
}

export interface SmoothConfig {
  emaAlpha: number;
  switchMargin: number;
  minAdviceMs: number;
  readyHoldMs: number;
  readyThreshold: number;
  staleFrameMs: number;
}

export const DEFAULT_SMOOTH_CONFIG: SmoothConfig = {
  emaAlpha: 0.35,
  switchMargin: 0.08,
  minAdviceMs: 1200,
  readyHoldMs: 1500,
  readyThreshold: 4.2,
  staleFrameMs: 200,
};

/* ============================================================================
 * 场景画像权重（docs/03 §3）—— 全项目唯一可调参数集中地
 * ========================================================================== */

export type SceneWeights = Record<string, number>;

export interface SubjectRatioTarget {
  r: number;
  sigma: number;
}
