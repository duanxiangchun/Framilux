import type { Advice } from "./contracts";

/**
 * 中文文案表（docs/06 §4：文案不硬编码，一律走 textKey + 本地化资源）。
 * args 只承载数值，需要方向的场景拆成两个 key，避免在文案里做逻辑。
 */
export type TextTemplate = (args: Record<string, number>) => string;

export const TEXTS_ZH: Record<string, TextTemplate> = {
  "advice.subject.missing": () => "移动手机找找主体",

  "advice.horizon.cw": (a) => `顺时针微调 ${fmtDeg(a.deg)}°`,
  "advice.horizon.ccw": (a) => `逆时针微调 ${fmtDeg(a.deg)}°`,

  "advice.backlight": () => "逆光，转身或给脸补光",
  "advice.exposure.dark": () => "画面偏暗，加点曝光或换个朝向",
  "advice.exposure.bright": () => "画面偏亮，稍微避开光源",
  "advice.clip.highlight": () => "高光溢出，避开直射光源",
  "advice.clip.shadow": () => "暗部死黑，避开强逆光",

  "advice.pan.left": (a) => `向左平移一点${mag(a.magnitude)}`,
  "advice.pan.right": (a) => `向右平移一点${mag(a.magnitude)}`,
  "advice.tilt.up": (a) => `手机抬高一点${mag(a.magnitude)}`,
  "advice.tilt.down": (a) => `手机放低一点${mag(a.magnitude)}`,

  "advice.zoom.in": () => "靠近一点，主体再大些",
  "advice.zoom.out": () => "退后一点，主体别太满",

  "advice.headroom.low": () => "头顶被切了，手机抬高一点",
  "advice.headroom.high": () => "头顶留白太多，靠近或放低手机",

  "advice.leadRoom": () => "往人物面向的一侧挪一点",
  "advice.balance": () => "主体偏了，往画面重心挪一点",

  "advice.hold": () => "构图不错，可以按快门",
};

function mag(v: number | undefined): string {
  if (typeof v !== "number") return "";
  if (v > 0.18) return "（幅度较大）";
  if (v > 0.1) return "";
  return "（一点点）";
}

function fmtDeg(v: number | undefined): string {
  return typeof v === "number" ? v.toFixed(0) : "?";
}

/** 渲染建议文案；未知 key 时回落显示 key 本身，便于发现漏配（不崩溃） */
export function renderAdviceText(advice: Advice | null): string {
  if (!advice) return "";
  const tpl = TEXTS_ZH[advice.textKey];
  return tpl ? tpl(advice.args) : advice.textKey;
}
