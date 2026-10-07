# android/ — 真机工程骨架（M2）

技术栈：Kotlin + CameraX + LiteRT（GPU/NPU delegate）+ Jetpack Compose 叠加层。

## 模块划分（Gradle module）

```
android/
├── app/                 壳工程：权限、导航、设置
├── feature-camera/      取景 UI、快门、拍摄后流程
├── feature-guidance/    叠加层渲染（箭头/三分线/水平仪/主体框/姿势虚影）
├── core-capture/        CameraX 封装、FrameGate、IMU 采样与时间戳对齐
├── core-perception/     Perceptor 实现 + 模型加载/生命周期（LiteRT）
├── core-composition/    场景画像、规则引擎、打分、引导求解（纯 Kotlin，可单测）
└── core-model/          models/manifest.json 的解析与校验
```

## 关键约束

- `core-composition` 不得依赖任何 Android 相机/图形 API，保证可在 JVM 上单元测试，并可移植到 iOS/Web。
- 分析流与预览流分离：预览 30fps，分析由 `FrameGate` 节流到 10fps，并丢弃过期帧。
- 模型文件不打进 APK 的 assets（可选方案：首次安装解压 / Play Asset Delivery）；调试期用 `models/` 目录 sideload。

## 待填充（M2 开始）

- [ ] Gradle 多模块骨架
- [ ] CameraX 预览 + 分析双流
- [ ] LiteRT 推理封装（CompiledModel, GPU delegate）
- [ ] 叠加层渲染
- [ ] 调参面板（debug only）
