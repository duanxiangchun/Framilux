import type { NormPoint, NormRect } from "../contracts";
import { THIRD_POINTS } from "../contracts";
import { normDistance, rectCenter } from "./rect-utils";

/** 位置类动作的离散化阈值（docs/03 §5）：超过这个量才值得开口说一句话 */
export const POSITION_EPS = 0.06;

/** 离当前主体中心最近的三分交点 —— 引导求解的"目标位置" */
export function nearestThirdPoint(c: NormPoint, aspect: number): NormPoint {
  let best = THIRD_POINTS[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const p of THIRD_POINTS) {
    const d = normDistance(c, p, aspect);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** 主体中心到最近三分交点的归一化距离（R1 的 d） */
export function thirdsDistance(rect: NormRect, aspect: number): number {
  const c = rectCenter(rect);
  let d = Number.POSITIVE_INFINITY;
  for (const p of THIRD_POINTS) {
    const cur = normDistance(c, p, aspect);
    if (cur < d) d = cur;
  }
  return d;
}

/** 位移向量的离散化：返回 null 表示"位置已经可以了" */
export function discretizePan(
  dx: number,
  dy: number,
): { dir: "left" | "right" | "up" | "down"; magnitude: number } | null {
  if (Math.abs(dx) < POSITION_EPS && Math.abs(dy) < POSITION_EPS) return null;
  // 一次只说一件事：取位移大的那一轴
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { dir: dx < 0 ? "left" : "right", magnitude: Math.abs(dx) };
  }
  return { dir: dy < 0 ? "up" : "down", magnitude: Math.abs(dy) };
}
