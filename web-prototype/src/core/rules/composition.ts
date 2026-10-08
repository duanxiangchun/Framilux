import type { Advice, CompositionRule, PerceptionFrame, RuleResult, SceneWeights } from "../contracts";
import { clamp01, frameAspect, gaussianScore, normDistance } from "../math";
import { SUBJECT_RATIO_TARGET } from "../scene-weights";
import { discretizePan, nearestThirdPoint, thirdsDistance } from "./geometry";
import { rectArea, rectCenter, saliencyCentroid } from "./rect-utils";
import { findSubject, type Subject } from "./subject";

function unavailable(id: string, detail: string): RuleResult {
  return { ruleId: id, score: 0, weight: 0, advice: null, available: false, detail };
}

/** 位置类建议（优先级 30：位置） */
function positionAdvice(
  move: { dir: "left" | "right" | "up" | "down"; magnitude: number },
  priority: number,
): Advice {
  const textKey =
    move.dir === "left"
      ? "advice.pan.left"
      : move.dir === "right"
        ? "advice.pan.right"
        : move.dir === "up"
          ? "advice.tilt.up"
          : "advice.tilt.down";
  const action: Advice["action"] =
    move.dir === "left" || move.dir === "right"
      ? { kind: "pan", dir: move.dir, magnitude: move.magnitude }
      : { kind: "tilt", dir: move.dir, magnitude: move.magnitude };
  return { priority, textKey, args: { magnitude: move.magnitude }, action };
}

function largestFace(f: PerceptionFrame) {
  let best = null as null | PerceptionFrame["faces"][number];
  for (const face of f.faces) {
    if (!best || rectArea(face.rect) > rectArea(best.rect)) best = face;
  }
  return best;
}

/* ------------------------------- R1 三分点对齐 ------------------------------ */
export const thirdsRule: CompositionRule = {
  id: "thirds",
  title: "R1 三分点对齐",
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult {
    const subject = findSubject(f);
    if (!subject) return unavailable("thirds", "无主体（人脸 / 人体 / 显著图均缺失）");
    const aspect = frameAspect(f);
    const c = rectCenter(subject.rect);
    const d = thirdsDistance(subject.rect, aspect);

    let score = clamp01(1 - d / 0.18);
    let detail = `主体=${subject.source} d=${d.toFixed(3)}`;
    // 中心构图是有效替代解（docs/03 R1）
    if (normDistance(c, { x: 0.5, y: 0.5 }, aspect) < 0.06) {
      score = Math.max(score, 0.85);
      detail += " · 中心构图豁免";
    }

    const target = nearestThirdPoint(c, aspect);
    const move = discretizePan(target.x - c.x, target.y - c.y);
    const advice = d > 0.18 && move ? positionAdvice(move, 30) : null;
    return { ruleId: "thirds", score, weight: w.thirds ?? 0, available: true, detail, advice };
  },
};

/* ------------------------------- R3 主体占比 -------------------------------- */
export const subjectRatioRule: CompositionRule = {
  id: "subjectRatio",
  title: "R3 主体占比",
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult {
    const subject = findSubject(f);
    if (!subject) return unavailable("subjectRatio", "无主体，无法算占比");
    const target = SUBJECT_RATIO_TARGET[f.scene.profile] ?? SUBJECT_RATIO_TARGET.portrait;
    const r = rectArea(subject.rect);
    const score = gaussianScore(r, target.r, target.sigma);
    const delta = r - target.r;

    let advice: Advice | null = null;
    if (Math.abs(delta) > target.sigma) {
      const dir = delta < 0 ? "in" : "out";
      advice = {
        priority: 40,
        textKey: dir === "in" ? "advice.zoom.in" : "advice.zoom.out",
        args: { ratio: r, target: target.r },
        action: { kind: "zoom", dir, magnitude: Math.abs(delta) },
      };
    }
    return {
      ruleId: "subjectRatio",
      score,
      weight: w.subjectRatio ?? 0,
      available: true,
      advice,
      detail: `r=${r.toFixed(3)} 目标=${target.r}±${target.sigma}（${f.scene.profile}）`,
    };
  },
};

/* ------------------------------- R4 头顶留白 -------------------------------- */
export const headroomRule: CompositionRule = {
  id: "headroom",
  title: "R4 头顶留白",
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult {
    const face = largestFace(f);
    if (!face) return unavailable("headroom", "无人脸，留白规则不适用");
    const h = face.rect.t;

    let score: number;
    if (h >= 0.05 && h <= 0.12) score = 1;
    else if (h < 0.05) score = clamp01(1 - (0.05 - h) / 0.05);
    else score = clamp01(1 - (h - 0.12) / 0.25);

    let advice: Advice | null = null;
    if (h < 0.05) {
      advice = {
        priority: 40,
        textKey: "advice.headroom.low",
        args: { headroom: h },
        action: { kind: "tilt", dir: "up", magnitude: 0.05 - h },
      };
    } else if (h > 0.18) {
      advice = {
        priority: 40,
        textKey: "advice.headroom.high",
        args: { headroom: h },
        action: { kind: "tilt", dir: "down", magnitude: h - 0.12 },
      };
    }
    return {
      ruleId: "headroom",
      score,
      weight: w.headroom ?? 0,
      available: true,
      advice,
      detail: `h=${h.toFixed(3)} 理想 [0.05, 0.12]`,
    };
  },
};

/* ------------------------------- R5 朝向留白 -------------------------------- */
export type Facing = "left" | "right" | "front";

/**
 * 朝向估计：优先用人脸 yaw（MediaPipe 变换矩阵解析）；
 * 退化用姿态"鼻子相对双肩中点"的偏移（COCO-17: 0=鼻, 5/6=肩）。
 * 这是 M1 的粗略估计，debug 面板会显示具体数值，便于后续替换。
 */
export function estimateFacing(f: PerceptionFrame): { dir: Facing; source: string; value: number } | null {
  const face = largestFace(f);
  if (face && typeof face.yawDeg === "number" && Number.isFinite(face.yawDeg)) {
    const yaw = face.yawDeg;
    return { dir: Math.abs(yaw) < 12 ? "front" : yaw > 0 ? "right" : "left", source: "face.yaw", value: yaw };
  }
  const kp = f.pose?.keypoints;
  if (kp && kp.length >= 7) {
    const nose = kp[0];
    const ls = kp[5];
    const rs = kp[6];
    const mid = (ls.x + rs.x) / 2;
    const shoulderW = Math.abs(rs.x - ls.x);
    const rel = (nose.x - mid) / Math.max(shoulderW, 1e-3);
    return { dir: Math.abs(rel) < 0.12 ? "front" : rel < 0 ? "left" : "right", source: "pose.nose", value: rel };
  }
  return null;
}

export const leadRoomRule: CompositionRule = {
  id: "leadRoom",
  title: "R5 朝向留白",
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult {
    const facing = estimateFacing(f);
    const subject: Subject | null = findSubject(f);
    if (!facing || !subject) return unavailable("leadRoom", "无法判断朝向（无人脸 yaw 也无姿态）");

    const isFront = facing.dir === "front";
    const rect = subject.rect;
    const front = facing.dir === "right" ? 1 - rect.r : rect.l;
    const back = facing.dir === "right" ? rect.l : 1 - rect.r;
    const score = clamp01((front - back) / 0.25);

    const weight = (w.leadRoom ?? 0) * (isFront ? 0.2 : 1); // 正脸留白规则不适用（docs/03 R5）
    let advice: Advice | null = null;
    if (!isFront && front < 0.08) {
      advice = {
        priority: 40,
        textKey: "advice.leadRoom",
        args: { front, back },
        action: { kind: "pan", dir: facing.dir === "right" ? "left" : "right", magnitude: 0.08 - front },
      };
    }
    return {
      ruleId: "leadRoom",
      score,
      weight,
      available: true,
      advice,
      detail: `朝向=${facing.dir}(${facing.source}=${facing.value.toFixed(2)}) front=${front.toFixed(2)} back=${back.toFixed(2)}${isFront ? " · 正脸降权" : ""}`,
    };
  },
};

/* ------------------------------- R6 视觉平衡 -------------------------------- */
export const balanceRule: CompositionRule = {
  id: "balance",
  title: "R6 视觉平衡",
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult {
    const aspect = frameAspect(f);
    const centroid = f.saliency ? saliencyCentroid(f.saliency) : null;
    const subject = findSubject(f);
    const g = centroid ?? (subject ? rectCenter(subject.rect) : null);
    if (!g) return unavailable("balance", "既无显著图也无主体");

    const imbalance = normDistance(g, { x: 0.5, y: 0.5 }, aspect);
    const score = clamp01(1 - imbalance / 0.22);

    let advice: Advice | null = null;
    const move = discretizePan(0.5 - g.x, 0.5 - g.y);
    if (score < 0.5 && move) advice = positionAdvice(move, 50);

    return {
      ruleId: "balance",
      score,
      weight: w.balance ?? 0,
      available: true,
      advice,
      detail: `质心=(${g.x.toFixed(2)},${g.y.toFixed(2)}) 失衡=${imbalance.toFixed(3)}${
        centroid ? "" : " · 降级：以主体框中心代替显著图质心"
      }`,
    };
  },
};
