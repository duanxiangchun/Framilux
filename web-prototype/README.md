# web-prototype/ — Web 验证原型（M1）

目的：**在真机工程之前，先把「打分与引导」的逻辑验证对。** 浏览器端全离线运行，用 Web 摄像头取流。

## 快速开始（M1 步骤 1–2 已落地）

```bash
cd web-prototype
pnpm install
pnpm dev          # 打开 http://127.0.0.1:5173（必须走 127.0.0.1：getUserMedia 需要安全上下文）
pnpm build        # tsc --noEmit + vite build
```

打开后应当看到：摄像头预览 + 三分线（含四个三分交点）+ 左上角 debug HUD（帧率 / 丢帧 / 单帧耗时 / 采集→渲染延迟）。
底部控件：切换摄像头、三分线开关、调试面板开关、节流目标（5/10/15/30 fps）。
控制台可直接取数：`window.framilux.gateStats()`、`window.framilux.camera.captureTsNs`。

### 目录与分层（对应 docs/01 §2）

| 路径 | 层 | 职责 |
|---|---|---|
| `src/core/contracts.ts` | L3 契约 | 共享契约的 TS 侧（归一化坐标、PerceptionFrame、R1 三分几何），**禁止**引用相机/图形 API |
| `src/capture/CameraSource.ts` | L0 | getUserMedia 取流；用 rVFC 的 presentationTime 给出**采集时刻**时间戳（docs/04 §2） |
| `src/capture/FrameGate.ts` | L1 | 节流到 10 fps + 忙时丢帧（背压 = 丢旧帧，不排队） |
| `src/render/OverlayRenderer.ts` | L4 | 三分线 + debug HUD；归一化→像素的唯一换算处，与 CSS `object-fit: cover` 严格一致（否则叠加层整体偏移） |
| `src/main.ts` | L5 | rAF 主循环、控件接线、权限失败提示 |

### 实测数据（headless Chrome + 合成摄像头，1280×720 @30fps，2026-10-07）

- rAF 输入 ≈ 60 fps → 闸门实际处理 **9.5 fps**（目标 10），`丢 733（节流 733 / 忙 0）`；丢帧计数符合"节流为主、忙时兜底"的预期
- 单帧处理 0.2–0.4 ms —— **当前只画叠加层**，接入感知后才是真实耗时
- 采集→渲染 30–45 ms（软件渲染；真机需重测，见 docs/06 §6 的三个数）
- 控制台 0 异常；页面刷新期间共 9 个请求，**全部指向 127.0.0.1:5173**，无任何外部请求；`dist` 产物里不含任何外部 URL
- 刷新页面后自动重新取流并恢复 10 fps（无需手动点重试）

## 技术栈

- TypeScript + Vite
- 推理：`onnxruntime-web`（WebGPU/WASM）或 `@mediapipe/tasks-vision`（官方、体积小、开箱可用）
- 渲染：Canvas 2D 叠加层（后续可换 WebGL）

## 这一版要回答的问题

1. 三分法/水平/主体占比/头顶留白/朝向留白这些规则，**权重怎么配才符合直觉**？
2. 引导提示用什么形态最有效：箭头？目标框虚影？水平仪？文字？
3. 平滑与迟滞参数（EMA 系数、切换阈值）取多少才不抖？
4. 每帧真实耗时是多少（决定真机上的预算分配）？

## 不在这一版做

- 不追求识别精度（用 MediaPipe 现成人脸/姿态即可）
- 不做拍后精修（那是 M4）
- 不做模型转换与量化（那是 M2）

## 待填充（M1）

- [x] Vite + TS 工程初始化
- [x] 取流 + 抽帧节流
- [ ] 人脸/人体检测接入
- [ ] 规则引擎与打分面板
- [ ] 引导叠加层 + 平滑
- [ ] 性能计时面板
