import { describe, expect, it } from "vitest";
import type { Advice, Guidance, RuleResult } from "../contracts";
import { DEFAULT_SMOOTH_CONFIG } from "../contracts";
import { renderAdviceText } from "../texts";
import { CompositionPipeline } from "../pipeline";
import { ScoreEngine } from "../score-engine";
import { RULES } from "../rules";
import { GuidanceSmoother } from "../smoother";
import { weightsFor } from "../scene-weights";
import { face, makeFrame, NO_IMU, scene } from "./fixture";

/** 回归基线用的固定帧：改规则时先看这条测试会不会红（docs/04 §7 三端对齐用同一组输入） */
const BASELINE = makeFrame({
  faces: [face({ l: 0.3, t: 0.3, r: 0.46, b: 0.52 })],
  scene: scene("landscape"),
  light: { meanLuma: 0.5, highlightClipRatio: 0, shadowClipRatio: 0, colorTempK: 5500, faceMeanLuma: 0.52 },
});

describe("ScoreEngine", () => {
  it("Σw·f / Σw 与 1+4·s^0.8 映射", () => {
    const engine = new ScoreEngine(RULES);
    const b = engine.score(BASELINE, weightsFor("landscape"));
    expect(b.perRule.size).toBe(8);
    expect(b.weightSum).toBeGreaterThan(0);
    expect(b.display).toBeCloseTo(1 + 4 * Math.pow(b.total01, 0.8), 6);
  });

  it("不可用的规则不进分母（避免静默失效把分数抬高）", () => {
    const engine = new ScoreEngine(RULES);
    const b = engine.score(makeFrame({ devicePose: NO_IMU }), weightsFor("portrait"));
    expect(b.perRule.get("horizon")?.available).toBe(false);
    expect(b.perRule.get("horizon")?.weight).toBe(0);
    const expectedDen = [...b.perRule.values()]
      .filter((r) => r.available && r.weight > 0)
      .reduce((s, r) => s + r.weight, 0);
    expect(b.weightSum).toBeCloseTo(expectedDen, 6);
  });
});

describe("CompositionPipeline 回归基线", () => {
  it("固定输入 → 分数与建议稳定", () => {
    const p = new CompositionPipeline();
    const first = p.process(BASELINE);
    p.process(BASELINE);
    const second = p.process(BASELINE);

    // 回归基线：这组数就是"当前这套权重 + 这组固定输入"的解。
    // 调权重会让它变红 —— 这正是它的用途；改完记得同步 docs/03 §3 的权重表。
    expect(first.breakdown.total01).toBeCloseTo(0.748, 2);
    expect(second.snapshot.displayScore).toBeCloseTo(4.17, 1);

    // 这一帧最该说的是"头顶留白太多"（h=0.30）
    expect(second.snapshot.mainAdvice?.textKey).toBe("advice.headroom.high");
    expect(renderAdviceText(second.snapshot.mainAdvice)).toBe("头顶留白太多，靠近或放低手机");
    expect(second.snapshot.mainRuleId).toBe("headroom");
    expect(second.snapshot.targetBox).not.toBeNull();
  });

  it("权重被调成 0 的规则不再出建议（画像不关心就不该唠叨）", () => {
    const p = new CompositionPipeline();
    p.setWeights({ ...weightsFor("portrait"), headroom: 0, subjectRatio: 0, balance: 0 });
    p.process(BASELINE);
    const r = p.process(BASELINE);
    // 剩下 R1(0.8) / R2(1.0) / R10(1.2) / R11(0.8)：这一帧都没有话说，
    // 分数又够高 → 应落到「可以按快门」而不是继续喊头顶留白
    expect(r.snapshot.mainAdvice?.textKey).toBe("advice.hold");
    expect(r.snapshot.mainRuleId).toBeNull();
  });

  it("没有主体时降级提示「移动手机找找主体」或曝光提示", () => {
    const p = new CompositionPipeline();
    const r = p.process(makeFrame({ light: { meanLuma: 0.2, highlightClipRatio: 0, shadowClipRatio: 0, colorTempK: 5500 } }));
    expect(["advice.subject.missing", "advice.exposure.dark"]).toContain(r.snapshot.mainAdvice?.textKey);
  });
});

describe("GuidanceSmoother 迟滞", () => {
  const ruleResult = (score: number, weight = 1): RuleResult => ({
    ruleId: "thirds",
    score,
    weight,
    available: true,
    advice: null,
  });

  const guidanceWith = (advice: Advice, ready = false, ruleId = "thirds"): Guidance => ({
    total01: 0.6,
    displayScore: 3.5,
    mainAdvice: advice,
    mainRuleId: ruleId,
    subjectBox: null,
    targetBox: null,
    arrow: null,
    horizonTiltDeg: 0,
    zoomHint: "ok",
    ready,
  });

  const adviceA: Advice = { priority: 30, textKey: "advice.pan.left", args: {}, action: { kind: "pan", dir: "left", magnitude: 0.1 } };
  const adviceB: Advice = { priority: 30, textKey: "advice.pan.right", args: {}, action: { kind: "pan", dir: "right", magnitude: 0.2 } };

  it("更强的新建议也要等最短展示时长（1.2s）才切换", () => {
    const s = new GuidanceSmoother();
    s.push(guidanceWith(adviceA), [ruleResult(0.9)], 0);
    expect(s.push(guidanceWith(adviceB), [ruleResult(0.1)], 300 * 1e6).mainAdvice?.textKey).toBe("advice.pan.left");
    expect(s.push(guidanceWith(adviceB), [ruleResult(0.1)], 1300 * 1e6).mainAdvice?.textKey).toBe("advice.pan.right");
  });

  it("建议的规则失效（权重被调成 0）后，旧建议必须让位", () => {
    const s = new GuidanceSmoother();
    // 先让低优先级的 R1 位置建议上屏
    s.push(guidanceWith(adviceA), [{ ruleId: "thirds", score: 0.9, weight: 1, available: true, advice: adviceA }], 0);
    expect(s.latest?.mainAdvice?.textKey).toBe("advice.pan.left");

    // 用户把 thirds 权重调到 0：R1 不再出建议，只剩优先级更低的 R3（40 > 30）
    const next = s.push(guidanceWith(adviceB, false, "subjectRatio"), [
      { ruleId: "thirds", score: 0.9, weight: 0, available: true, advice: null },
      { ruleId: "subjectRatio", score: 0.3, weight: 1, available: true, advice: adviceB },
    ], 2000 * 1e6);
    expect(next.mainAdvice?.textKey).toBe("advice.pan.right");
    expect(next.mainRuleId).toBe("subjectRatio");
  });

  it("「可以拍了」要连续 hold 1.5s", () => {
    const s = new GuidanceSmoother();
    const g = guidanceWith(adviceA, true);
    s.push(g, [ruleResult(0.9)], 0);
    expect(s.push(g, [ruleResult(0.9)], 1e9).ready).toBe(false);
    expect(s.push(g, [ruleResult(0.9)], 1.6e9).ready).toBe(true);
  });

  it("平滑器默认配置与 docs/04 §5 一致", () => {
    expect(DEFAULT_SMOOTH_CONFIG.emaAlpha).toBe(0.35);
    expect(DEFAULT_SMOOTH_CONFIG.switchMargin).toBe(0.08);
    expect(DEFAULT_SMOOTH_CONFIG.minAdviceMs).toBe(1200);
    expect(DEFAULT_SMOOTH_CONFIG.staleFrameMs).toBe(200);
  });
});
