import type { CompositionRule } from "../contracts";
import { balanceRule, headroomRule, leadRoomRule, subjectRatioRule, thirdsRule } from "./composition";
import { horizonRule } from "./horizon";
import { clippingRule, exposureRule } from "./light";

/** M1 实现的 R1–R6 + R10 + R11（docs/05 M1）。新增规则按 docs/06 §4 的五步流程走 */
export const RULES: CompositionRule[] = [
  thirdsRule,
  horizonRule,
  subjectRatioRule,
  headroomRule,
  leadRoomRule,
  balanceRule,
  exposureRule,
  clippingRule,
];

export { estimateFacing, thirdsRule, subjectRatioRule, headroomRule, leadRoomRule, balanceRule } from "./composition";
export { horizonRule } from "./horizon";
export { exposureRule, clippingRule } from "./light";
export { findSubject } from "./subject";
export type { Subject } from "./subject";
