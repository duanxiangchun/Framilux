import type { DevicePose } from "../core/contracts";

/**
 * 设备姿态（IMU 的 Web 等价物）。
 *
 * 桌面浏览器根本没有这个事件（source 保持 "none"），
 * 此时 R2 水平规则自动置 0 权重而不是假装水平（docs/04 §8）。
 * 手机浏览器上 gamma 对应左右倾斜（roll），beta-90 对应前后俯仰（pitch）。
 */
export class DevicePoseSource {
  private readonly pose: DevicePose = { rollDeg: 0, pitchDeg: 0, yawDeg: 0, source: "none" };
  private handler: ((e: DeviceOrientationEvent) => void) | null = null;
  private permission: "unknown" | "granted" | "denied" = "unknown";

  get current(): DevicePose {
    return this.pose;
  }

  get permissionState(): string {
    return this.permission;
  }

  /** iOS 13+ 需要用户手势里申请权限；其它平台直接监听 */
  static async requestPermission(): Promise<boolean> {
    const anyEvent = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof anyEvent.requestPermission !== "function") return true;
    try {
      return (await anyEvent.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.handler) return;
    this.handler = (e: DeviceOrientationEvent) => {
      if (e.gamma === null && e.beta === null) return;
      // 顺时针为正（docs/04 §1）：gamma 为正表示机身向右压
      this.pose.rollDeg = Number.isFinite(e.gamma as number) ? (e.gamma as number) : 0;
      this.pose.pitchDeg = Number.isFinite(e.beta as number) ? (e.beta as number) - 90 : 0;
      this.pose.yawDeg = Number.isFinite(e.alpha as number) ? (e.alpha as number) : 0;
      this.pose.source = "imu";
      this.permission = "granted";
    };
    window.addEventListener("deviceorientation", this.handler, true);
  }

  stop(): void {
    if (!this.handler) return;
    window.removeEventListener("deviceorientation", this.handler, true);
    this.handler = null;
    this.pose.source = "none";
  }
}
