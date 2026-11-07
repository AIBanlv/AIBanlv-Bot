# macOS 开发与测试

统一项目位于 `kaifa/control-windows`。Windows x64、Intel Mac x64 和
Apple Silicon arm64 共用本仓库 UI、登录、插件和对话代码。
Mac 使用原手机 Core ML 模型，Windows 保留原 PyTorch/TAR 推理路径。

## 启动

要求 macOS 13+、Node.js 24+、Xcode 命令行工具及 Java 17+（源码运行）。
首次安装流程见[安装与首次使用](docs/INSTALL_FOR_AGENTS.md#macos)。Mac 自动资源包尚未发布；
先安装依赖，再配置已准备好的模型和 Gson，避免在资源尚未准备时执行完整 `npm run setup`。
在本仓库根目录运行：

```sh
npm ci
npm run setup:deps
export PET_COREML_MODEL=/absolute/path/lam_audio2exp_streaming.mlpackage
export GSON_JAR=/absolute/path/gson-2.11.0.jar
npm run mac:prepare
node demos/web-desktop-pet/harness-client-plugin/desktop-launch.mjs --register-source
npm start
```

未指定模型时，默认查找同级 `latest/5.15/SDK/HBuilder-Hello/UTSPlugins/`
下 `AIBANLVDigitalHuman/app-ios/Resources/lam_audio2exp_streaming.mlpackage`。
模型、权重、Java 运行时及本机配置不进入 Git。

## 构建

```sh
npm run mac:package:x64
npm run mac:package:arm64
```

在 macOS 上构建 Mac 包，在 Windows 上构建 Windows 包。
Mac 包含目标架构的 Electron、Swift worker、Java 及 Core ML 模型，
无需另装 Python/PyTorch/Java。`demos/web-desktop-pet/dist/` 的
`device-latest-darwin-x64.json` 或 `device-latest-darwin-arm64.json`
记录最新 `AIBanlv.app` 位置；Windows 使用独立清单防止混包。
包未签名、公证；Apple Silicon 交叉构建不代表已在 M 系列实机验收。
新版 Harness 含原生 Node 插件，打包前会检查目标架构的可选依赖及二进制。
建议 arm64 包在苹果芯片 Mac 上安装依赖并构建；Intel 交叉构建若缺少
arm64 原生依赖会明确失败，不能仅替换 Electron/Swift/Java 后继续打包。

## 后端与生命周期

首次使用对 CPU、all、CPU/GPU，以及 arm64 的 CPU/神经网络引擎分别
检查输出健康和测速；每个探测最多 120 秒，首次准备可能需要数分钟。
与 CPU 对照误差满足要求、且至少快 5% 的候选才会被选择。
仅缓存设备/模型/worker 摘要、后端和耗时，不保存音频或文字。
加速器退出或冻结输出时，本地当前音频块回退 CPU，不重发云端会话。
`npm run mac:benchmark` 可独立检查；`PET_COREML_BACKEND=cpuOnly`
可强制 CPU，也支持 auto、all、cpuAndGPU、cpuAndNeuralEngine。

沿用主项目授权后的后台预热；Mac 停止回复或切换角色时清除旧状态并
复用权重，隐藏、失去授权或退出时释放。保留最新打断和语音输入行为。
Windows 专用的桌面整理/应用控制功能仍受 Windows 平台限制。
真实对话沿用线上服务和计费规则；自动测试仅使用本地夹具。

2026-10-20 旧版 Intel 包的验收不等同于本次 0.1.4 合并版完整验收。
本次合并验证记录见 `docs/mac-merge-validation.md`。
