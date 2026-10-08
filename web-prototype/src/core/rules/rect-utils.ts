import type { NormPoint, NormRect } from "../contracts";

// 几何工具在 contracts 里定义（契约的一部分），这里再导出，方便规则层单点引用
export { rectArea, rectCenter, rectH, rectW } from "../contracts";

export function translateRect(r: NormRect, dx: number, dy: number): NormRect {
  return { l: r.l + dx, t: r.t + dy, r: r.r + dx, b: r.b + dy };
}

export function normDistance(a: NormPoint, b: NormPoint, aspect: number): number {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy) / Math.hypot(aspect, 1);
}

/** 关键点包围盒（忽略低置信度点） */
export function bboxOf(points: NormPoint[], scores: number[] | undefined, minScore = 0.3): NormRect | null {
  let l = 1;
  let t = 1;
  let r = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < points.length; i++) {
    const s = scores?.[i] ?? 1;
    if (s < minScore) continue;
    const p = points[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    l = Math.min(l, p.x);
    t = Math.min(t, p.y);
    r = Math.max(r, p.x);
    b = Math.max(b, p.y);
    n += 1;
  }
  return n >= 2 ? { l, t, r, b } : null;
}

/** 矩形内显著图均值（[0,1]）；无显著图时返回 null */
export function meanSaliency(sal: { w: number; h: number; data: Float32Array } | undefined, rect: NormRect): number | null {
  if (!sal || sal.w <= 0 || sal.h <= 0) return null;
  const x0 = Math.max(0, Math.floor(rect.l * sal.w));
  const x1 = Math.min(sal.w - 1, Math.ceil(rect.r * sal.w));
  const y0 = Math.max(0, Math.floor(rect.t * sal.h));
  const y1 = Math.min(sal.h - 1, Math.ceil(rect.b * sal.h));
  if (x1 < x0 || y1 < y0) return null;
  let sum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      sum += sal.data[y * sal.w + x];
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

/** 显著图质心（行优先，坐标为归一化中心） */
export function saliencyCentroid(sal: { w: number; h: number; data: Float32Array }): { x: number; y: number; mass: number } | null {
  let sx = 0;
  let sy = 0;
  let m = 0;
  for (let y = 0; y < sal.h; y++) {
    for (let x = 0; x < sal.w; x++) {
      const v = sal.data[y * sal.w + x];
      if (!(v > 0)) continue;
      sx += v * ((x + 0.5) / sal.w);
      sy += v * ((y + 0.5) / sal.h);
      m += v;
    }
  }
  if (m <= 0) return null;
  return { x: sx / m, y: sy / m, mass: m };
}