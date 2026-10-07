/**
 * L0 采集层（Web 等价物）：getUserMedia 取流。
 *
 * 职责边界：只负责"拿到流 + 给出采集时刻时间戳"。
 * 节流与丢帧在 FrameGate（L1），叠加层在 render/（L4）。
 *
 * 时间戳约定（docs/04 §2 / docs/06 §7 坑 7）：tsNs 记**采集时刻**，
 * 不是推理完成时刻。Chrome 下用 requestVideoFrameCallback 的
 * presentationTime（与 performance.now() 同时间基）近似采集时刻；
 * 不支持则退化为"读取帧时的 performance.now()"。
 */

export type FacingMode = "user" | "environment";

export interface CameraSourceOptions {
  facingMode?: FacingMode;
  /** 理想采集分辨率；实际以 track.getSettings() 为准 */
  width?: number;
  height?: number;
  frameRate?: number;
}

export interface StreamInfo {
  width: number;
  height: number;
  frameRate: number;
  deviceId?: string;
  label?: string;
  facingMode: FacingMode;
}

/** 摄像头错误 → 人话（面向用户，非 debug 文案） */
export class CameraError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "CameraError";
  }
}

function describeError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "浏览器拒绝了摄像头权限。请允许访问摄像头后重试；若地址栏显示不安全，请用 http://127.0.0.1:5173 打开。";
    case "NotFoundError":
    case "OverconstrainedError":
      return "没有找到可用的摄像头设备。";
    case "NotReadableError":
      return "摄像头被其它程序占用（例如会议软件）。关掉占用它的程序后重试。";
    default:
      return "打开摄像头失败：" + (err instanceof Error ? err.message : String(err));
  }
}

export class CameraSource {
  private stream: MediaStream | null = null;
  private rvfcHandle: number | null = null;
  private latestPresentationMs = 0;
  private streamInfo: StreamInfo | null = null;

  constructor(readonly video: HTMLVideoElement) {}

  get info(): StreamInfo | null {
    return this.streamInfo;
  }

  /**
   * 当前帧的采集时刻，单调时钟纳秒。
   * 未收到任何视频帧时退化为当前时刻（仅用于让 HUD 有值，不代表真实延迟）。
   */
  get captureTsNs(): number {
    const ms = this.latestPresentationMs > 0 ? this.latestPresentationMs : performance.now();
    return Math.round(ms * 1e6);
  }

  /** 是否已经收到过至少一帧视频帧回调 */
  get hasFrameTiming(): boolean {
    return this.latestPresentationMs > 0;
  }

  async start(opts: CameraSourceOptions = {}): Promise<StreamInfo> {
    this.stop();

    const facingMode: FacingMode = opts.facingMode ?? "user";
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: opts.width ?? 1280 },
        height: { ideal: opts.height ?? 720 },
        frameRate: { ideal: opts.frameRate ?? 30 },
      },
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      throw new CameraError(describeError(err), err);
    }

    this.stream = stream;
    this.video.srcObject = stream;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new CameraError("视频元素加载媒体流失败。"));
      };
      const cleanup = () => {
        this.video.removeEventListener("loadedmetadata", onLoaded);
        this.video.removeEventListener("error", onError);
      };
      if (this.video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        cleanup();
        resolve();
        return;
      }
      this.video.addEventListener("loadedmetadata", onLoaded, { once: true });
      this.video.addEventListener("error", onError, { once: true });
    });

    await this.video.play().catch(() => {
      /* 自动播放被拦截时由用户手势触发；此处不致命 */
    });

    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    this.streamInfo = {
      width: settings.width ?? this.video.videoWidth,
      height: settings.height ?? this.video.videoHeight,
      frameRate: Math.round(settings.frameRate ?? 0),
      deviceId: settings.deviceId,
      label: track?.label,
      facingMode,
    };

    this.subscribeFrameTiming();
    return this.streamInfo;
  }

  stop(): void {
    if (this.rvfcHandle !== null) {
      this.video.cancelVideoFrameCallback?.(this.rvfcHandle);
      this.rvfcHandle = null;
    }
    this.latestPresentationMs = 0;
    this.streamInfo = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  /** 订阅视频帧回调，仅用于记录"最近一帧的采集时刻" */
  private subscribeFrameTiming(): void {
    const video = this.video;
    // 运行时判定：个别浏览器没有 rVFC，退化为"读取帧时的 performance.now()"
    if (typeof video.requestVideoFrameCallback !== "function") return;
    const onFrame = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata): void => {
      this.latestPresentationMs = metadata.presentationTime || performance.now();
      this.rvfcHandle = video.requestVideoFrameCallback(onFrame);
    };
    this.rvfcHandle = video.requestVideoFrameCallback(onFrame);
  }
}
