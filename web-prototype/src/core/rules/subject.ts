import type { NormRect, PerceptionFrame } from "../contracts";
import { bboxOf, meanSaliency, rectArea } from "./rect-utils";

export type SubjectSource = "face" | "pose" | "saliency";

export interface Subject {
  rect: NormRect;
  source: SubjectSource;
  /** 归一化显著度均值（无显著图时为 null） */
  saliency: number | null;
}

/**
 * 主体求解（docs/03 §1）：主体 = 人脸框 ∪ 人体框 ∪ 显著图重心区域，
 * 取"面积 × 显著度"最大的那个。没有主体时返回 null，由上层降级（docs/04 §8）。
 */
export function findSubject(f: PerceptionFrame): Subject | null {
  const candidates: Subject[] = [];

  for (const face of f.faces) {
    candidates.push({ rect: face.rect, source: "face", saliency: meanSaliency(f.saliency, face.rect) });
  }
  if (f.pose) {
    const rect = bboxOf(f.pose.keypoints, f.pose.scores);
    if (rect) candidates.push({ rect, source: "pose", saliency: meanSaliency(f.saliency, rect) });
  }
  if (f.saliency) {
    const rect = saliencyBox(f.saliency);
    if (rect) candidates.push({ rect, source: "saliency", saliency: meanSaliency(f.saliency, rect) });
  }

  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestScore = -1;
  for (const c of candidates) {
    const sal = c.saliency ?? 0.5;
    const score = rectArea(c.rect) * (0.5 + 0.5 * sal);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** 显著图阈值区域的包围盒（阈值取最大值的 60%） */
function saliencyBox(sal: { w: number; h: number; data: Float32Array }): NormRect | null {
  let max = 0;
  for (let i = 0; i < sal.data.length; i++) if (sal.data[i] > max) max = sal.data[i];
  if (max <= 0) return null;
  const thr = max * 0.6;
  let l = sal.w;
  let t = sal.h;
  let r = -1;
  let b = -1;
  for (let y = 0; y < sal.h; y++) {
    for (let x = 0; x < sal.w; x++) {
      if (sal.data[y * sal.w + x] < thr) continue;
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
    }
  }
  if (r < l || b < t) return null;
  return { l: l / sal.w, t: t / sal.h, r: (r + 1) / sal.w, b: (b + 1) / sal.h };
}
