import type { GuidanceSnapshot, NormRect } from "../core/contracts";
import { THIRD_POINTS, THIRD_VALUES } from "../core/contracts";

/**
 * L4 引导渲染层：Canvas 2D 叠加层。
 *
 * 分工：**画面叠加在 canvas**，调试文字与滑块在 DOM 面板（ui/debug-panel.ts）——
 * 文字面板放 DOM 才能选中/滚动/拖滑块，也不必每帧重绘。
 *
 * 坐标约定（docs/04 §1）：内部一律归一化 [0,1]，像素换算只发生在本文件；
 * 画面用 object-fit: cover，叠加层必须用同一套 cover 映射，否则整体偏移。
 * 渲染以 60fps 读最新快照，与 10fps 的推理解耦（docs/01 §3）。
 */

export interface LayerToggles {
  thirds: boolean;
  horizon: boolean;
  subjectBox: boolean;
  targetGhost: boolean;
  arrow: boolean;
  advice: boolean;
  score: boolean;
}

export const DEFAULT_LAYERS: LayerToggles = {
  thirds: true,
  horizon: true,
  subjectBox: true,
  targetGhost: true,
  arrow: true,
  advice: true,
  score: true,
};

export const LAYER_LABELS: Record<keyof LayerToggles, string> = {
  thirds: "三分线",
  horizon: "水平仪",
  subjectBox: "主体框",
  targetGhost: "目标虚影框",
  arrow: "箭头",
  advice: "单句建议",
  score: "评分徽章",
};

export interface RenderInput {
  videoW: number;
  videoH: number;
  mirrored: boolean;
  snapshot: GuidanceSnapshot | null;
  adviceText: string;
  layers: LayerToggles;
}

export interface CoverLayout {
  offsetX: number;
  offsetY: number;
  drawW: number;
  drawH: number;
}

/** object-fit: cover 的等价映射（CSS 与 canvas 必须一致） */
export function computeCoverLayout(stageW: number, stageH: number, videoW: number, videoH: number): CoverLayout {
  if (videoW <= 0 || videoH <= 0 || stageW <= 0 || stageH <= 0) {
    return { offsetX: 0, offsetY: 0, drawW: stageW, drawH: stageH };
  }
  const scale = Math.max(stageW / videoW, stageH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  return { offsetX: (stageW - drawW) / 2, offsetY: (stageH - drawH) / 2, drawW, drawH };
}

const COLOR = {
  grid: "rgba(255,255,255,0.85)",
  gridHalo: "rgba(0,0,0,0.35)",
  subject: "#4da3ff",
  target: "#ffd24d",
  ok: "#3ddc84",
  warn: "#ffd24d",
  bad: "#ff5c5c",
};

export class OverlayRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private layout: CoverLayout = { offsetX: 0, offsetY: 0, drawW: 0, drawH: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法获取 2D 上下文");
    this.ctx = ctx;
  }

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
    const px = (u: number): number => this.layout.offsetX + (input.mirrored ? 1 - u : u) * this.layout.drawW;
    const py = (v: number): number => this.layout.offsetY + v * this.layout.drawH;

    if (input.layers.thirds) this.drawThirds(px, py);

    const snap = input.snapshot;
    if (snap) {
      if (input.layers.subjectBox && snap.subjectBox) this.drawRect(px, py, snap.subjectBox, COLOR.subject, "solid", "主体");
      if (input.layers.targetGhost && snap.targetBox) this.drawRect(px, py, snap.targetBox, COLOR.target, "dashed", "目标");
      if (input.layers.arrow && snap.arrow && snap.subjectBox && snap.targetBox) this.drawArrow(px, py, snap.subjectBox, snap.targetBox);
      if (input.layers.horizon && snap.horizonTiltDeg !== null) this.drawHorizon(snap.horizonTiltDeg, input.mirrored);
      if (snap.zoomHint !== "ok" && input.layers.subjectBox && snap.subjectBox) {
        this.drawZoomHint(px, py, snap.subjectBox, snap.zoomHint);
      }
      if (input.layers.score) this.drawScoreBadge(snap);
    }
    if (input.layers.advice && input.adviceText) this.drawAdvice(input.adviceText, snap?.mainAdvice?.priority ?? 99);
  }

  /* ------------------------------- 三分线 ------------------------------- */
  private drawThirds(px: (u: number) => number, py: (v: number) => number): void {
    const ctx = this.ctx;
    const top = this.layout.offsetY;
    const bottom = this.layout.offsetY + this.layout.drawH;
    const left = this.layout.offsetX;
    const right = this.layout.offsetX + this.layout.drawW;

    for (const pass of [
      { width: 3.5, color: COLOR.gridHalo },
      { width: 1.25, color: COLOR.grid },
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

    ctx.fillStyle = COLOR.grid;
    for (const p of THIRD_POINTS) {
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawRect(
    px: (u: number) => number,
    py: (v: number) => number,
    r: NormRect,
    color: string,
    style: "solid" | "dashed",
    label: string,
  ): void {
    const ctx = this.ctx;
    const x = Math.min(px(r.l), px(r.r));
    const y = Math.min(py(r.t), py(r.b));
    const w = Math.abs(px(r.r) - px(r.l));
    const h = Math.abs(py(r.b) - py(r.t));

    ctx.save();
    ctx.setLineDash(style === "dashed" ? [8, 6] : []);
    ctx.lineWidth = style === "dashed" ? 2 : 2.5;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    // 角标
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    const c = Math.min(14, w / 4, h / 4);
    ctx.beginPath();
    ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
    ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
    ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
    ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
    ctx.stroke();
    ctx.restore();

    ctx.font = '12px system-ui, "Microsoft YaHei", sans-serif';
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillStyle = color;
    ctx.fillText(label, x, y - 3);
  }

  private drawArrow(
    px: (u: number) => number,
    py: (v: number) => number,
    subject: NormRect,
    target: NormRect,
  ): void {
    const ctx = this.ctx;
    const from = { x: px((subject.l + subject.r) / 2), y: py((subject.t + subject.b) / 2) };
    const to = { x: px((target.l + target.r) / 2), y: py((target.t + target.b) / 2) };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 6) return;

    ctx.save();
    ctx.strokeStyle = COLOR.target;
    ctx.fillStyle = COLOR.target;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    const ang = Math.atan2(dy, dx);
    const head = 14;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(ang - 0.4), to.y - head * Math.sin(ang - 0.4));
    ctx.lineTo(to.x - head * Math.cos(ang + 0.4), to.y - head * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 水平仪：固定参考线 + 随倾角旋转的实际水平线（镜像时角度要反号） */
  private drawHorizon(tiltDeg: number, mirrored: boolean): void {
    const ctx = this.ctx;
    const cx = this.layout.offsetX + this.layout.drawW / 2;
    const cy = this.layout.offsetY + this.layout.drawH / 2;
    const half = this.layout.drawW * 0.42;
    const color = Math.abs(tiltDeg) < 1 ? COLOR.ok : Math.abs(tiltDeg) < 3 ? COLOR.warn : COLOR.bad;
    const angle = ((mirrored ? -tiltDeg : tiltDeg) * Math.PI) / 180;

    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy);
    ctx.lineTo(cx + half, cy);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    ctx.lineTo(half, 0);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  private drawZoomHint(
    px: (u: number) => number,
    py: (v: number) => number,
    r: NormRect,
    hint: "in" | "out",
  ): void {
    const ctx = this.ctx;
    void px;
    void py;
    const x = Math.min(px(r.l), px(r.r));
    const y = Math.min(py(r.t), py(r.b));
    const w = Math.abs(px(r.r) - px(r.l));
    const h = Math.abs(py(r.b) - py(r.t));
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR.target;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy);
    ctx.lineTo(cx + 7, cy);
    if (hint === "in") {
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx, cy + 7);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawScoreBadge(snap: GuidanceSnapshot): void {
    const ctx = this.ctx;
    const score = snap.displayScore;
    const color = score < 2.5 ? COLOR.bad : score < 3.5 ? "#ff9f43" : score < 4.2 ? COLOR.warn : COLOR.ok;
    const cx = this.cssW - 52;
    const cy = 52;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(8,11,15,0.66)";
    ctx.fill();
    ctx.lineWidth = snap.ready ? 5 : 3;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 26px ui-monospace, Consolas, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(score.toFixed(1), cx, cy + 1);

    ctx.font = '11px system-ui, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = "rgba(232,237,243,0.75)";
    ctx.fillText("构图分", cx, cy + 42);

    if (snap.ready) {
      ctx.font = 'bold 13px system-ui, "Microsoft YaHei", sans-serif';
      ctx.fillStyle = COLOR.ok;
      ctx.fillText("可以拍了", cx, cy + 60);
    }
    ctx.restore();
  }

  private drawAdvice(text: string, priority: number): void {
    const ctx = this.ctx;
    ctx.font = 'bold 15px system-ui, "Microsoft YaHei", sans-serif';
    const padX = 14;
    const padY = 9;
    const w = ctx.measureText(text).width + padX * 2;
    const h = 15 + padY * 2;
    const x = (this.cssW - w) / 2;
    const y = this.cssH - h - 26;
    const color = priority <= 20 ? COLOR.bad : priority <= 40 ? COLOR.warn : COLOR.ok;

    ctx.save();
    ctx.fillStyle = "rgba(8,11,15,0.72)";
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 10);
    ctx.stroke();

    ctx.fillStyle = "rgba(240,245,250,0.96)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, this.cssW / 2, y + h / 2 + 0.5);
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
