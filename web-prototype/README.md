# web-prototype/ — Web 验证原型（M1）

目的：**在真机工程之前，先把「打分与引导」的逻辑验证对。** 浏览器端全离线运行，用 Web 摄像头取流。

## 快速开始

```bash
cd web-prototype
pnpm install          # 依赖（Node ^20.19 || >=22.12，见 package.json engines / .nvmrc）
pnpm assets           # 拉本地 wasm + .task 模型（首次必须；之后即可离线运行）
pnpm dev              # 打开 http://127.0.0.1:5173（须走 127.0.0.1，getUserMedia 要求安全上下文）
pnpm test             # 单测：规则 / 打分 / 平滑迟滞 / 回归基线
pnpm build            # tsc --noEmit + vite build
```

**没有摄像头也能看效果**：点右侧面板的「注入模拟帧」，会用一组固定特征（人像 / 侧脸朝右 / 主体偏小）驱动整条链路。

## 这一版能做什么

对着真实画面实时给出：**构图分（1–5）+ 一句话建议 + 叠加层引导**（三分线、水平仪、主体框、目标虚影框、箭头、变焦提示）。
右侧 debug 面板实时显示每个模型的耗时、每条规则的得分与中间量，并支持**拖滑块改权重**、切换场景画像、开关任意叠加元素。

## 目录与分层（对应 docs/01 §2）

| 路径 | 层 | 职责 |
|---|---|---|
| `src/core/` | L3 决策 | **纯逻辑、零平台依赖、可单测**：契约、权重表、规则、打分、求解、平滑 |
| `src/core/scene-weights.ts` | L3 | 场景画像权重表 —— docs/03 §3 的**唯一可调参数集中地** |
| `src/core/rules/` | L3 | R1 三分 / R2 水平 / R3 占比 / R4 头顶留白 / R5 朝向留白 / R6 平衡 / R10 曝光 / R11 动态范围 |
| `src/core/pipeline.ts` | L3 | 帧进 → 打分 + 引导求解 + 平滑 → 不可变快照 |
| `src/perception/mediapipe-perceptor.ts` | L2 | MediaPipe Face/Pose Landmarker（GPU 创建失败自动回落 CPU），33→17 关键点映射 |
| `src/perception/light-stats.ts` | L2 | 160×90 直方图（亮度 / 溢出 / 逆光比）+ 块梯度显著图（降级代理） |
| `src/perception/perception-bus.ts` | L2 | 感知总线：一帧视频 → 一个 `PerceptionFrame` |
| `src/perception/device-pose.ts` | L2 | 设备姿态（IMU 的 Web 等价物）；桌面无该传感器 → R2 权重 0 |
| `src/capture/` | L0/L1 | getUserMedia 取流（rVFC 采集时刻）+ FrameGate 节流与丢帧 |
| `src/render/OverlayRenderer.ts` | L4 | 全部画面叠加元素；归一化→像素的**唯一**换算处（与 CSS `object-fit: cover` 一致） |
| `src/ui/debug-panel.ts` | L5 | 调试面板：耗时 / 规则明细 / 权重滑块 / 画像切换 / 图层开关 |
| `scripts/fetch-assets.mjs` | — | 拉 wasm 与模型到 `public/` 并记录 sha256（资源不入 git，见 `.gitignore`） |

## M1 实现了哪几条规则

R1 三分点对齐（含中心构图豁免）、R2 水平矫正（IMU）、R3 主体占比、R4 头顶留白、R5 朝向留白（正脸降权 ×0.2）、R6 视觉平衡、R10 曝光质量、R11 动态范围。

**未实现**（面板灰显、不计分）：R7 引导线、R8 对称（M3）、R9 光位、R12 姿态（M4）。

打分严格按 docs/03 §4：`s01 = Σw·f / Σw`，`展示分 = 1 + 4·s01^0.8`。

## 实测数据（headless Chrome 155 + 合成摄像头，1280×720 @30fps，2026-10-08）

| 指标 | 实测 |
|---|---|
| 闸门 | 目标 10 fps / 实际 9.3–9.6 fps；丢帧**全部来自节流**（忙时丢帧 0） |
| 感知耗时 | 人脸 13.0 ms + 姿态 22.4 ms + 光照 5.3 ms ≈ **40.7 ms/帧**（headless 软件渲染） |
| 稳定性 | 刷新后自动恢复；控制台 0 error；页面 **0 个网络请求** |
| 权重滑块 | 改权重 → 总分与建议立刻变化（4.0 → 4.3，建议由 R3 交棒给 R6） |
| 单测 | 全绿（规则 25 条 + 引擎/求解/平滑 9 条） |

## 已知限制（第一版的边界）

1. **推理在主线程**：人脸+姿态串行约 40 ms，在 10 fps 下占满约 40% 主线程。M2 移到独立线程 / GPU 队列。
2. **显著图是降级代理**：块梯度能量 + 中心偏置，不是 UniSal —— 走的是 docs/04 §8 允许的降级路径，真模型在 M2/M3 接入。
3. **场景画像是启发式**：有主体判人像、否则判风景；Places365 属 M3。面板可手动指定画像来调权重。
4. **桌面没有 IMU**：R2 权重 0、面板标 N/A；手机浏览器点「启用水平仪」授权后生效。
5. **R2 未融合视觉地平线**：M-LSD 属 M3，目前只用 IMU。

## 参数门槛

- 平滑参数（EMA α=0.35、切换阈值 0.08、最短展示 1200 ms、"可以拍了"连续 1.5 s ≥ 4.2）统一在 `src/core/contracts.ts` 的 `DEFAULT_SMOOTH_CONFIG`
- 权重表在 `src/core/scene-weights.ts`：改完请同步 docs/03 §3 并跑 `pnpm test` —— 回归基线会告诉你总分变了多少
