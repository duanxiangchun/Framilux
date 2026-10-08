/** 纯数学工具：不依赖任何平台 API，可单测（docs/06 §4 决策层零依赖） */

/** 画面宽高比 W/H。归一化坐标下 W=aspect、H=1，距离计算必须先乘宽高比（docs/04 §1） */
export function frameAspect(f: { frameSize: { w: number; h: number } }): number {
  const w = f.frameSize.w;
  const h = f.frameSize.h;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 16 / 9;
  return w / h;
}

/**
 * 归一化坐标下的"真实"距离：先把 x 乘宽高比，再用画面对角线归一化。
 * 对应 docs/03 §1：d = ||(c1-c2) ⊙ (W,H)|| / diag(W,H)
 */
export function normDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
  aspect: number,
): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy) / Math.hypot(aspect, 1);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 高斯型"越接近理想值越好"的评分（docs/03 R3 / R10 都用这个形状） */
export function gaussianScore(v: number, ideal: number, sigma: number): number {
  if (sigma <= 0) return v === ideal ? 1 : 0;
  const t = (v - ideal) / sigma;
  return clamp01(Math.exp(-t * t));
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
