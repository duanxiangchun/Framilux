import type { CompositionRule, PerceptionFrame, RuleResult, ScoreBreakdown, SceneWeights } from "./contracts";
import { clamp01 } from "./math";

/**
 * 打分引擎（docs/03 §4）：s01 = Σ(w_i·f_i) / Σ(w_i)，display = 1 + 4·s01^0.8。
 * 纯函数式、无内部可变状态，可任意线程调用（docs/04 §9）。
 */
export class ScoreEngine {
  constructor(private readonly rules: CompositionRule[]) {}

  score(f: PerceptionFrame, weights: SceneWeights): ScoreBreakdown {
    const perRule = new Map<string, RuleResult>();
    let num = 0;
    let den = 0;

    for (const rule of this.rules) {
      const res = rule.evaluate(f, weights);
      perRule.set(res.ruleId, res);
      // 不可用（模型缺失/无传感器）或权重为 0 的规则不参与，避免"静默失效导致分数虚高"（docs/06 §7）
      if (!res.available || !(res.weight > 0)) continue;
      num += res.weight * clamp01(res.score);
      den += res.weight;
    }

    const total01 = den > 0 ? num / den : 0;
    const display = den > 0 ? 1 + 4 * Math.pow(total01, 0.8) : 0;
    return { total01, display, perRule, weightSum: den };
  }
}
