# Apple Silicon Mac 完整源码运行环境 ZIP

此包对应 Windows 的“源码 + 运行资源 ZIP”方案，含原始手机 Core ML 编译模型、模型身份文件、ARM64 Swift 推理程序、Temurin JDK 17（含 javac）、Gson 2.11.0、官方便携 Node 24.22.2/npm 及许可证。源码与 npm/Electron 依赖按仓库锁文件安装。无需自行安装 Python、Java、Node 或编译 Core ML；不修改系统 PATH。

要求：Apple Silicon 原生 macOS 15+、Git、联网安装 npm/Electron 的条件，以及至少 5 GiB 可用空间。源码更新依赖 Git；如果 `/usr/bin/git --version` 提示安装命令行工具，请先按系统提示完成。Intel/Rosetta 不使用此包。首次安装仍需要网络，不是完全离线包。

## 让 AI 工具安装

先阅读源码仓库中的[机器可读清单](mac-source-bundle.json)，取得当前候选包的下载地址、文件名、大小和 SHA-256。该清单位于源码的 `docs/mac-source-bundle.json`，不在资源 ZIP 中，且仅适用于列明的文件。其他版本应使用维护者提供的对应校验信息。已有对应 ZIP 时可直接校验使用，否则从清单的 `downloadUrl` 下载。

候选包 `1.0.0-candidate.20261105.1` 已于 2026-11-05 上传至 Cloudflare R2：[下载完整环境 ZIP](https://download.aibanlv.ai/desktop-runtimes/1.0.0-candidate.20261105.1/darwin-arm64/AIBanlv-runtime-1.0.0-candidate.20261105.1-darwin-arm64.zip)。大小为 612,518,537 字节，SHA-256 为 `5492459e74a9afdbbfc950a61a16b09a91cad02719e714cb7389cc2fabfdee36`。

在 ZIP 所在目录核对大小和哈希，文件名与期望值以清单为准：

```sh
stat -f '%z' "AIBanlv-runtime-1.0.0-candidate.20261105.1-darwin-arm64.zip"
shasum -a 256 "AIBanlv-runtime-1.0.0-candidate.20261105.1-darwin-arm64.zip"
```

两项均与清单一致后解压到独立目录。不要覆盖已有源码或将包直接解压到源码根目录。首次安装先克隆本仓库到长期保留的目录；已有本仓库时跳过克隆，复用已有目录。将下面路径替换为真实位置：

```sh
git clone https://github.com/AIBanlv/AIBanlv-Bot.git "/希望长期保留的/AIBanlv-Bot"
```

然后将该源码目录传给安装器：

```sh
sh "/解压目录/Install AIBanlv.command" "/希望长期保留的/AIBanlv-Bot"
```

安装器不会拉取或覆盖已有 Git 修改。仓库内安装脚本已统一使用 `https://github.com/AIBanlv/AIBanlv-Bot.git`；已发布的旧候选包不会随源码修改自动更新，因此使用本仓库时应先完成上述克隆，并显式传入已有源码目录。省略源码目录参数或双击 `Install AIBanlv.command` 时默认使用 `~/Applications/AIBanlv Source`。AI 工具应等待脚本成功退出，不能只看到 npm 安装完成就报告成功。

安装器先校验全部文件，再把运行资源放在 `~/Library/Caches/AIBanlv/runtimes/`；按源码锁文件安装依赖，并在目标 Mac 上实际执行 Core ML、输入相关性和当前 Java 源码验证。失败时返回非零，不写“就绪”标记，可修复原因后重试。它保留已有 runtime.local.json 自定义值、账号、角色、Key 和旧缓存，并为源码缺少的运行路径填写本地配置。

成功后双击桌面的 **AIBanlv Source.command**。入口自带便携 Node 的临时 PATH，应用内源码更新可继续复用它，不依赖系统 Node。源码和缓存必须长期保留；安装完成后可删除下载 ZIP 和最初的解压目录。

语音和线上角色仍需要用户自己的角色、扫码、Key 或平台额度；安装不包含共享账号和 Key，不创建付费测试对话。宿主插件不是运行环境安装的一部分，需要时再按源码的 `docs/INSTALL_FOR_AGENTS.md` 配置。

## 候选包验证边界

文件名含 `candidate` 且 `source-runtime.json` 标记 `pending-native` 的包是交叉准备的测试包，并非已在 M 芯片验收的正式自动下载资源。安装器必须在真实 Apple Silicon 上完成推理检查，才会标记该机器就绪。不得仅凭 Intel 上的文件/架构检查宣称 M 芯片验收通过。

此候选包通过独立版本目录公开下载，仍保留 `pending-native` 状态，没有登记到正式 `source-runtime.lock.json`。对候选包请使用上述安装入口，不直接运行现有 Windows Setup 脚本或假设 `npm run runtime:prepare` 会自动下载此包。公开下载可用不等于已通过 M 芯片原生推理验收。
