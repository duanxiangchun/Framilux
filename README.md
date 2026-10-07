# Framilux · 离线 AI 构图相机

> 断网也能用的「拍照构图教练」——实时看懂场景、光线与人物姿态，告诉你该怎么移动手机才能拍得好看。

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

**M0 — 架构设计完成，开发手册就绪，代码骨架待填充。** 下一步按 `docs/05-roadmap.md` 从 M1 开始落地；上手前先读 [docs/06-dev-guide.md](docs/06-dev-guide.md)。
