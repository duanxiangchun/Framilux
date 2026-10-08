import type { SceneKind, SceneWeights, SubjectRatioTarget } from "./contracts";

/**
 * 场景画像权重表 —— 全项目**唯一**可调参数集中地（docs/03 §3）。
 * 禁止任何规则实现里写死权重；调参只改这张表或 debug 面板的滑块。
 */
export const SCENE_WEIGHTS: Record<SceneKind, SceneWeights> = {
  portrait: {
    thirds: 0.8, horizon: 1.0, subjectRatio: 1.0, headroom: 1.2, leadRoom: 1.0, balance: 0.7,
    leadingLines: 0.4, symmetry: 0.3, lighting: 1.3, exposure: 1.2, clipping: 0.8, pose: 1.1,
  },
  landscape: {
    thirds: 1.0, horizon: 1.2, subjectRatio: 0.7, headroom: 0.2, leadRoom: 0.3, balance: 0.9,
    leadingLines: 0.9, symmetry: 0.5, lighting: 1.0, exposure: 1.0, clipping: 0.9, pose: 0.0,
  },
  architecture: {
    thirds: 0.9, horizon: 1.0, subjectRatio: 0.8, headroom: 0.2, leadRoom: 0.2, balance: 1.0,
    leadingLines: 1.1, symmetry: 1.2, lighting: 0.7, exposure: 0.9, clipping: 0.8, pose: 0.0,
  },
  street: {
    thirds: 1.0, horizon: 0.8, subjectRatio: 0.6, headroom: 0.6, leadRoom: 0.9, balance: 0.8,
    leadingLines: 1.0, symmetry: 0.3, lighting: 0.9, exposure: 1.0, clipping: 0.8, pose: 0.4,
  },
  food: {
    thirds: 0.9, horizon: 0.3, subjectRatio: 1.1, headroom: 0.3, leadRoom: 0.2, balance: 0.8,
    leadingLines: 0.3, symmetry: 0.4, lighting: 1.0, exposure: 1.1, clipping: 0.8, pose: 0.0,
  },
  night: {
    thirds: 0.8, horizon: 0.9, subjectRatio: 0.7, headroom: 0.4, leadRoom: 0.4, balance: 0.7,
    leadingLines: 0.6, symmetry: 0.4, lighting: 1.2, exposure: 1.3, clipping: 1.0, pose: 0.2,
  },
};

export const DEFAULT_SCENE_KIND: SceneKind = "portrait";

export const SCENE_KIND_LABEL: Record<SceneKind, string> = {
  portrait: "人像",
  landscape: "风景",
  architecture: "建筑",
  street: "街拍",
  food: "美食静物",
  night: "夜景",
};

/** 深拷贝一份权重，避免 debug 面板改滑块时污染常量表 */
export function weightsFor(kind: SceneKind): SceneWeights {
  return { ...SCENE_WEIGHTS[kind] };
}

export function cloneWeights(w: SceneWeights): SceneWeights {
  return { ...w };
}

export const SCENE_KINDS = Object.keys(SCENE_WEIGHTS) as SceneKind[];

/**
 * R3 主体占比的理想值与容差（docs/03 R3）。
 * 人像/风景/建筑/美食四项来自 docs/03；街拍与夜景 docs/03 未给，此处为 **M1 初值，待 M5 校准**。
 */
export const SUBJECT_RATIO_TARGET: Record<SceneKind, SubjectRatioTarget> = {
  portrait: { r: 0.18, sigma: 0.1 },
  landscape: { r: 0.06, sigma: 0.05 },
  architecture: { r: 0.14, sigma: 0.09 },
  street: { r: 0.12, sigma: 0.08 },
  food: { r: 0.3, sigma: 0.12 },
  night: { r: 0.1, sigma: 0.08 },
};

/** M1 已实现的规则（docs/05 M1：R1–R6、R10、R11）；其余为 null 表示未实现，不参与打分 */
export const IMPLEMENTED_RULES = [
  "thirds",
  "horizon",
  "subjectRatio",
  "headroom",
  "leadRoom",
  "balance",
  "exposure",
  "clipping",
] as const;

/** docs/03 §3 表里存在、但 M1 尚未实现的规则（debug 面板灰显，避免误以为在算） */
export const UNIMPLEMENTED_RULES: Record<string, string> = {
  leadingLines: "R7 引导线（M3，需 M-LSD）",
  symmetry: "R8 对称（M3）",
  lighting: "R9 光位（M4，需法线/分区亮度）",
  pose: "R12 姿态（M4，需 RTMPose）",
};
