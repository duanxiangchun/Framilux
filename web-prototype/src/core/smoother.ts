import type { Advice, Guidance, GuidanceSnapshot, NormRect, RuleResult, SmoothConfig } from "./contracts";
import { DEFAULT_SMOOTH_CONFIG } from "./contracts";
import { lerp } from "./math";

/**
 * 平滑与迟滞（docs/01 §7 / docs/03 §6）：
 * - 连续量走 EMA（α=0.35）；
 * - 主建议要"展示满 minAdviceMs"且"新方案更优或优先级更高"才切换；
 * - "可以拍了"需要连续 readyHoldMs 都达标。
 * 输出不可变快照，UI 只读（docs/04 §9）。
 */
export class GuidanceSmoother {
  private readonly cfg: SmoothConfig;
  private current: { advice: Advice; ruleId: string | null; sinceTs: number; gain: number } | null = null;
  private readySince: number | null = null;
  private initialized = false;
  private emaDisplay = 0;
  private emaSubject: NormRect | null = null;
  private emaTarget: NormRect | null = null;
  private emaArrowX = 0;
  private emaArrowY = 0;
  private emaTilt: number | null = null;
  private latestSnapshot: GuidanceSnapshot | null = null;

  constructor(cfg: SmoothConfig = DEFAULT_SMOOTH_CONFIG) {
    this.cfg = cfg;
  }

  get latest(): GuidanceSnapshot | null {
    return this.latestSnapshot;
  }

  reset(): void {
    this.current = null;
    this.readySince = null;
    this.initialized = false;
    this.latestSnapshot = null;
    this.emaSubject = null;
    this.emaTarget = null;
    this.emaTilt = null;
  }

  push(g: Guidance, perRule: RuleResult[], tsNs: number): GuidanceSnapshot {
    const a = this.cfg.emaAlpha;

    // ---- 连续量 EMA ----
    if (!this.initialized) {
      this.emaDisplay = g.displayScore;
      this.emaSubject = g.subjectBox;
      this.emaTarget = g.targetBox;
      this.emaArrowX = g.arrow?.dx ?? 0;
      this.emaArrowY = g.arrow?.dy ?? 0;
      this.emaTilt = g.horizonTiltDeg;
      this.initialized = true;
    } else {
      this.emaDisplay = lerp(this.emaDisplay, g.displayScore, a);
      this.emaSubject = this.lerpRect(this.emaSubject, g.subjectBox, a);
      this.emaTarget = this.lerpRect(this.emaTarget, g.targetBox, a);
      this.emaArrowX = lerp(this.emaArrowX, g.arrow?.dx ?? 0, a) as number;
      this.emaArrowY = lerp(this.emaArrowY, g.arrow?.dy ?? 0, a) as number;
      this.emaTilt = this.lerpNum(this.emaTilt, g.horizonTiltDeg, a);
    }

    // ---- 主建议迟滞 + 最短展示时长 ----
    const advice = this.applyHysteresis(g, perRule, tsNs);

    // ---- "可以拍了" ----
    if (g.ready) {
      if (this.readySince === null) this.readySince = tsNs;
    } else {
      this.readySince = null;
    }
    const ready = this.readySince !== null && tsNs - this.readySince >= this.cfg.readyHoldMs * 1e6;

    const snapshot: GuidanceSnapshot = {
      tsNs,
      displayScore: this.emaDisplay,
      total01: g.total01,
      mainAdvice: advice.advice,
      mainRuleId: advice.ruleId,
      subjectBox: this.emaSubject,
      targetBox: this.emaTarget,
      arrow: g.arrow ? { dx: this.emaArrowX, dy: this.emaArrowY } : null,
      horizonTiltDeg: this.emaTilt,
      zoomHint: g.zoomHint,
      ready,
      perRule,
      raw: g,
    };
    this.latestSnapshot = snapshot;
    return snapshot;
  }

  private applyHysteresis(
    g: Guidance,
    perRule: RuleResult[],
    tsNs: number,
  ): { advice: Advice | null; ruleId: string | null } {
    const cand = g.mainAdvice;
    const candRuleId = g.mainRuleId;
    const gainOf = (ruleId: string | null): number => {
      if (!ruleId) return 0;
      const r = perRule.find((x) => x.ruleId === ruleId);
      return r ? (r.weight || 0) * (1 - Math.max(0, Math.min(1, r.score))) : 0;
    };
    const candGain = gainOf(candRuleId);

    if (!cand) {
      // 没有建议了：等最短展示时长结束后清空
      if (!this.current) return { advice: null, ruleId: null };
      if (tsNs - this.current.sinceTs >= this.cfg.minAdviceMs * 1e6) {
        this.current = null;
        return { advice: null, ruleId: null };
      }
      return { advice: this.current.advice, ruleId: this.current.ruleId };
    }

    if (!this.current) {
      this.current = { advice: cand, ruleId: candRuleId, sinceTs: tsNs, gain: candGain };
      return { advice: cand, ruleId: candRuleId };
    }

    // 同一条建议：只更新参数，保留起始时间（避免文本闪烁）
    if (cand.textKey === this.current.advice.textKey && candRuleId === this.current.ruleId) {
      this.current.advice = cand;
      this.current.gain = candGain;
      return { advice: cand, ruleId: candRuleId };
    }

    // 当前建议是否"仍然成立"：它那条规则还在出同一条建议、且权重没被调成 0。
    // 不成立就必须让位 —— 否则用户把权重拉到 0 后，旧建议会一直挂在屏幕上（实测踩到过）。
    const stillValid = perRule.some(
      (r) =>
        r.ruleId === this.current?.ruleId &&
        r.available &&
        r.weight > 0 &&
        r.advice != null &&
        r.advice.textKey === this.current?.advice.textKey,
    );

    const elapsedMs = (tsNs - this.current.sinceTs) / 1e6;
    const higherPriority = cand.priority < this.current.advice.priority;
    const clearlyBetter = candGain - this.current.gain > this.cfg.switchMargin;
    if (elapsedMs >= this.cfg.minAdviceMs && (!stillValid || higherPriority || clearlyBetter)) {
      this.current = { advice: cand, ruleId: candRuleId, sinceTs: tsNs, gain: candGain };
      return { advice: cand, ruleId: candRuleId };
    }
    return { advice: this.current.advice, ruleId: this.current.ruleId };
  }

  private lerpRect(prev: NormRect | null, next: NormRect | null, a: number): NormRect | null {
    if (!prev) return next; // 出现/消失时直接跳变，避免"从边缘长出来"的假象
    if (!next) return null;
    return {
      l: lerp(prev.l, next.l, a),
      t: lerp(prev.t, next.t, a),
      r: lerp(prev.r, next.r, a),
      b: lerp(prev.b, next.b, a),
    };
  }

  private lerpNum(prev: number | null, next: number | null, a: number): number | null {
    if (next === null) return null;
    if (prev === null) return next;
    return lerp(prev, next, a);
  }
}

/** 旧帧直接丢弃，不参与融合（docs/04 §2：超过 200ms 的帧不要） */
export function isStaleFrame(captureTsNs: number, nowNs: number, cfg: SmoothConfig = DEFAULT_SMOOTH_CONFIG): boolean {
  return nowNs - captureTsNs > cfg.staleFrameMs * 1e6;
}
