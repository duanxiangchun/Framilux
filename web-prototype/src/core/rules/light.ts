import type { Advice, CompositionRule, PerceptionFrame, RuleResult, SceneWeights } from "../contracts";
import { clamp01, gaussianScore } from "../math";

/* ------------------------------- R10 曝光质量 ------------------------------- */
export const exposureRule: CompositionRule = {
  id: "exposure",
  title: "R10 曝光质量",
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult {
    const faceLuma = f.light.faceMeanLuma;
    const L = typeof faceLuma === "number" && Number.isFinite(faceLuma) ? faceLuma : f.light.meanLuma;
    if (!Number.isFinite(L)) return { ruleId: "exposure", score: 0, weight: 0, advice: null, available: false, detail: "无亮度统计" };

    const score = gaussianScore(L, 0.52, 0.18);

    let advice: Advice | null = null;
    const backlight = f.light.backlightRatio;
    // 逆光：docs/03 R9 的高级判定在 M4，这里先用"背景/人脸亮度比"这个直方图近似（docs/04 §8 的降级路径）
    if (typeof backlight === "number" && backlight > 1.6) {
      advice = { priority: 20, textKey: "advice.backlight", args: { ratio: backlight }, action: { kind: "hold" } };
    } else if (L < 0.52 - 0.18) {
      advice = { priority: 20, textKey: "advice.exposure.dark", args: { luma: L }, action: { kind: "hold" } };
    } else if (L > 0.52 + 0.18) {
      advice = { priority: 20, textKey: "advice.exposure.bright", args: { luma: L }, action: { kind: "hold" } };
    }

    const src = typeof faceLuma === "number" ? "人脸" : "全局（无人脸，降级）";
    return {
      ruleId: "exposure",
      score,
      weight: w.exposure ?? 0,
      available: true,
      advice,
      detail: `L=${L.toFixed(3)}(${src}) 理想 0.52±0.18`,
    };
  },
};

/* ------------------------------ R11 动态范围 -------------------------------- */
export const clippingRule: CompositionRule = {
  id: "clipping",
  title: "R11 动态范围",
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult {
    const hi = f.light.highlightClipRatio;
    const lo = f.light.shadowClipRatio;
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
      return { ruleId: "clipping", score: 0, weight: 0, advice: null, available: false, detail: "无直方图" };
    }
    const score = clamp01(1 - clamp01(hi / 0.03) * 0.6 - clamp01(lo / 0.08) * 0.4);

    let advice: Advice | null = null;
    if (hi / 0.03 > 0.6) {
      advice = { priority: 20, textKey: "advice.clip.highlight", args: { clip: hi }, action: { kind: "hold" } };
    } else if (lo / 0.08 > 0.6) {
      advice = { priority: 20, textKey: "advice.clip.shadow", args: { clip: lo }, action: { kind: "hold" } };
    }

    return {
      ruleId: "clipping",
      score,
      weight: w.clipping ?? 0,
      available: true,
      advice,
      detail: `高光溢出 ${(hi * 100).toFixed(2)}% · 死黑 ${(lo * 100).toFixed(2)}%`,
    };
  },
};
