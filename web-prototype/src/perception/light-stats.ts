import type { FaceBox, LightStats, NormRect, SaliencyMap } from "../core/contracts";

/**
 * L2 感知：光照统计（直方图类，docs/01 §3 里预算 < 1ms）。
 *
 * 亮度一律取 **sRGB 编码值 / 255**，不做线性化 —— docs/03 R10 的理想值 0.52 是按
 * 感知亮度定的，线性化后中灰只有 0.21，会对不上。
 *
 * 同时产出**降级版显著图**：按块梯度能量（"最大前景块"思路，docs/04 §8 明说了
 * 显著性不可用时的降级路径）。真正的 UniSal 在 M2 随 LiteRT 接入，M1 不追求识别精度。
 */
export interface LightMeasure {
  light: LightStats;
  saliency: SaliencyMap;
  saliencyDegraded: boolean;
}

const W = 160;
const H = 90;
const BLOCK = 5; // 160/5 × 90/5 = 32×18 的显著图

export class LightStatsPerceptor {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly luma: Float32Array = new Float32Array(W * H);

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("光照统计需要 2D canvas 支持");
    this.ctx = ctx;
  }

  measure(video: HTMLVideoElement, faces: FaceBox[]): LightMeasure {
    this.ctx.drawImage(video, 0, 0, W, H);
    const px = this.ctx.getImageData(0, 0, W, H).data;

    let sum = 0;
    let hi = 0;
    let lo = 0;
    for (let i = 0, p = 0; i < px.length; i += 4, p++) {
      const v = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      this.luma[p] = v;
      sum += v;
      if (v > 0.98) hi++;
      else if (v < 0.02) lo++;
    }
    const n = W * H;
    const meanLuma = sum / n;

    // 人脸区域亮度（取最大人脸）+ 背景亮度 → 逆光比
    let faceMeanLuma: number | undefined;
    let backlightRatio: number | undefined;
    const face = largest(faces);
    if (face) {
      const acc = regionMean(this.luma, face.rect);
      if (acc.count > 0) {
        faceMeanLuma = acc.mean;
        const bgSum = sum - acc.sum;
        const bgCount = n - acc.count;
        if (bgCount > 0 && faceMeanLuma > 0.02) backlightRatio = bgSum / bgCount / faceMeanLuma;
      }
    }

    return {
      light: {
        meanLuma,
        highlightClipRatio: hi / n,
        shadowClipRatio: lo / n,
        colorTempK: 5500,
        faceMeanLuma,
        backlightRatio,
      },
      saliency: this.gradientSaliency(),
      saliencyDegraded: true,
    };
  }

  /** 块梯度能量 + 轻微中心偏置：作为显著图的降级代理，M2 换成 UniSal 输出 */
  private gradientSaliency(): SaliencyMap {
    const bw = W / BLOCK;
    const bh = H / BLOCK;
    const data = new Float32Array(bw * bh);
    let max = 1e-6;
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let e = 0;
        for (let y = by * BLOCK; y < (by + 1) * BLOCK - 1; y++) {
          for (let x = bx * BLOCK; x < (bx + 1) * BLOCK - 1; x++) {
            const i = y * W + x;
            e += Math.abs(this.luma[i + 1] - this.luma[i]) + Math.abs(this.luma[i + W] - this.luma[i]);
          }
        }
        const cx = (bx + 0.5) / bw - 0.5;
        const cy = (by + 0.5) / bh - 0.5;
        const centerBias = 1 - 0.3 * Math.min(1, Math.hypot(cx * 2, cy * 2));
        data[by * bw + bx] = e * centerBias;
        if (data[by * bw + bx] > max) max = data[by * bw + bx];
      }
    }
    for (let i = 0; i < data.length; i++) data[i] /= max;
    return { w: bw, h: bh, data };
  }
}

function largest(faces: FaceBox[]): FaceBox | null {
  let best: FaceBox | null = null;
  let bestArea = -1;
  for (const f of faces) {
    const a = (f.rect.r - f.rect.l) * (f.rect.b - f.rect.t);
    if (a > bestArea) {
      bestArea = a;
      best = f;
    }
  }
  return best;
}

function regionMean(luma: Float32Array, rect: NormRect): { mean: number; sum: number; count: number } {
  const x0 = Math.max(0, Math.floor(rect.l * W));
  const x1 = Math.min(W - 1, Math.ceil(rect.r * W));
  const y0 = Math.max(0, Math.floor(rect.t * H));
  const y1 = Math.min(H - 1, Math.ceil(rect.b * H));
  let sum = 0;
  let count = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      sum += luma[y * W + x];
      count++;
    }
  }
  return { mean: count > 0 ? sum / count : 0, sum, count };
}
