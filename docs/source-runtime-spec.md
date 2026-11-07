# 源码运行环境自动准备

## 目标与范围

用户已确认：克隆后执行 Setup AIBanlv，自动安装依赖、下载本机推理环境、验证实际推理并创建桌面入口。源码更新负责同步资源版本。模型与运行时不进 Git，不构建 EXE，不改变计费、角色或 Key 行为。

运行资源是单一能力：资源生产 → 校验安装 → 源码启动/更新。沿用已验证的 Windows Python/LAM；Mac 沿用原生 Core ML，必须在对应架构的 Mac 上生产验收后才能发布。

## 约定

- 根目录 `source-runtime.lock.json` 固定每个平台资源版本、HTTPS URL、压缩/解压大小和 SHA-256；URL 使用独立的 `desktop-runtimes/<version>/<platform>-<arch>/`，不覆盖旧版本。
- Windows 缓存在 `%LOCALAPPDATA%/AIBanlv/runtimes`，Mac 在 `~/Library/Caches/AIBanlv/runtimes`；以版本、平台及哈希区分，可跨 checkout 复用。
- 下载使用有界 I/O：支持 Range 时每块 1 MiB、最多 4 个并发请求，逐块校验偏移和大小，45 秒超时，最多尝试 3 次；不支持时退回完整流。全部路径最终校验完整 SHA-256，并设总超时及大小限制。离线可指定同一压缩包，但校验规则不变。ZIP 拒绝越界、链接、重复路径和超限内容。未完成内容只在独立临时目录中，实际推理验证通过后才原子发布。
- 同版本并发初始化共享 OS 锁；退出/崩溃自动释放。失败可再次运行 Setup 或更新重试，保留先前有效版本。
- 环境变量优先于 Demo 的 `runtime.local.json`，再使用自动缓存。保留完整自定义配置；不覆盖用户配置，不写系统 PATH。
- 资源含 JDK 编译器和 Gson。源码始终编译当前 checkout 的 Java；缓存不提供代替源码的预编译类。
- Setup 和 `npm run setup` 准备资源。普通启动只读取已就绪缓存，不悄悄下载大文件。不存在资源时提示执行 Setup，保留高级开发方式。
- 更新只有资源要求变化才准备新资源；准备失败不得重启或标记成功，已有恢复流程保留任务。

## 结构与风格

`scripts/source-runtime*.mjs` 管理资源，`scripts/setup-runtime.mjs` 为命令入口，Electron 主进程加载默认路径。测试在 Demo 的 `tests` 中；沿用 Node ESM、单引号、不用 shell 拼接进程参数。

```js
await ensureSourceRuntime(requirement, { cacheDirectory, verify, report })
```

## 验收与命令

- 根目录 `npm test`：完整 Node 测试。
- Demo 中 `node --test tests/source-runtime.test.mjs tests/device-source-update.test.mjs`：本地 ZIP/HTTP/Git 夹具覆盖损坏、失败重试、并发、路径优先级、版本更新。
- 根目录 `npm run runtime:prepare`：准备并验证实际本地引擎；`npm run runtime:package -- --version=<版本>`：只构建资源 ZIP。
- Windows 使用隔离目录、清空全局 Python/Java/Gradle 配置，运行真实 LAM 和 Java 验证；Electron 使用本地网络夹具，不创建付费会话。
- 发布后以公开 URL 下载并重新校验；Mac 尚无原生资源时明确提示，不伪造可用版本。

## 边界

Mac ARM64 完整候选资源可用 `--arch=arm64 --prepare-only` 在 Intel Mac 交叉准备，必须使用含预发布标记的版本号。该模式仅产生本地候选 ZIP 与 `pending-native` 记录，禁止当成已验收的自动资源发布；包内安装器必须在目标 M 芯片实际验证后才写本机就绪标记。候选包包含便携 Node 和独立源码安装入口，通过 runtime.local.json 补齐路径，不修改正式资源锁文件或既有自定义配置。所有 Mac 包必须带 model-manifest.json，供加速器缓存身份检查。

始终保留旧缓存、许可文件、自定义路径与无关工作。新的业务行为或安装器构建另行确认。禁止提交二进制、凭据、本地配置、模型和生成目录。

## Windows 验证结果（2026-11-03）

- 根目录 `npm test`：752 项通过，0 失败、0 跳过；包含资源下载、安全解压、环境优先级和源码更新恢复测试。
- Demo 中 `node tests/source-runtime-local.mjs`：隔离全局 Python/Java/Gradle 后编译当前 Java 并运行真实 LAM；故意破坏 Java 源码时返回独立编译错误，不重下资源。
- Demo 中 `node scripts/prepare-control.mjs --test` 与 `node tests/device-lam-control.mjs`：缓存 JDK 下的数值对齐、控制场景和 Java RPC 检查通过。
- Demo 中设置 `DEVICE_SOURCE_RUNTIME_CHECK=1`、`DEVICE_UPDATE_SOURCE_ONLY=1` 后运行 `node tests/device-update-electron.mjs`：真实 Electron 从共享缓存加载 Python/JDK 并完成 LAM 推理，源码更新、失败重试、交接、键盘操作、四种宽度和无障碍检查通过。
- 清除上述两个测试开关后运行 `node tests/device-update-electron.mjs`：安装版全量下载、增量重建、校验失败、取消和安装交接失败提示通过；全程使用本地服务夹具。
- Windows 1.0.0 资源已上传独立公开目录；通过公开 URL 下载到空缓存，校验 701753903 字节及清单 SHA-256，解压后真实引擎验证通过。

已知验收限制：旧综合脚本 `DEVICE_TOUCH_ONLY=1 node tests/device-electron.mjs` 在“未登录默认本地角色”的旧断言处失败，尚未进入模型检查；本次未修改该夹具，模型与更新功能由上述真实 Electron 检查覆盖。Electron 检查仍输出已有的 DEP0190 和 DeviceChannel 监听器数量警告。Mac 自动资源仍待对应架构的原生构建和验收。
