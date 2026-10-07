# 02 · 感知层模型选型

## 1. 选型判据（按优先级）

1. **可离线**：有权重可下载，能转成 LiteRT / ONNX / Core ML
2. **够快**：fast 通路的单模型 ≤ 5 ms（Pixel 8a 级别 GPU）
3. **许可证可商用**：否则只能进实验分支
4. **输出可直接用**：坐标/概率图，不需要额外的后处理网络
5. **社区维护**：有转换脚本与 Android 示例，降低踩坑成本

## 2. 运行时与后端

主线选 **LiteRT**（TensorFlow Lite 的继任者，Google 端侧运行时）：

- `CompiledModel` + GPU delegate（ML Drift），支持整图算子委派而不回退 CPU
- 可选 NPU 后端（高通/联发科/三星），延迟再降 1/3 左右
- 统一的 `litert-torch` 转换路径：PyTorch → `.tflite`
- 备选：**MediaPipe Tasks**（Apache-2.0，官方 Android/iOS/Web 全平台，人脸/姿态/自拍分割开箱可用）作为 fallback 与 Web 原型首选

## 3. Fast 通路（每帧，合计 ≈ 15 ms）

| 模型 | 任务 | 输入 | 输出 | 体积 | 延迟 | 许可证 |
|---|---|---|---|---|---|---|
| [YuNet](https://huggingface.co/litert-community/YuNet-Face-LiteRT) | 人脸检测 + 5 关键点 | 1×3×640×640 | 框 + 关键点 | ~1 MB | 4 ms | Apache-2.0 |
| [RTMPose-s](https://huggingface.co/litert-community/RTMPose-s-LiteRT) | 人体 17 关键点 | 1×3×256×192 | simcc_x/y | 11.1 MB | 4 ms | Apache-2.0 (MMPose) |
| [UniSal](https://huggingface.co/litert-community/UniSal-Saliency-LiteRT) | 显著性预测 | 1×3×256×256 | 256² 显著图 | — | 3 ms | **需核对** |
| [M-LSD-tiny](https://huggingface.co/litert-community/M-LSD-tiny-LiteRT) | 直线段检测 | 1×3×512×512 | 线段 + 分数 | — | 2 ms | Apache-2.0 |
| [Places365-ResNet18](https://huggingface.co/litert-community/Places365-ResNet18-LiteRT) | 场景分类 365 类 | 1×3×224×224 | logits[365] | 22.8 MB | 2 ms | **需核对** |
| （自研，非模型）LightStats | 直方图/色温/溢出 | — | 统计量 | 0 | < 1 ms | — |

**为什么不用人脸框当主体**：风景、建筑、静物、宠物场景里没有人脸。显著性图是唯一通用的"主体在哪"来源，人脸只是精度增强。

**为什么场景分类只要 2 ms 也要单独跑**：它是**权重开关**。同一张构图在人像和风光下的评分标准完全不同（见 `03-composition-rules.md`）。

## 4. Slow 通路（2 fps，异步）

| 模型 | 任务 | 延迟 | 用途 | 许可证 |
|---|---|---|---|---|
| [Metric3D v2 ViT-S](https://huggingface.co/mlboydaisuke/Metric3D-v2-LiteRT) | 度量深度 | ~44 ms | 主体与背景的层次、距离估算（"该靠近多少"） | 需核对 |
| DSINE | 表面法线 | — | 光位估计（光从哪来）、表面朝向 | 需核对 |

慢通路的结果**不追求逐帧新鲜**，直接合并进最新的 `PerceptionFrame`，并标记 `staleMs`。

## 5. Post 通路（快门后一次）

| 模型 | 用途 | 延迟 | 许可证 |
|---|---|---|---|
| [NIMA aesthetic](https://huggingface.co/litert-community/NIMA-LiteRT) | 美学评分（AVA 训练） | ~173 ms（两个模型合计） | Apache-2.0 |
| [NIMA technical](https://huggingface.co/litert-community/NIMA-LiteRT) | 技术质量（噪点/清晰度） | 同上 | Apache-2.0 |
| 裁剪搜索 | 复用 RuleEngine 在候选窗口上搜索 | < 30 ms | 自研 |
| [CPGA-Net](https://huggingface.co/litert-community/CPGA-Net-LowLight-LiteRT)（候选） | 暗光增强 | ~2 ms | 需核对 |
| [SmolVLM-256M](https://huggingface.co/litert-community/SmolVLM-256M-Instruct)（可选） | 离线一句话点评 | 数百 ms～秒级 | Apache-2.0 |

注意 NIMA 的定位：**它只用于拍后反馈和离线校准，不参与实时引导**（173 ms 太慢，且它对"相机该往哪移"没有梯度信息）。

## 6. 预处理约定

| 模型 | 归一化 | 布局 |
|---|---|---|
| YuNet | 均值/缩放按原实现（OpenCV Zoo 默认） | NCHW |
| RTMPose-s | ImageNet mean/std | NCHW |
| UniSal | /255，ImageNet std | NCHW |
| M-LSD-tiny | /255 | NCHW（需核对具体版本） |
| Places365 | ImageNet mean/std | NCHW |
| NIMA | `v/127.5 - 1` | NHWC |

**所有模型的输入张量都从同一个 GPU 缓冲池分配**，避免每帧堆分配。预处理在 GPU shader 里一次完成 YUV→RGB→resize→normalize。

## 7. 模型获取与校验

`models/manifest.json` 是唯一事实来源：

1. 构建脚本读 manifest → 下载到 `models/`（不入 git）
2. 记录 sha256 与体积，首次运行校验，不匹配则拒绝加载（防止权重被换）
3. 每个模型登记：任务 / 输入输出 / 后端 / 许可证 / 状态（selected | candidate | optional | fallback）
4. **标 `需核对` 的模型不得进入商用构建**，CI 里做一次门禁检查

## 8. 替换与演进

- 任何模型都藏在 `Perceptor<O>` 接口后，替换不改业务代码
- 优先替换顺序：显著性 → 场景分类 → 姿态（这三者对评分影响最大）
- 若要引入新能力（如"构图风格分类：极简/对称/对角线"），走"小分类头 + CLIP 文本嵌入"路线，避免再引入一个大模型
- 量化：先用 fp16；INT8 只在实测掉分 < 2% 时才启用（美学/显著性对量化较敏感）
