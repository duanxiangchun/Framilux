import { FaceLandmarker, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { BodyPose, FaceBox, NormPoint } from "../core/contracts";

/**
 * L2 感知：MediaPipe Tasks Vision（docs/06 §2 步骤 3）。
 *
 * 资源全部走本地（public/mediapipe/wasm 与 public/models），运行时零网络请求。
 * GPU delegate 在无 GPU 的环境（headless / 老机器）会创建失败，此时回落到 CPU
 * —— 对应 docs/06 §7「GPU 算子回落」那条坑：回落后必须让用户看得见（debug 面板标 CPU）。
 */
export interface PerceptorTiming {
  id: string;
  ms: number;
  ok: boolean;
  note?: string;
}

export type Delegate = "GPU" | "CPU" | "none";

export interface PerceptionCapabilities {
  face: boolean;
  pose: boolean;
  delegate: Delegate;
  errors: string[];
}

/** 只取决策层用得到的 5 个点：鼻、双眼中点、双嘴角 */
const FACE_CHEEK_A = 234;
const FACE_CHEEK_B = 454;
const FACE_NOSE = 1;

/** MediaPipe Pose(33) → COCO-17 的索引映射（docs/04 §2 约定：姿态一律 COCO 顺序） */
const POSE_TO_COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export class MediaPipePerceptor {
  private face: FaceLandmarker | null = null;
  private pose: PoseLandmarker | null = null;
  private readonly caps: PerceptionCapabilities;

  private constructor(caps: PerceptionCapabilities) {
    this.caps = caps;
  }

  static async create(wasmPath = "/mediapipe/wasm", modelsPath = "/models"): Promise<MediaPipePerceptor> {
    const caps: PerceptionCapabilities = { face: false, pose: false, delegate: "none", errors: [] };
    const fileset = await FilesetResolver.forVisionTasks(wasmPath);

    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        caps.face = false;
        caps.pose = false;
        const face = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${modelsPath}/face_landmarker.task`, delegate },
          runningMode: "VIDEO",
          numFaces: 2,
        });
        const pose = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${modelsPath}/pose_landmarker_lite.task`, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        caps.delegate = delegate;
        caps.face = true;
        caps.pose = true;
        const inst = new MediaPipePerceptor(caps);
        inst.face = face;
        inst.pose = pose;
        return inst;
      } catch (err) {
        caps.errors.push(`${delegate}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return new MediaPipePerceptor(caps);
  }

  get capabilities(): PerceptionCapabilities {
    return this.caps;
  }

  /** 同步推理：调用方（FrameGate）已保证串行，此处只负责计时与坐标归一化 */
  analyze(video: HTMLVideoElement, tsMs: number): { faces: FaceBox[]; pose: BodyPose | null; timings: PerceptorTiming[] } {
    const timings: PerceptorTiming[] = [];
    let faces: FaceBox[] = [];
    let pose: BodyPose | null = null;

    if (this.face) {
      const t0 = performance.now();
      try {
        const res = this.face.detectForVideo(video, tsMs);
        faces = (res.faceLandmarks ?? []).map((lm) => toFaceBox(lm));
        timings.push({ id: "face", ms: performance.now() - t0, ok: true, note: `${faces.length} 张脸 · ${this.caps.delegate}` });
      } catch (err) {
        timings.push({ id: "face", ms: performance.now() - t0, ok: false, note: err instanceof Error ? err.message : String(err) });
      }
    } else {
      timings.push({ id: "face", ms: 0, ok: false, note: "未加载" });
    }

    if (this.pose) {
      const t0 = performance.now();
      try {
        const res = this.pose.detectForVideo(video, tsMs);
        const lms = res.landmarks?.[0];
        if (lms && lms.length >= 29) {
          const keypoints: NormPoint[] = [];
          const scores: number[] = [];
          for (const src of POSE_TO_COCO) {
            const p = lms[src];
            keypoints.push({ x: p.x, y: p.y });
            scores.push(p.visibility ?? 1);
          }
          pose = { keypoints, scores };
        }
        timings.push({ id: "pose", ms: performance.now() - t0, ok: true, note: pose ? "33→17 点已映射" : "未检出" });
      } catch (err) {
        timings.push({ id: "pose", ms: performance.now() - t0, ok: false, note: err instanceof Error ? err.message : String(err) });
      }
    } else {
      timings.push({ id: "pose", ms: 0, ok: false, note: "未加载" });
    }

    return { faces, pose, timings };
  }

  close(): void {
    this.face?.close();
    this.pose?.close();
    this.face = null;
    this.pose = null;
  }
}

function toFaceBox(lm: { x: number; y: number }[]): FaceBox {
  let l = 1;
  let t = 1;
  let r = 0;
  let b = 0;
  for (const p of lm) {
    if (p.x < l) l = p.x;
    if (p.x > r) r = p.x;
    if (p.y < t) t = p.y;
    if (p.y > b) b = p.y;
  }
  // 轮廓点比检测框紧，留一点余量更符合"人脸框"的直觉
  const pad = 0.012;
  return {
    rect: { l: Math.max(0, l - pad), t: Math.max(0, t - pad), r: Math.min(1, r + pad), b: Math.min(1, b + pad) },
    landmarks: [],
    score: 0.9,
    yawDeg: estimateYaw(lm),
  };
}

/**
 * 头部偏转的粗略估计：鼻子相对两侧颊点的归一化偏移。
 * 正值 = 头转向**画面右侧**（纯图像空间定义，与解剖学左右无关，避免镜像/前置摄像头的坑）。
 * 这是 M1 的近似值，debug 面板会把原始比值打出来，M4 再换 6DRepNet。
 */
function estimateYaw(lm: { x: number; y: number }[]): number {
  const a = lm[FACE_CHEEK_A];
  const b = lm[FACE_CHEEK_B];
  const nose = lm[FACE_NOSE];
  if (!a || !b || !nose) return 0;
  const width = Math.abs(a.x - b.x);
  if (width < 1e-4) return 0;
  const ratio = (nose.x - (a.x + b.x) / 2) / width;
  return Math.max(-60, Math.min(60, ratio * 90));
}
