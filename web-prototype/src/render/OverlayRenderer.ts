/**
 * L4 引导渲染层：Canvas 2D 叠加层。
 *
 * 本步骤（M1 步骤 1–2）只画两样东西：
 * - 三分线（docs/03 R1 的几何提示，静态叠加）
 * - debug HUD：帧率 / 丢帧 / 单帧耗时 / 采集→渲染延迟
 *
 * 坐标约定（docs/04 §1）：内部一律用归一化 [0,1] 坐标，像素换算只发生在本文件。
 * 画面采用 object-fit: cover，因此叠加层必须用同一套 cover 映射
 * （computeCoverLayout），否则后面的人脸框/主体框会整体偏移。
 */

import { THIRD_POINTS, THIRD_VALUES } from "../core/contracts";
import type { FrameGateStats } from "../capture/FrameGate";

export interface OverlayOptions {
  showGrid?: boolean;
  showHud?: boolean;
}

export interface RenderInput {
  videoW: number;
  videoH: number;
  /** 当前帧采集时刻（单调纳秒） */
  captureTsNs: number;
  /** 是否已收到过真实的视频帧时间戳；false 时延迟显示为 — */
  hasFrameTiming: boolean;
  mirrored: boolean;
  gate: FrameGateStats;
  /** 如 "1280×720 @30fps · 前置"，只用于显示 */
  sourceText: string;
  online: boolean;
}

export interface CoverLayout {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
}

/** object-fit: cover 的等价映射（CSS 与 canvas 必须一致） */
export function computeCoverLayout(
  stageW: number,
  stageH: number,
  videoW: number,
  videoH: number,
): CoverLayout {
  if (videoW <= 0 || videoH <= 0 || stageW <= 0 || stageH <= 0) {
    return { offsetX: 0, offsetY: 0, drawW: stageW, drawH: stageH };
  }
  const scale = Math.max(stageW / videoW, stageH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  return {
    offsetX: (stageW - drawW) / 2,
    offsetY: (stageH - drawH) / 2,
    drawW,
    drawH,
  };
}

const HUD_FONT = '12px ui-monospace, SFMono-Regular, Consolas, "Cascadia Mono", monospace';

export class OverlayRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private layout: CoverLayout = { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0 };

  showGrid: boolean;
  showHud: boolean;

  constructor(readonly canvas: HTMLCanvasElement, opts: OverlayOptions = {}) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法获取 2D 上下文（canvas.getContext('2d') 返回 null）");
    this.ctx = ctx;
    this.showGrid = opts.showGrid ?? true;
    this.showHud = opts.showHud ?? true;
  }

  /** 舞台的 CSS 尺寸 + devicePixelRatio；尺寸不变时不做任何事 */
  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(0, Math.round(cssW));
    const h = Math.max(0, Math.round(cssH));
    if (w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  }

  render(input: RenderInput): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    if (input.videoW <= 0 || input.videoH <= 0) return;

    this.layout = computeCoverLayout(this.cssW, this.cssH, input.videoW, input.videoH);

    // 归一化 → 像素；镜像（前置摄像头）时把 u 翻到 1-u，与 CSS scaleX(-1) 对齐
    const px = (u: number): number =>
      this.layout.offsetX + (input.mirrored ? 1 - u : u) * this.layout.drawW;
    const py = (v: number): number => this.layout.offsetY + v * this.layout.drawH;

    if (this.showGrid) this.drawThirds(px, py);
    if (this.showHud) this.drawHud(input);
  }

  /** 三分线 + 四个三分交点（docs/03 R1） */
  private drawThirds(px: (u: number) => number, py: (v: number) => number): void {
    const ctx = this.ctx;
    const top = this.layout.offsetY;
    const bottom = this.layout.offsetY + this.layout.drawH;
    const left = this.layout.offsetX;
    const right = this.layout.offsetX + this.layout.drawW;

    // 两遍描边：先深色描边，再亮色细线，保证在任何画面上都看得清
    for (const pass of [
      { width: 3.5, color: "rgba(0, 0, 0, 0.35)" },
      { width: 1.25, color: "rgba(255, 255, 255, 0.85)" },
    ]) {
      ctx.lineWidth = pass.width;
      ctx.strokeStyle = pass.color;
      ctx.beginPath();
      for (const u of THIRD_VALUES) {
        const x = Math.round(px(u)) + 0.5;
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
      for (const v of THIRD_VALUES) {
        const y = Math.round(py(v)) + 0.5;
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.stroke();
    }

    // 三分交点（后续 R1 的目标点提示就用这四个点）
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    for (const p of THIRD_POINTS) {
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHud(input: RenderInput): void {
    const ctx = this.ctx;
    const g = input.gate;
    const latencyMs = input.hasFrameTiming
      ? (performance.now() * 1e6 - input.captureTsNs) / 1e6
      : Number.NaN;

    const rows = [
      "取流   " + input.sourceText,
      "画面   " + input.videoW + "×" + input.videoH + "  → 叠加层 " +
        Math.round(this.layout.drawW) + "×" + Math.round(this.layout.drawH) +
        (this.layout.drawW > this.cssW + 1 ? "（横向裁切）" : this.layout.drawH > this.cssH + 1 ? "（纵向裁切）" : ""),
      "节流   目标 " + g.targetFps + " fps / 实际 " + g.effectiveFps.toFixed(1) + " fps",
      "帧     收 " + g.seen + " · 处理 " + g.processed +
        " · 丢 " + (g.droppedByThrottle + g.droppedWhileBusy) +
        "（节流 " + g.droppedByThrottle + " / 忙 " + g.droppedWhileBusy + "）",
      "耗时   单帧处理 " + g.lastProcessMs.toFixed(2) + " ms · 处理中 " + g.inFlight,
      "延迟   采集→渲染 " + (Number.isNaN(latencyMs) ? "—" : latencyMs.toFixed(1) + " ms"),
      "网络   " + (input.online ? "浏览器在线（本页不发请求）" : "浏览器离线"),
    ];

    ctx.font = HUD_FONT;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    const padX = 10;
    const padY = 8;
    const lineH = 16;
    let boxW = 0;
    for (const row of rows) boxW = Math.max(boxW, ctx.measureText(row).width);
    const boxH = rows.length * lineH + padY * 2;
    const x = 12;
    const y = 12;

    ctx.fillStyle = "rgba(8, 11, 15, 0.62)";
    roundRect(ctx, x, y, boxW + padX * 2, boxH, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, boxW + padX * 2, boxH, 8);
    ctx.stroke();

    rows.forEach((row, i) => {
      ctx.fillStyle = i === rows.length - 1 ? "rgba(147, 161, 177, 1)" : "rgba(232, 237, 243, 0.94)";
      ctx.fillText(row, x + padX, y + padY + i * lineH);
    });
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
