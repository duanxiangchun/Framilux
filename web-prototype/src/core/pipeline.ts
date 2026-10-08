import type { CompositionRule, GuidanceSnapshot, PerceptionFrame, SceneWeights, ScoreBreakdown, SmoothConfig } from "./contracts";
import { DEFAULT_SMOOTH_CONFIG } from "./contracts";
import { GuidanceSolver } from "./guidance-solver";
import { RULES } from "./rules";
import { DEFAULT_SCENE_KIND, weightsFor } from "./scene-weights";
import { ScoreEngine } from "./score-engine";
import { GuidanceSmoother } from "./smoother";

/**
 * 决策层门面：帧进 → (打分 + 求解 + 平滑) 出快照。
 * 平台无关，可直接在 Node 下用固定输入跑单测（docs/04 §7 的回归对比就靠它）。
 */
export class CompositionPipeline {
  private readonly engine: ScoreEngine;
  private readonly solver = new GuidanceSolver();
  private readonly smoother: GuidanceSmoother;
  private weights: SceneWeights;

  constructor(rules: CompositionRule[] = RULES, cfg: SmoothConfig = DEFAULT_SMOOTH_CONFIG) {
    this.engine = new ScoreEngine(rules);
    this.smoother = new GuidanceSmoother(cfg);
    this.weights = weightsFor(DEFAULT_SCENE_KIND);
  }

  get currentWeights(): SceneWeights {
    return this.weights;
  }

  setWeights(weights: SceneWeights): void {
    this.weights = { ...weights };
  }

  process(f: PerceptionFrame): { breakdown: ScoreBreakdown; snapshot: GuidanceSnapshot } {
    const breakdown = this.engine.score(f, this.weights);
    const guidance = this.solver.solve(breakdown, f);
    const perRule = [...breakdown.perRule.values()];
    const snapshot = this.smoother.push(guidance, perRule, f.tsNs);
    return { breakdown, snapshot };
  }

  reset(): void {
    this.smoother.reset();
  }
}
