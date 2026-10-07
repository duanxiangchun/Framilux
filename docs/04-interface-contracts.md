# 04 · 接口契约

本文件是三端（Android / Web / 未来 iOS）共享的**唯一契约**。改这里意味着改三端，必须同步 `contractVersion`。

- 当前版本：`0.1.0`
- 变更规则：新增字段为次要版本，语义或坐标系变更为主要版本

## 1. 坐标与单位约定（最重要的一条）

- 所有跨模块坐标：**归一化 `[0,1]`，原点左上**，x 沿宽、y 沿高，宽高各自归一化
- 距离比较前必须先乘画面宽高比再求范数（见 `03` R1）
- 角度单位一律**度**，顺时针为正
- 时间戳一律**单调时钟纳秒**（Android `SystemClock.elapsedRealtimeNanos`，Web `performance.now()*1e6`）
- 亮度/概率一律 `[0,1]`，不做 0–255

## 2. 感知层输出：PerceptionFrame

```kotlin
data class PerceptionFrame(
    val tsNs: Long,                 // 采集时刻（不是推理完成时刻）
    val contractVersion: String,
    val frameSize: Size,            // 采集分辨率，仅用于换算，不用于传递像素坐标
    val devicePose: DevicePose,     // 与 tsNs 对齐的 IMU 插值结果
    val lens: LensInfo,
    val faces: List<FaceBox>,
    val pose: BodyPose?,
    val saliency: SaliencyMap?,
    val lines: List<LineSeg>,
    val scene: SceneProfile,
    val light: LightStats,
    val depth: DepthInfo? = null,   // 慢通路，可能为空或过期
    val staleMs: Long = 0           // 慢通路数据的新鲜度
)

data class DevicePose(val rollDeg: Float, val pitchDeg: Float, val yawDeg: Float)
data class LensInfo(val equivFocalMm: Float, val zoomRatio: Float, val fovDeg: Float)

data class FaceBox(
    val rect: NormRect,
    val landmarks: List<NormPoint>, // 5 点：双眼、鼻、双嘴角
    val score: Float,
    val yawDeg: Float? = null       // 来自 6DRepNet 或几何估计，可空
)

data class BodyPose(val keypoints: List<NormPoint>, val scores: List<Float>) // 17 点，COCO 顺序

data class SaliencyMap(val w: Int, val h: Int, val data: FloatArray) // [0,1]，行优先

data class LineSeg(val start: NormPoint, val end: NormPoint, val score: Float)

data class SceneProfile(
    val topLabels: List<Pair<String, Float>>, // "portrait" / "landscape" / ...
    val profile: SceneKind,                   // 内部映射后的画像
    val confidence: Float
)

data class LightStats(
    val meanLuma: Float, val highlightClipRatio: Float, val shadowClipRatio: Float,
    val colorTempK: Float, val faceMeanLuma: Float?, val faceLeftRightDiff: Float?,
    val backlightRatio: Float?      // 背景/人脸亮度比
)

data class DepthInfo(val w: Int, val h: Int, val data: FloatArray, val isMetric: Boolean)

data class NormRect(val l: Float, val t: Float, val r: Float, val b: Float) {
    val w get() = r - l
    val h get() = b - t
    val center get() = NormPoint((l + r) / 2f, (t + b) / 2f)
    val area get() = w * h
}
data class NormPoint(val x: Float, val y: Float)
```

## 3. 感知层接口

```kotlin
interface Perceptor<O> {
    val id: String
    val requiredInput: InputBucket          // BUCKET_384 / 256 / 224
    val estimatedMs: Int                    // 用于预算调度
    fun load(registry: ModelRegistry): Boolean   // 失败返回 false，不抛异常
    suspend fun infer(bucket: TensorBucket, tsNs: Long): O?
    fun release()
}

class PerceptionBus(
    private val perceivers: List<Perceptor<*>>,
    private val dispatcher: InferenceDispatcher   // 串行 GPU 队列
) {
    /** 发布最新快照；慢通路结果由 merge 注入。不返回结果，通过 latest 读取。 */
    fun submit(bucket: TensorBucket, tsNs: Long)
    val latest: PerceptionFrame?                  // 原子读
    fun mergeSlow(depth: DepthInfo?, normal: NormalInfo?)
}
```

## 4. 决策层接口（纯逻辑，可单测）

```kotlin
interface CompositionRule {
    val id: String                                  // 与 docs/03 的 R 编号对应
    fun evaluate(f: PerceptionFrame, weights: SceneWeights): RuleResult
}

data class RuleResult(
    val ruleId: String,
    val score: Float,                // [0,1]
    val weight: Float,               // 来自场景画像
    val advice: Advice?,             // 可选建议
    val overlays: List<Overlay> = emptyList()
)

data class Advice(
    val priority: Int,               // 越小越优先（水平=10, 光=20, 位置=30, 占比=40, 风格=50）
    val textKey: String,             // 本地化 key，禁止硬编码文案
    val args: Map<String, Float>,
    val action: GuidanceAction
)

sealed interface GuidanceAction {
    data class Pan(val dir: Dir, val magnitude: Float) : GuidanceAction
    data class Tilt(val dir: Dir, val magnitude: Float) : GuidanceAction
    data class Zoom(val dir: Dir, val magnitude: Float) : GuidanceAction
    data class Roll(val deg: Float) : GuidanceAction
    data object Hold : GuidanceAction               // 构图已好，可以拍
}

class ScoreEngine(private val rules: List<CompositionRule>) {
    fun score(f: PerceptionFrame, w: SceneWeights): ScoreBreakdown
}

data class ScoreBreakdown(
    val total01: Float,              // Σw·f / Σw
    val display: Float,              // 1..5，映射公式见 docs/03 §4
    val perRule: Map<String, RuleResult>
)

class GuidanceSolver {
    fun solve(b: ScoreBreakdown, f: PerceptionFrame): Guidance
}

data class Guidance(
    val displayScore: Float,
    val mainAdvice: Advice?,         // 每帧只出一条
    val subjectBox: NormRect?,
    val targetBox: NormRect?,        // 建议主体位置（虚影框）
    val arrow: Arrow?, val horizonTiltDeg: Float,
    val zoomHint: ZoomHint,
    val overlays: List<Overlay>
)
```

## 5. 平滑与发布

```kotlin
class GuidanceSmoother(private val cfg: SmoothConfig) {
    /** EMA + 迟滞 + 最短展示时长；输出不可变快照供 UI 以 30–60fps 读取 */
    fun push(g: Guidance, tsNs: Long): GuidanceSnapshot
    val latest: GuidanceSnapshot?
}

data class SmoothConfig(
    val emaAlpha: Float = 0.35f,
    val switchMargin: Float = 0.08f,
    val minAdviceMs: Long = 1200,
    val readyHoldMs: Long = 1500,
    val readyThreshold: Float = 4.2f,
    val staleFrameMs: Long = 200
)
```

## 6. 渲染层接口

```kotlin
interface GuidanceRenderer {
    fun render(snapshot: GuidanceSnapshot)      // UI 线程，只读快照
    fun setDebugVisible(visible: Boolean)       // debug 构建才有意义
}
```

叠加元素类型：`ThirdsGrid` / `HorizonLevel` / `SubjectBox` / `TargetGhost` / `Arrow` / `LeadingLine` / `SymmetryAxis` / `PoseGhost` / `AdviceText` / `ScoreBadge`。

## 7. Web 原型的等价契约（TypeScript）

```ts
export type NormRect = { l: number; t: number; r: number; b: number };
export type NormPoint = { x: number; y: number };

export interface PerceptionFrame {
  tsNs: number;
  contractVersion: string;
  devicePose: { rollDeg: number; pitchDeg: number; yawDeg: number };
  faces: { rect: NormRect; score: number }[];
  pose?: { keypoints: NormPoint[] };
  saliency?: { w: number; h: number; data: Float32Array };
  lines: { start: NormPoint; end: NormPoint; score: number }[];
  scene: { profile: SceneKind; confidence: number };
  light: LightStats;
}

export interface CompositionRule {
  id: string;
  evaluate(f: PerceptionFrame, w: SceneWeights): RuleResult;
}
```

Web 端**必须实现同一套规则**，这样权重调好后可直接搬到 Android，反之亦然。两份实现的输出用同一组固定输入做回归对比（见 M1 验收）。

## 8. 错误处理约定

| 情况 | 行为 |
|---|---|
| 模型加载失败 | `Perceptor.load` 返回 false；该规则自动降权为 0，debug 面板红标；**不崩溃** |
| 推理超时（> budget×3） | 丢弃本次结果，保留上一快照；连续 5 次触发降档（见 `01` §11） |
| 慢通路长时间无结果 | `depth/normal` 置空，依赖它的规则（光位的高级部分）退化为直方图近似 |
| 感知结果为空（无脸无显著） | 只跑几何规则（三分/水平/曝光），文案降级为"移动手机找找主体" |
| 坐标系异常（越界/NaN） | 丢弃该帧并计数，连续异常上报 debug |

## 9. 线程契约

- `PerceptionBus.latest` / `GuidanceSmoother.latest`：**原子读，允许读到旧值**，不允许阻塞
- `Perceptor.infer`：suspend，必须在专用 dispatcher 上执行；**禁止在 UI 线程调用**
- `GuidanceRenderer.render`：只在 UI 线程
- 决策层（`ScoreEngine`/`GuidanceSolver`）：纯函数式，无内部可变状态，可任意线程调用
