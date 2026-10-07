/**
 * L1 预处理层：FrameGate —— 节流 + 丢帧（docs/06 §2 步骤 2，docs/01 §5）。
 *
 * 两条策略：
 * 1. 节流：目标 10 fps（Fast 通路帧率，docs/01 §4），不足间隔的帧直接丢；
 * 2. 背压：上一帧仍在处理（推理未返回）时，**丢当前帧而不是排队**——
 *    保证"永远是画面最新的一帧在算"，不会出现手停了提示还在追。
 *
 * 本类不依赖任何浏览器 API 之外的运行时（performance.now 可选，
 * 由调用方传入时间戳即可），便于单测。
 */

export interface FrameGateConfig {
  /** 目标处理帧率；Fast 通路默认 10 */
  targetFps?: number;
}

export interface FrameGateStats {
  targetFps: number;
  intervalMs: number;
  /** 看到的帧总数（每次 run 调用计 1） */
  seen: number;
  /** 真正进入处理的帧数 */
  processed: number;
  /** 因未到节流间隔被丢 */
  droppedByThrottle: number;
  /** 因上一帧仍在处理被丢（背压丢旧帧） */
  droppedWhileBusy: number;
  /** 最近 1 秒的实际处理帧率 */
  effectiveFps: number;
  /** 当前在处理中的帧数（正常只会是 0 或 1） */
  inFlight: number;
  /** 上一帧的处理耗时（ms） */
  lastProcessMs: number;
}

const FPS_WINDOW_MS = 1000;

export class FrameGate {
  private targetFps: number;
  private lastAdmitMs = Number.NEGATIVE_INFINITY;
  private admitTimes: number[] = [];
  private seen = 0;
  private processed = 0;
  private droppedByThrottle = 0;
  private droppedWhileBusy = 0;
  private inFlight = 0;
  private lastProcessMs = 0;

  constructor(cfg: FrameGateConfig = {}) {
    this.targetFps = clampFps(cfg.targetFps ?? 10);
  }

  get intervalMs(): number {
    return 1000 / this.targetFps;
  }

  setTargetFps(fps: number): void {
    this.targetFps = clampFps(fps);
    // 立即允许下一帧，避免降频后白等一个旧间隔
    this.lastAdmitMs = Number.NEGATIVE_INFINITY;
  }

  /**
   * 判定本帧是否进入处理；true 表示调用方获得处理权，处理完必须 release()。
   * 一般用 run() 而不是手动配对。
   */
  admit(nowMs: number): boolean {
    this.seen += 1;

    if (nowMs - this.lastAdmitMs < this.intervalMs) {
      this.droppedByThrottle += 1;
      return false;
    }
    if (this.inFlight > 0) {
      this.droppedWhileBusy += 1;
      return false;
    }

    this.lastAdmitMs = nowMs;
    this.processed += 1;
    this.inFlight += 1;
    this.admitTimes.push(nowMs);
    this.prune(nowMs);
    return true;
  }

  /** 与 admit() 配对 */
  release(costMs: number): void {
    if (this.inFlight > 0) this.inFlight -= 1;
    this.lastProcessMs = costMs;
  }

  /**
   * 通过闸门则执行 fn（同步或异步），返回是否执行。
   * 处理中的异常照常抛出，但 inFlight 一定会归位（不会把闸门卡死）。
   */
  async run(nowMs: number, fn: () => void | Promise<void>): Promise<boolean> {
    if (!this.admit(nowMs)) return false;
    const t0 = monotonicNow();
    try {
      await fn();
      return true;
    } finally {
      this.release(monotonicNow() - t0);
    }
  }

  reset(): void {
    this.lastAdmitMs = Number.NEGATIVE_INFINITY;
    this.admitTimes = [];
    this.seen = 0;
    this.processed = 0;
    this.droppedByThrottle = 0;
    this.droppedWhileBusy = 0;
    this.inFlight = 0;
    this.lastProcessMs = 0;
  }

  stats(): FrameGateStats {
    return {
      targetFps: this.targetFps,
      intervalMs: this.intervalMs,
      seen: this.seen,
      processed: this.processed,
      droppedByThrottle: this.droppedByThrottle,
      droppedWhileBusy: this.droppedWhileBusy,
      effectiveFps: this.effectiveFps(),
      inFlight: this.inFlight,
      lastProcessMs: this.lastProcessMs,
    };
  }

  private effectiveFps(): number {
    const n = this.admitTimes.length;
    if (n < 2) return 0;
    const span = this.admitTimes[n - 1] - this.admitTimes[0];
    if (span <= 0) return 0;
    return ((n - 1) * 1000) / span;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - FPS_WINDOW_MS;
    while (this.admitTimes.length > 0 && this.admitTimes[0] < cutoff) this.admitTimes.shift();
  }
}

function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return 10;
  return Math.min(60, Math.max(1, fps));
}

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
