import { describe, expect, it } from "vitest";
import { thirdsRule, subjectRatioRule, headroomRule, leadRoomRule, balanceRule } from "../rules/composition";
import { horizonRule } from "../rules/horizon";
import { clippingRule, exposureRule } from "../rules/light";
import { weightsFor } from "../scene-weights";
import { CENTER_BOX, THIRD_BOX, face, makeFrame, NO_IMU, saliencyAt, saliencyFlat, scene } from "./fixture";

const W = weightsFor("portrait");

describe("R1 三分点对齐", () => {
  it("主体压在三分交点 → 满分", () => {
    const r = thirdsRule.evaluate(makeFrame({ faces: [face(THIRD_BOX)] }), W);
    expect(r.available).toBe(true);
    expect(r.score).toBeCloseTo(1, 5);
    expect(r.advice).toBeNull();
  });

  it("主体居中 → 走中心构图豁免，不低于 0.85", () => {
    const r = thirdsRule.evaluate(makeFrame({ faces: [face(CENTER_BOX)] }), W);
    expect(r.score).toBeCloseTo(0.85, 5);
    expect(r.detail).toContain("中心构图豁免");
  });

  it("主体顶到左上角 → 分数归零并给出方向建议", () => {
    const r = thirdsRule.evaluate(makeFrame({ faces: [face({ l: 0, t: 0, r: 0.1, b: 0.1 })] }), W);
    expect(r.score).toBe(0);
    expect(r.advice?.priority).toBe(30);
    expect(["advice.pan.right", "advice.tilt.down"]).toContain(r.advice?.textKey);
  });

  it("没有主体 → 不可用、权重 0（不崩溃）", () => {
    const r = thirdsRule.evaluate(makeFrame(), W);
    expect(r.available).toBe(false);
    expect(r.weight).toBe(0);
  });
});

describe("R2 水平矫正", () => {
  it("无传感器 → 权重 0 且不参与打分", () => {
    const r = horizonRule.evaluate(makeFrame({ devicePose: NO_IMU }), W);
    expect(r.available).toBe(false);
    expect(r.weight).toBe(0);
  });

  it("roll=3° → 0.5；roll=0 → 1", () => {
    expect(horizonRule.evaluate(makeFrame({ devicePose: { rollDeg: 3, pitchDeg: 0, yawDeg: 0, source: "imu" } }), W).score).toBeCloseTo(0.5, 5);
    expect(horizonRule.evaluate(makeFrame(), W).score).toBeCloseTo(1, 5);
  });

  it("roll=4° → 优先级 10 的逆时针提示", () => {
    const r = horizonRule.evaluate(makeFrame({ devicePose: { rollDeg: 4, pitchDeg: 0, yawDeg: 0, source: "imu" } }), W);
    expect(r.advice?.priority).toBe(10);
    expect(r.advice?.textKey).toBe("advice.horizon.ccw");
    expect(r.advice?.args.deg).toBeCloseTo(4, 5);
  });
});

describe("R3 主体占比", () => {
  it("人像占比恰为 r*=0.18 → 满分", () => {
    const box = { l: 0.4, t: 0.4, r: 0.7, b: 1.0 }; // 面积 0.18
    const r = subjectRatioRule.evaluate(makeFrame({ faces: [face(box)] }), W);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it("主体太小 → 提示靠近", () => {
    const box = { l: 0.45, t: 0.45, r: 0.55, b: 0.65 }; // 面积 0.02
    const r = subjectRatioRule.evaluate(makeFrame({ faces: [face(box)] }), W);
    expect(r.score).toBeLessThan(0.2);
    expect(r.advice?.textKey).toBe("advice.zoom.in");
    expect(r.advice?.priority).toBe(40);
  });

  it("风景画像的最优占比更小（r*=0.06）", () => {
    const box = { l: 0.4, t: 0.4, r: 0.7, b: 0.6 }; // 面积 0.06
    const r = subjectRatioRule.evaluate(makeFrame({ faces: [face(box)], scene: scene("landscape") }), W);
    expect(r.score).toBeCloseTo(1, 5);
  });
});

describe("R4 头顶留白", () => {
  it("h=0.08 落在理想区间 → 满分", () => {
    const r = headroomRule.evaluate(makeFrame({ faces: [face({ l: 0.4, t: 0.08, r: 0.6, b: 0.4 })] }), W);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it("h=0.01 → 切头顶重罚 + 抬高提示", () => {
    const r = headroomRule.evaluate(makeFrame({ faces: [face({ l: 0.4, t: 0.01, r: 0.6, b: 0.4 })] }), W);
    expect(r.score).toBeCloseTo(0.2, 5);
    expect(r.advice?.textKey).toBe("advice.headroom.low");
  });

  it("h=0.30 → 留白过多 + 放低提示", () => {
    const r = headroomRule.evaluate(makeFrame({ faces: [face({ l: 0.4, t: 0.3, r: 0.6, b: 0.6 })] }), W);
    expect(r.score).toBeCloseTo(0.28, 5);
    expect(r.advice?.textKey).toBe("advice.headroom.high");
  });

  it("无人脸 → 不适用", () => {
    expect(headroomRule.evaluate(makeFrame(), W).available).toBe(false);
  });
});

describe("R5 朝向留白", () => {
  it("侧脸且前方留白充足 → 满分", () => {
    const r = leadRoomRule.evaluate(makeFrame({ faces: [face({ l: 0.1, t: 0.3, r: 0.3, b: 0.6 }, 25)] }), W);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it("正脸 → 权重降为 0.2（docs/03 R5）", () => {
    const r = leadRoomRule.evaluate(makeFrame({ faces: [face({ l: 0.1, t: 0.3, r: 0.3, b: 0.6 }, 0)] }), W);
    expect(r.weight).toBeCloseTo((W.leadRoom ?? 0) * 0.2, 5);
    expect(r.detail).toContain("正脸降权");
  });

  it("朝向判断不出来 → 不可用", () => {
    expect(leadRoomRule.evaluate(makeFrame({ faces: [face({ l: 0.1, t: 0.3, r: 0.3, b: 0.6 }, null)] }), W).available).toBe(false);
  });
});

describe("R6 视觉平衡", () => {
  it("显著质量均匀 → 质心居中 → 满分", () => {
    const r = balanceRule.evaluate(makeFrame({ saliency: saliencyFlat() }), W);
    expect(r.score).toBeCloseTo(1, 2);
  });

  it("显著质量挤在左上角 → 分数低", () => {
    const r = balanceRule.evaluate(makeFrame({ saliency: saliencyAt(0, 0) }), W);
    expect(r.score).toBeLessThan(0.5);
    expect(r.advice?.priority).toBe(50);
  });

  it("无显著图 → 降级用主体框中心，并在 detail 里标注", () => {
    const r = balanceRule.evaluate(makeFrame({ faces: [face({ l: 0.0, t: 0.4, r: 0.2, b: 0.6 })] }), W);
    expect(r.available).toBe(true);
    expect(r.detail).toContain("降级");
  });
});

describe("R10 曝光 / R11 动态范围", () => {
  it("人脸亮度 0.52 → 满分", () => {
    const f = makeFrame({ light: { ...makeFrame().light, faceMeanLuma: 0.52 } });
    expect(exposureRule.evaluate(f, W).score).toBeCloseTo(1, 5);
  });

  it("亮度 0.20 → 低分 + 偏暗提示", () => {
    const f = makeFrame({ light: { ...makeFrame().light, faceMeanLuma: 0.2 } });
    const r = exposureRule.evaluate(f, W);
    expect(r.score).toBeLessThan(0.1);
    expect(r.advice?.textKey).toBe("advice.exposure.dark");
  });

  it("背景比人脸亮 2 倍 → 逆光提示", () => {
    const f = makeFrame({ light: { ...makeFrame().light, faceMeanLuma: 0.4, backlightRatio: 2 } });
    expect(exposureRule.evaluate(f, W).advice?.textKey).toBe("advice.backlight");
  });

  it("高光溢出 3% → 0.4 分 + 提示", () => {
    const f = makeFrame({ light: { ...makeFrame().light, highlightClipRatio: 0.03 } });
    const r = clippingRule.evaluate(f, W);
    expect(r.score).toBeCloseTo(0.4, 5);
    expect(r.advice?.textKey).toBe("advice.clip.highlight");
  });

  it("死黑 8% → 0.6 分", () => {
    const f = makeFrame({ light: { ...makeFrame().light, shadowClipRatio: 0.08 } });
    expect(clippingRule.evaluate(f, W).score).toBeCloseTo(0.6, 5);
  });
});
