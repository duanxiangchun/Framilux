# Framilux · 离线 AI 构图相机

> 断网也能用的「拍照构图教练」——实时看懂场景、光线与人物姿态，告诉你该怎么移动手机才能拍得好看。

> [!IMPORTANT]
> **非商用许可**：本项目采用 [PolyForm Noncommercial 1.0.0](LICENSE)。个人学习、研究、实验、教学与非营利使用**免费**；**任何商业用途都需另行取得授权**——包括公司内部使用、集成进商业产品、提供付费或托管服务。详见 [许可（非商用）](#许可非商用) 与 [NOTICE](NOTICE)。

## 名字

**Framilux** = `frame`（取景/构图）+ `lux`（照度单位，代表光）。名字本身就是这个项目的两根支柱：**把画面框对，把光看清楚**。

- GitHub 检索 `framilux in:name` 结果为 **0**（2026-10-07 核验），可直接占坑建仓
- 同类备选（同样核验为 0）：`kadrolume`、`lumikadro`
- 已排除：`framecoach`（12 个同名仓库）、`yinggou` / 影构（GitHub 无重名，但已有一款同名 Mac App）、`lumenta`（43 个）、`lumigou`（与「噜咪狗」近似）

## 这是什么

- 一个 **Android-first** 的原生相机项目：CameraX 取景 + 端侧模型实时分析 + AR 式构图引导 + 拍后智能裁剪/调色。
- **完全离线**：不声明网络权限，模型全部打包在 APK 内，飞机模式下功能完整。
- 分析维度：**场景**（人像/风景/建筑/夜景/美食）、**光线**（顺光/侧光/逆光/暗光、高光溢出）、**人物姿态**（17 关键点、朝向、关节打开度）、**画面结构**（显著性主体、引导线、地平线）。

## 这不是什么

- 不是社交/滤镜社区 App；滤镜只是拍后链路的一个可选环节。
- 不是「AI 帮你修得不像自己」——原则是**先教你把画面框对**，再谈调色。
- 不依赖云端大模型：VLM 只作为可选的低频「一句话点评」，且必须是端侧小模型。

## 技术路线

| 阶段 | 形态 | 作用 |
|---|---|---|
| M1 | Web 原型（TypeScript + WebGPU/WASM） | 快速验证**打分与引导逻辑**，不需要真机调试 |
| M2+ | Android 原生（Kotlin + CameraX + LiteRT） | 真机实时链路，GPU/NPU 推理 |
| 远期 | iOS（Swift + AVFoundation + Core ML） | 复用 core 层的规则与契约 |

core 层的**特征契约、规则引擎、引导求解**是跨平台纯逻辑，三端共享设计（见 `docs/04-interface-contracts.md`）。

## 快速开始（新机器）

```powershell
git clone https://github.com/duanxiangchun/Framilux.git
cd Framilux/web-prototype
pnpm install          # Node 版本要求见 package.json 的 engines（也可用 .nvmrc）
pnpm dev              # 打开 http://127.0.0.1:5173（须走 127.0.0.1，getUserMedia 要求安全上下文）
```

- 依赖版本由 `web-prototype/pnpm-lock.yaml` 锁定，两台机器装出来的版本完全一致
- `pnpm install` 需要联网；**装完之后 App 本身不发起任何网络请求**（离线红线见 `AGENTS.md`）
- 模型权重体积大、不入库：在需要模型的机器上跑 `pwsh -File models/download.ps1 -DryRun` 先看清单，去掉 `-DryRun` 才真正下载并登记 sha256
- Android（M2）的 Gradle Wrapper 尚未建立，届时随仓库提交，否则新机器打不开 android 工程

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs/00-overview.md](docs/00-overview.md) | 产品定位、竞品参照、功能优先级 |
| [docs/01-architecture.md](docs/01-architecture.md) | **架构设计**：分层、数据流、线程模型、性能预算 |
| [docs/02-perception-models.md](docs/02-perception-models.md) | 端侧模型选型表（体积/延迟/许可证/后端） |
| [docs/03-composition-rules.md](docs/03-composition-rules.md) | 构图/光影/姿态的规则与打分公式 |
| [docs/04-interface-contracts.md](docs/04-interface-contracts.md) | 核心数据结构与模块接口 |
| [docs/05-roadmap.md](docs/05-roadmap.md) | 里程碑与验收标准 |
| [docs/06-dev-guide.md](docs/06-dev-guide.md) | **开发手册**：环境、起步命令、模型下载、代码约定、常见坑 |
| [models/manifest.json](models/manifest.json) | 模型清单（下载脚本的唯一输入） |

## 仓库结构

```
Framilux/
├── docs/                 设计文档（本阶段主要产物）
├── models/
│   ├── manifest.json     端侧模型清单
│   └── download.ps1      权重下载与 sha256 登记
├── android/              Android 工程骨架（M2）
├── web-prototype/        Web 验证原型（M1）
└── AGENTS.md             项目内的开发约定
```

## 当前状态

**M1 进行中 — Web 原型已跑通「取流 → FrameGate(10 fps) → 三分线叠加层」**（实测 9.5/10 fps、零异常、零外部请求，细节见 [web-prototype/README.md](web-prototype/README.md)）。

下一步：M1 步骤 3–4 —— MediaPipe Tasks Vision 接入人脸/姿态，落到 `core-composition` 的 R1/R2/R3/R4 打分与 debug 面板。里程碑总览见 [docs/05-roadmap.md](docs/05-roadmap.md)，上手前先读 [docs/06-dev-guide.md](docs/06-dev-guide.md)。

## 许可（非商用）

本项目（自有代码与文档）采用 **[PolyForm Noncommercial License 1.0.0](LICENSE)**，版权声明见 [NOTICE](NOTICE)。

| | |
|---|---|
| ✅ 允许 | 个人学习、研究、实验、业余项目；慈善/教育/公立科研/公共安全卫生/环保/政府机构使用（不论经费来源）；修改与再分发（须附带许可证与 NOTICE） |
| ❌ 不允许 | **任何商业用途**：公司内部使用、集成进商业产品、提供付费服务或托管服务，均需另行取得授权 |
| 商业授权 | 版权人保留双许可（dual licensing）权利，商用请通过仓库主页联系 |

> ⚠️ **请不要对外称本项目为「开源软件」**。限制使用领域（如禁止商用）与 OSI 的开源定义冲突，因此这是**源码可见的非商用许可**，GitHub 会把它识别为 non-standard 许可。

**第三方模型权重不适用本项目许可**：`models/manifest.json` 中每个模型有各自的许可证，下载与使用须遵守其条款；标注「需核对」的模型不得进入商用构建。
