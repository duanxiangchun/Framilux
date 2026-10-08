import type { GuidanceSnapshot, SceneKind, SceneWeights } from "../core/contracts";
import { IMPLEMENTED_RULES, SCENE_KINDS, SCENE_KIND_LABEL, SCENE_WEIGHTS, UNIMPLEMENTED_RULES } from "../core/scene-weights";
import type { PerceptionCapabilities, PerceptorTiming } from "../perception/mediapipe-perceptor";
import { LAYER_LABELS, type LayerToggles } from "../render/OverlayRenderer";

export interface DebugPanelCallbacks {
  onWeightsChange(weights: SceneWeights): void;
  onProfileChange(kind: SceneKind | null): void;
  onLayersChange(layers: LayerToggles): void;
  onPauseChange(paused: boolean): void;
  onInjectFixture(): void;
  onEnableOrientation(): void;
}

export interface DebugStatus {
  snapshot: GuidanceSnapshot | null;
  adviceText: string;
  timings: PerceptorTiming[];
  capabilities: PerceptionCapabilities | null;
  gate: { targetFps: number; effectiveFps: number; seen: number; processed: number; droppedThrottle: number; droppedBusy: number; lastProcessMs: number };
  latencyMs: number | null;
  source: string;
  online: boolean;
  saliencyDegraded: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * debug 面板（docs/05 M1）：每模型耗时、每规则得分、权重滑块可实时改。
 * 只在 debug 构建启用（docs/01 §12 隐私约定）。
 */
export class DebugPanel {
  private readonly statusRows = new Map<string, HTMLElement>();
  private readonly timingRows = new Map<string, HTMLElement>();
  private readonly ruleRows = new Map<string, { score: HTMLElement; bar: HTMLElement; weight: HTMLElement; detail: HTMLElement; advice: HTMLElement }>();
  private readonly sliders = new Map<string, HTMLInputElement>();
  private readonly adviceEl: HTMLElement;
  private readonly adviceSourceEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly scoreSubEl: HTMLElement;
  private readonly rulesBody: HTMLElement;
  private readonly capEl: HTMLElement;
  private layers: LayerToggles;
  private activeProfile: SceneKind | "auto" = "auto";

  constructor(private readonly root: HTMLElement, layers: LayerToggles, private readonly cb: DebugPanelCallbacks) {
    this.layers = { ...layers };

    // ---- 状态 ----
    const secStatus = this.section("运行状态");
    for (const key of ["取流", "节流", "丢帧", "单帧处理", "采集→渲染", "感知后端", "网络"]) {
      const row = el("div", "row");
      row.append(el("span", "k", key), this.statusRows.set(key, el("span", "v", "—"))!.get(key)!);
      secStatus.append(row);
    }

    // ---- 模型耗时 ----
    const secTiming = this.section("模型耗时（ms）");
    for (const id of ["face", "pose", "light", "total"]) {
      const row = el("div", "row");
      const v = el("span", "v", "—");
      row.append(el("span", "k", TIMING_LABEL[id] ?? id), v);
      this.timingRows.set(id, v);
      secTiming.append(row);
    }

    // ---- 主建议 ----
    const secAdvice = this.section("当前主建议");
    this.adviceEl = el("div", "advice", "等待第一帧…");
    this.adviceSourceEl = el("div", "sub", "");
    secAdvice.append(this.adviceEl, this.adviceSourceEl);

    // ---- 评分 ----
    const secScore = this.section("构图评分");
    this.scoreEl = el("div", "score", "—");
    this.scoreSubEl = el("div", "sub", "");
    secScore.append(this.scoreEl, this.scoreSubEl);

    // ---- 规则明细 ----
    const secRules = this.section("规则明细（M1 已实现 8 条）");
    const table = el("div", "rules");
    const head = el("div", "rule-row rule-head");
    for (const [cls, text] of [["c1", "规则"], ["c2", "得分"], ["c3", "权重"], ["c4", "中间量"]] as const) {
      head.append(el("span", cls, text));
    }
    table.append(head);
    this.rulesBody = table;
    secRules.append(table);
    for (const id of IMPLEMENTED_RULES) {
      const row = el("div", "rule-row");
      const name = el("span", "c1", RULE_LABEL[id] ?? id);
      const scoreCell = el("span", "c2");
      const bar = el("i", "bar");
      scoreCell.append(bar);
      const scoreText = el("b", "num", "—");
      scoreCell.append(scoreText);
      const weight = el("span", "c3", "—");
      const detail = el("span", "c4", "");
      row.append(name, scoreCell, weight, detail);
      this.rulesBody.append(row);
      this.ruleRows.set(id, { score: scoreText, bar, weight, detail, advice: name });
    }
    for (const [id, why] of Object.entries(UNIMPLEMENTED_RULES)) {
      const row = el("div", "rule-row muted");
      row.append(el("span", "c1", RULE_LABEL[id] ?? id), el("span", "c4", why));
      this.rulesBody.append(row);
    }

    // ---- 权重滑块 ----
    const secWeights = this.section("权重（唯一可调参数，改完记得同步 docs/03 §3）");
    for (const id of IMPLEMENTED_RULES) {
      const row = el("div", "slider-row");
      const label = el("label", "k", RULE_LABEL[id] ?? id);
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "1.5";
      input.step = "0.05";
      input.value = String(SCENE_WEIGHTS.portrait[id] ?? 0);
      const out = el("span", "v", input.value);
      input.addEventListener("input", () => {
        out.textContent = input.value;
        this.cb.onWeightsChange(this.collectWeights());
      });
      label.append(input);
      row.append(label, out);
      this.sliders.set(id, input);
      secWeights.append(row);
    }

    // ---- 场景画像 ----
    const secScene = this.section("场景画像");
    const select = el("select");
    const auto = el("option", undefined, "自动（M1 启发式）");
    auto.value = "auto";
    select.append(auto);
    for (const kind of SCENE_KINDS) {
      const opt = el("option", undefined, SCENE_KIND_LABEL[kind]);
      opt.value = kind;
      select.append(opt);
    }
    select.addEventListener("change", () => {
      this.activeProfile = select.value === "auto" ? "auto" : (select.value as SceneKind);
      this.cb.onProfileChange(this.activeProfile === "auto" ? null : this.activeProfile);
      this.syncSlidersToProfile();
    });
    secScene.append(select);
    this.capEl = el("div", "sub", "");
    secScene.append(this.capEl);

    // ---- 图层与操作 ----
    const secLayers = this.section("叠加层与操作");
    const layerBox = el("div", "layers");
    for (const key of Object.keys(LAYER_LABELS) as (keyof LayerToggles)[]) {
      const wrap = el("label", "check");
      const input = el("input");
      input.type = "checkbox";
      input.checked = this.layers[key];
      input.addEventListener("change", () => {
        this.layers[key] = input.checked;
        this.cb.onLayersChange({ ...this.layers });
      });
      wrap.append(input, el("span", undefined, LAYER_LABELS[key]));
      layerBox.append(wrap);
    }
    secLayers.append(layerBox);

    const actions = el("div", "actions");
    const btnPause = el("button", undefined, "暂停推理");
    btnPause.addEventListener("click", () => {
      const paused = btnPause.textContent === "暂停推理";
      btnPause.textContent = paused ? "继续推理" : "暂停推理";
      this.cb.onPauseChange(paused);
    });
    const btnOrientation = el("button", undefined, "启用水平仪");
    btnOrientation.addEventListener("click", () => this.cb.onEnableOrientation());
    const btnInject = el("button", undefined, "注入模拟帧");
    btnInject.title = "不依赖摄像头，喂一组固定特征给规则引擎，用来验证打分与叠加层";
    btnInject.addEventListener("click", () => this.cb.onInjectFixture());
    actions.append(btnPause, btnOrientation, btnInject);
    secLayers.append(actions);

    this.root.append(secStatus, secTiming, secAdvice, secScore, secRules, secWeights, secScene, secLayers);
  }

  update(s: DebugStatus): void {
    const set = (key: string, value: string) => this.statusRows.get(key)?.replaceChildren(document.createTextNode(value));
    set("取流", s.source);
    set("节流", `目标 ${s.gate.targetFps} fps / 实际 ${s.gate.effectiveFps.toFixed(1)} fps`);
    set("丢帧", `共 ${s.gate.seen - s.gate.processed}（节流 ${s.gate.droppedThrottle} / 忙 ${s.gate.droppedBusy}）`);
    set("单帧处理", `${s.gate.lastProcessMs.toFixed(1)} ms`);
    set("采集→渲染", s.latencyMs === null ? "—" : `${s.latencyMs.toFixed(0)} ms`);
    set("感知后端", s.capabilities ? `MediaPipe ${s.capabilities.delegate}${s.saliencyDegraded ? " · 显著图降级" : ""}` : "未初始化");
    set("网络", s.online ? "浏览器在线（本页不发请求）" : "浏览器离线");

    for (const t of s.timings) {
      const node = this.timingRows.get(t.id);
      if (!node) continue;
      node.textContent = t.ok ? `${t.ms.toFixed(1)}${t.note ? " · " + t.note : ""}` : `不可用${t.note ? " · " + t.note : ""}`;
      node.className = t.ok ? "v" : "v bad";
    }

    const snap = s.snapshot;
    this.adviceEl.textContent = s.adviceText || "—";
    this.adviceSourceEl.textContent = snap?.mainAdvice
      ? `来源 ${RULE_LABEL[snap.mainRuleId ?? ""] ?? snap.mainRuleId ?? "求解器"} · 优先级 ${snap.mainAdvice.priority}`
      : "";

    if (snap) {
      this.scoreEl.textContent = snap.displayScore > 0 ? snap.displayScore.toFixed(1) : "—";
      this.scoreEl.className = "score " + scoreClass(snap.displayScore);
      const weightSum = snap.perRule.filter((r) => r.available && r.weight > 0).reduce((a, r) => a + r.weight, 0);
      this.scoreSubEl.textContent = `s01=${snap.total01.toFixed(3)} · 权重和 ${weightSum.toFixed(2)}${snap.ready ? " · 可以拍了" : ""}`;
    }

    for (const r of snap?.perRule ?? []) {
      const row = this.ruleRows.get(r.ruleId);
      if (!row) continue;
      row.score.textContent = r.available ? r.score.toFixed(2) : "N/A";
      row.bar.style.width = r.available ? `${Math.round(r.score * 100)}%` : "0%";
      row.bar.style.background = r.available ? (r.score > 0.8 ? "#3ddc84" : r.score > 0.5 ? "#ffd24d" : "#ff5c5c") : "#3a4550";
      row.weight.textContent = r.weight.toFixed(2);
      row.detail.textContent = r.detail ?? "";
    }
  }

  setCapabilities(caps: PerceptionCapabilities | null): void {
    if (!caps) {
      this.capEl.textContent = "感知层未初始化";
      return;
    }
    const problems: string[] = [];
    if (!caps.face) problems.push("人脸模型未加载");
    if (!caps.pose) problems.push("姿态模型未加载");
    this.capEl.textContent =
      problems.length > 0
        ? `⚠ ${problems.join("、")}（先跑 pnpm assets 拉本地模型）`
        : `MediaPipe 后端 ${caps.delegate} · 人脸 + 姿态就绪`;
  }

  /** 切换画像时把该画像的默认权重灌进滑块，并**立刻推给引擎**（只改 UI 不改权重是个坑） */
  syncSlidersToProfile(): void {
    const kind: SceneKind = this.activeProfile === "auto" ? "portrait" : this.activeProfile;
    const ref = SCENE_WEIGHTS[kind];
    for (const [id, input] of this.sliders) {
      input.value = String(ref[id] ?? 0);
      const out = input.parentElement?.parentElement?.querySelector(".v");
      if (out) out.textContent = input.value;
    }
    this.cb.onWeightsChange(this.collectWeights());
  }

  private collectWeights(): SceneWeights {
    const weights: SceneWeights = {};
    for (const [id, input] of this.sliders) weights[id] = Number(input.value);
    this.cb.onWeightsChange(weights);
    return weights;
  }

  private section(title: string): HTMLElement {
    const sec = el("section", "card");
    sec.append(el("h2", undefined, title));
    return sec;
  }
}

const TIMING_LABEL: Record<string, string> = {
  face: "人脸 landmark",
  pose: "姿态 landmark",
  light: "光照统计",
  total: "感知合计",
};

const RULE_LABEL: Record<string, string> = {
  thirds: "R1 三分",
  horizon: "R2 水平",
  subjectRatio: "R3 占比",
  headroom: "R4 头顶留白",
  leadRoom: "R5 朝向留白",
  balance: "R6 平衡",
  exposure: "R10 曝光",
  clipping: "R11 动态范围",
  leadingLines: "R7 引导线",
  symmetry: "R8 对称",
  lighting: "R9 光位",
  pose: "R12 姿态",
};

function scoreClass(score: number): string {
  if (score <= 0) return "";
  if (score < 2.5) return "s-bad";
  if (score < 3.5) return "s-warn";
  if (score < 4.2) return "s-mid";
  return "s-ok";
}
