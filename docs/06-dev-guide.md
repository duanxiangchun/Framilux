# 06 · 开发手册（上手）

> 切到本项目开发时，先读这份，再按 `docs/05-roadmap.md` 找当前里程碑。

## 0. 阅读顺序（30 分钟）

1. 本文件 —— 环境、起步命令、约定、坑
2. `docs/00-overview.md` —— 做什么、不做什么
3. `docs/01-architecture.md` —— 分层、数据流、性能预算（**最重要**）
4. `docs/03-composition-rules.md` —— 规则与打分公式
5. `docs/04-interface-contracts.md` —— 写代码前必须遵守的契约
6. `docs/05-roadmap.md` —— 现在该做哪一步

## 1. 环境要求

| 用途 | 要求 |
|---|---|
| Android（M2+） | Android Studio Ladybug+ / JDK 17 / Gradle Wrapper（随仓库）/ 真机 Android 10+（API 29+），需支持 GPU delegate |
| Web 原型（M1） | Node 20+ / pnpm 9+ / Chrome 113+（WebGPU）或任意现代浏览器（WASM 回退） |
| 模型工具 | PowerShell 7（`pwsh`），用于下载与校验权重 |
| 不需要 | NDK、CUDA、任何云端账号或 API Key |

**本项目全程不应出现任何网络调用代码。** Android 侧连 `INTERNET` 权限都不声明。

## 2. 从哪开始

当前里程碑是 **M1（Web 原型）**，目标是**验证打分与引导逻辑**，不是把识别做准：

```bash
cd web-prototype
pnpm create vite . --template vanilla-ts   # 首次初始化
pnpm add @mediapipe/tasks-vision onnxruntime-web
pnpm dev
```

M1 的最短可用路径（建议照这个顺序写）：

1. `getUserMedia` 取流 → `<video>` + 叠加 `<canvas>`
2. `FrameGate`：requestAnimationFrame 里节流到 10 fps，忙时丢帧
3. MediaPipe Tasks Vision 接入人脸 + 姿态（模型放 `web-prototype/public/models/`）
4. `core-composition` 的 TS 实现：R1 三分 / R2 水平 / R3 占比 / R4 头顶留白 / R10 曝光 / R11 动态范围
5. 叠加层渲染：三分线、水平仪、主体框、目标虚影框、箭头、单句建议、评分徽章
6. 平滑与迟滞（EMA α=0.35、切换阈值 0.08）
7. debug 面板：每模型耗时、每规则得分、权重滑块

## 3. 模型怎么拿

`models/manifest.json` 是**唯一事实来源**。

```powershell
# 先看会做什么，不下载
pwsh -File models/download.ps1 -DryRun

# 下载带 downloadUrl 的条目，并把 sha256 写入 models/lock.json
pwsh -File models/download.ps1
```

- 目前除 `mediapipe_tasks`（走官方依赖，不下载权重）外，清单里的模型都已带 `downloadUrl`，可一键下载
- 新加模型若暂缺 `downloadUrl`：脚本会查询 HuggingFace 仓库并列出其中所有 `.tflite` 候选文件；挑一个填进 manifest 的 `downloadUrl` 字段，下次就能自动下载。非 HF 来源（GitHub Release 等）会打印来源页
- 手动拿到的文件放进 `models/weights/`，再跑一次脚本即可登记 sha256
- 权重体积大，**不入 git**（见 `.gitignore`）
- 新增模型必须先在 manifest 登记许可证；标 `需核对` 的不得进商用构建
- 构建期校验 `lock.json` 的 sha256，防止权重被替换

## 4. 代码约定

- **坐标**：跨模块一律归一化 `[0,1]`，原点左上；比较距离前先乘宽高比；像素坐标只允许出现在渲染层（`docs/04` §1）
- **规则扩展流程**（照这个顺序，别跳步）：
  1. 在 `docs/03` 里加一条 `R编号`，写清输入、公式、建议文案
  2. 实现 `CompositionRule`
  3. 在 `SceneWeights` 里为 6 个场景画像各自定权重 —— **权重只能改这一处**
  4. 写单测（喂固定的 `PerceptionFrame`，断言分项得分）
  5. 更新 `docs/03` 的权重表
- **文案不硬编码**：一律走 `textKey` + 本地化资源
- **模型可替换**：业务代码里禁止出现某模型的张量细节，一律藏在 `Perceptor` 后
- **决策层零依赖**：`core-composition` 不得引用相机/图形/Android API，否则无法单测也无法移植

## 5. 分支与提交

- 远端：`https://github.com/duanxiangchun/Framilux.git`（`origin`，默认分支 `main`）
- `main` 保护，功能走 `feature/<主题>`
- 提交信息：`类型(范围): 描述`，例：`feat(composition): add leadRoom rule`、`fix(capture): align imu timestamp with frame`
- 提交前必跑：单测 + lint；（M2 起）+ 许可证门禁 + 无网络权限检查
- **身份**：本仓库用**仓库本地**配置 `duanxiangchun <duanxiangchun@users.noreply.github.com>`（`git config --local`）。全局 `~/.gitconfig` 是工作身份 `MG-Duan <duanxc@mgdaas.com>`，**不要动**
- **认证坑**：Windows 凭据管理器里有一条失效的 `git:https://github.com`（MG-Duan），用裸 URL 会被 git 取到它并报 `Password authentication is not supported`。所以 **origin URL 里保留了 `duanxiangchun@` 前缀，别去掉**；去掉前缀就退回踩坑

## 6. 调试与性能

debug 构建必须能回答三个问题：**每个模型花了多久、每条规则给了几分、当前是第几级降档**。

必须量的三个数（每次里程碑结束记录一次）：

1. 单帧推理耗时（各模型分项 + 合计）
2. 端到端延迟：屏幕录制 → 数"手机移动"到"提示变化"之间的帧数 ÷ 帧率
3. 连续运行 10 分钟后的温升与降档情况

性能基线记到 `docs/perf-baseline.md`（M2 起建立）。

## 7. 常见坑

| 坑 | 现象 | 解法 |
|---|---|---|
| 模型输入归一化/尺寸不一致 | 人脸框整体错位 | 严格按 manifest 的 `input` 字段，别照抄别的示例 |
| YUV 色彩空间搞反 | 颜色异常、识别率骤降 | 用 `OUTPUT_IMAGE_FORMAT_RGBA_8888` 让系统转换，别手撸 NV21 |
| GPU delegate 部分算子回落 CPU | 延迟抖动、忽快忽慢 | 用 LiteRT `CompiledModel` 检查整图委派率，回落就换算子或降档 |
| 坐标没乘宽高比 | 横向偏移被系统性低估 | `docs/03` §1 |
| 显著图分辨率与画面比例不一致 | 主体框偏移 | 统一到 256² 再做坐标映射 |
| 模型文件缺失 | 规则静默失效、分数虚高 | debug 面板红标 + 日志；该规则权重置 0 而不是崩溃 |
| 推理结果时间戳用错 | 水平仪与画面不同步 | `tsNs` 记**采集时刻**，不是推理完成时刻（`docs/04` §2） |

## 8. 每个里程碑的自测清单

- [ ] 飞行模式下功能完整（拔网线/开飞行模式）
- [ ] 移动手机时引导跟随，无明显抖动与闪烁
- [ ] 端到端延迟 ≤ 100 ms（实时通路）
- [ ] 无崩溃、无 OOM；连续 10 分钟不降档或能优雅降档
- [ ] 许可证门禁通过；无 `INTERNET` 权限（`aapt dump permissions`）
- [ ] 新增规则/模型已同步文档与 manifest

## 9. 交接须知

把工作目录切到本项目根目录后，`AGENTS.md` 会自动生效（离线红线、性能预算、许可证门禁、坐标约定）。若你在别处开新会话，只需指向本文件即可恢复全部上下文。

**第一个任务：M1 第 1–2 步（取流 + FrameGate + 叠加层画三分线）。**
