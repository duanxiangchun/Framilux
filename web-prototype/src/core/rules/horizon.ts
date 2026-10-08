import type { Advice, CompositionRule, PerceptionFrame, RuleResult, SceneWeights } from "../contracts";
import { clamp01 } from "../math";

/**
 * R2 水平矫正。
 * 融合规则（docs/03 R2）：有地平线检测时以视觉为准，否则用 IMU。
 * M1 未接直线检测（M-LSD 属 M3），因此只用 IMU / 设备姿态；没有传感器时该规则权重置 0（docs/04 §8）。
 */
export const horizonRule: CompositionRule = {
  id: "horizon",
  title: "R2 水平矫正",
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult {
    const tilt = f.devicePose.rollDeg;
    if (f.devicePose.source !== "imu" || !Number.isFinite(tilt)) {
      return {
        ruleId: "horizon",
        score: 0,
        weight: 0,
        advice: null,
        available: false,
        detail: "无姿态传感器（桌面浏览器常见）；M3 接直线检测后可视觉兜底",
      };
    }
    const score = clamp01(1 - Math.abs(tilt) / 6);

    let advice: Advice | null = null;
    // |tilt| > 3° 强制高优先级提示（docs/03 R2），顺时针为正
    if (Math.abs(tilt) > 3) {
      advice = {
        priority: 10,
        textKey: tilt > 0 ? "advice.horizon.ccw" : "advice.horizon.cw",
        args: { deg: Math.abs(tilt) },
        action: { kind: "roll", deg: -tilt },
      };
    }
    return {
      ruleId: "horizon",
      score,
      weight: w.horizon ?? 0,
      available: true,
      advice,
      detail: `tilt=${tilt.toFixed(2)}°（IMU）`,
    };
  },
};
