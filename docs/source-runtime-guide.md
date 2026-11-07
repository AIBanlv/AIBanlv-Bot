# 源码版运行环境

## Windows 用户

安装 Git，克隆后双击根目录 `Setup AIBanlv.cmd`。缺少可用的 Node.js 24+/npm 时自动准备官方便携环境，然后安装项目依赖，下载原始 LAM/Python/JDK/Gson，执行本地推理验证，创建 **AIBanlv Source** 桌面图标。以后双击图标或 `Start AIBanlv.cmd`。

便携 Node 24.22.2 包约 36 MiB，存放在 `%LOCALAPPDATA%/AIBanlv/tools/`，固定官方 URL、大小及 SHA-256。启动和更新复用已登记路径；原有系统 Node、nvm 和持久 PATH 不变。直接执行下方 npm 命令的开发者仍需在自己的终端选择 Node.js 24+。

首次资源包约 669 MiB，解压约 1.13 GiB，准备过程中建议预留至少 4 GiB。默认缓存位于 `%LOCALAPPDATA%/AIBanlv/runtimes/`，不在 Git 和 node_modules 内；多个 checkout 共享。普通启动只加载已准备好的资源，不会重复联网下载。

```powershell
# 项目依赖已安装，单独检查/修复运行环境
npm run runtime:prepare
```

资源损坏时会重新准备；未完成下载不会当成可用资源。旧版本保留，源码更新失败可在提示框重试，或双击源码图标续装。Java 源码编译失败直接提示修复源码，不重新下载整个资源包。

下载优先使用 1 MiB 分块和有限重试，并校验每块范围及完整包的 SHA-256；下载服务不支持 Range 时使用完整流。这是完整资源包的分块传输，不是安装版的增量补丁。

这里只提供本地口型推理环境。云端对话仍按所选角色使用平台积分或已有账号/Key 配置；不包含共享 API Key。

## 自定义和离线使用

优先级：显式环境变量 → `demos/web-desktop-pet/runtime.local.json` → 已就绪自动缓存。支持 `PET_PYTHON`、`PET_LAM_SOURCE`、`JAVA`、`JAVAC`、`GSON_JAR`，Mac 还可用 `PET_MAC_LAM_ROOT`。JSON 中以 `./` 开头的路径相对于 Demo 目录。完整自定义环境会直接验证，部分自定义路径由缓存补齐；不更改系统 PATH。

`AIBANLV_RUNTIME_CACHE` 可指定缓存目录。离线资源文件仍须与当前 Git 清单的大小和 SHA-256 一致：

```powershell
$env:AIBANLV_RUNTIME_ARCHIVE = 'D:\downloads\AIBanlv-runtime-1.0.0-win32-x64.zip'
npm run runtime:prepare
Remove-Item Env:AIBANLV_RUNTIME_ARCHIVE
```

此命令只解决推理资源离线导入；首次 npm/Electron 安装仍需要网络或开发者预备好的 npm 缓存。不要把本地配置或下载包提交 Git。

## 资源与更新

根目录 `source-runtime.lock.json` 固定平台、版本、下载 URL、大小和 SHA-256。资源版本独立于应用版本；应用代码变化通常无需重新下载资源。

Windows 1.0.0 使用已验证的原始 LAM checkpoint、独立 CPython 3.11.17 及固定推理依赖、Temurin JDK 17.0.20.1+1、Gson 2.11.0。许可随包保留。JDK 提供编译器，源码启动每次进程首次使用时编译当前 checkout 的 Java，不使用预编译旧类。

公开资源地址：
[AIBanlv-runtime-1.0.0-win32-x64.zip](https://download.aibanlv.ai/desktop-runtimes/1.0.0/win32-x64/AIBanlv-runtime-1.0.0-win32-x64.zip)

SHA-256：`4e6d0aabd48d0c3367b94b6366f49b25ce08a5e4675afb40c126bf52050f27ab`。

Mac x64/arm64 自动包尚未发布。已有 `artifacts/mac`、PATH Java 与 Gson 配置会继续验证使用；新用户先 `npm run setup:deps`，按 [MAC-TEST.md](../MAC-TEST.md) 准备环境。发布必须在对应原生 Mac 上完成，不能由 Windows 构建替代验收。

Apple Silicon 完整环境候选 ZIP 已提供 Cloudflare R2 公开下载，包含便携 Node、Core ML、JDK 和安装器；下载地址与校验信息见[清单](mac-source-bundle.json)，按 [Mac 完整环境 ZIP](MAC_SOURCE_BUNDLE.md) 安装。候选包安装必须在目标 Mac 上通过真实推理验证，不代表正式自动下载资源已经发布。

## 维护者构建与发布

```powershell
# Windows：可选复用已经验收的 Python/model/python-runtime.json 目录
$env:DEVICE_PYTHON_STAGE = '<已验证资源目录>'
npm run runtime:package -- --version=1.0.1
```

只生成资源 ZIP，不生成 EXE 或安装器。未指定 Python stage 时沿用已有 Python 打包流程。Mac 先执行对应架构 `npm run mac:prepare`，并通过 `DEVICE_MODEL_SOURCE` 提供含 LICENSE 的原始 LAM 目录；资源生产器只构建当前主机架构。

输出在 `demos/web-desktop-pet/artifacts/source-runtimes/<version>/<platform>-<arch>/`，包含 ZIP 和 `requirement.json`。先上传 ZIP 到 R2 桶 `aibanlv-downloads` 的独立版本目录，公开下载并核对大小/哈希，再将 requirement 加入 Git 清单。已发布版本不覆盖。资源上传使用 `application/zip`，可长期缓存。

维护者验收（在 Demo 目录）：

```powershell
node tests/source-runtime-local.mjs
node --test tests/source-runtime.test.mjs tests/device-source-update.test.mjs
$env:DEVICE_SOURCE_RUNTIME_CHECK = '1'
$env:DEVICE_UPDATE_SOURCE_ONLY = '1'
node tests/device-update-electron.mjs
```

`source-runtime-local` 在临时独立 checkout 中禁用全局 Python/Java/Gradle 路径，实际编译和推理；Electron 测试使用本地云服务夹具，不产生付费对话。最后在仓库根目录运行 `npm test`。
