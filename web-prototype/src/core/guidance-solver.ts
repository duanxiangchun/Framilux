import type { Advice, Arrow, Guidance, NormRect, PerceptionFrame, ScoreBreakdown } from "./contracts";
import { DEFAULT_SMOOTH_CONFIG } from "./contracts";
import { clamp01, frameAspect } from "./math";
import { nearestThirdPoint } from "./rules/geometry";
import { rectArea, rectCenter, translateRect } from "./rules/rect-utils";
import { findSubject } from "./rules/subject";
import { SUBJECT_RATIO_TARGET } from "./scene-weights";

/**
 * 引导求解（docs/03 §5）：输出"该怎么改"。
 * 每帧只出一条主建议：优先级 水平(10) > 光(20) > 位置(30) > 占比/留白(40) > 风格(50)。
 */
export class GuidanceSolver {
  solve(b: ScoreBreakdown, f: PerceptionFrame, readyThreshold = DEFAULT_SMOOTH_CONFIG.readyThreshold): Guidance {
    const aspect = frameAspect(f);
    const subject = findSubject(f);
    const subjectBox = subject ? subject.rect : null;

    // 收集候选建议，gain = 权重 × 不足程度，用于同优先级时择优与迟滞比较。
    // 权重为 0 = 该画像下这条规则不参与打分，那它也不该开口（否则"占比"权重调 0 了还在喊"靠近一点"）
    const candidates = [...b.perRule.values()]
      .filter((r): r is typeof r & { advice: Advice } => r.available && r.advice != null && r.weight > 0)
      .map((r) => ({ advice: r.advice, gain: (r.weight || 0) * (1 - clamp01(r.score)), ruleId: r.ruleId }));
    candidates.sort((a, c) => a.advice.priority - c.advice.priority || c.gain - a.gain);

    let mainAdvice: Advice | null = candidates.length > 0 ? candidates[0].advice : null;
    let mainRuleId: string | null = candidates.length > 0 ? candidates[0].ruleId : null;

    if (!subject) {
      // 无主体：降级为"找主体"，但仍保留水平/曝光类提示（docs/04 §8）
      const lightOrLevel = candidates.find((c) => c.advice.priority <= 20);
      mainAdvice =
        lightOrLevel?.advice ??
        { priority: 30, textKey: "advice.subject.missing", args: {}, action: { kind: "subject", magnitude: 0 } };
      mainRuleId = lightOrLevel?.ruleId ?? null;
    } else if (!mainAdvice && b.display >= readyThreshold) {
      mainAdvice = { priority: 60, textKey: "advice.hold", args: {}, action: { kind: "hold" } };
      mainRuleId = null;
    }

    // 目标主体位置：对称/建筑取画面中心，否则取最近的三分交点（docs/03 §5）
    let targetBox: NormRect | null = null;
    let arrow: Arrow | null = null;
    if (subjectBox) {
      const c = rectCenter(subjectBox);
      const target = f.scene.profile === "architecture" ? { x: 0.5, y: 0.5 } : nearestThirdPoint(c, aspect);
      targetBox = translateRect(subjectBox, target.x - c.x, target.y - c.y);
      arrow = { dx: target.x - c.x, dy: target.y - c.y };
    }

    const profile = SUBJECT_RATIO_TARGET[f.scene.profile] ?? SUBJECT_RATIO_TARGET.portrait;
    let zoomHint: Guidance["zoomHint"] = "ok";
    if (subjectBox) {
      const r = rectArea(subjectBox);
      if (r < profile.r - profile.sigma) zoomHint = "in";
      else if (r > profile.r + profile.sigma) zoomHint = "out";
    }

    const tilt = f.devicePose.source === "imu" && Number.isFinite(f.devicePose.rollDeg) ? f.devicePose.rollDeg : null;
    const ready = b.weightSum > 0 && b.display >= readyThreshold;

    return {
      total01: b.total01,
      displayScore: b.display,
      mainAdvice,
      mainRuleId,
      subjectBox,
      targetBox,
      arrow,
      horizonTiltDeg: tilt,
      zoomHint,
      ready,
    };
  }
}
