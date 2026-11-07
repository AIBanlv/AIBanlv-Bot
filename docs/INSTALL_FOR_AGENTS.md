# AIBanlv 安装与首次使用

[简体中文](../README.md) · [繁體中文](../README.zh-Hant.md) · [English](../README.en.md) · [日本語](../README.ja.md)

用户和 AI 助手共用这份说明：先安装桌面程序，再配置对话，按需连接 Codex、Harness 或 WorkBuddy。
本仓库 [AIBanlv/AIBanlv-Bot](https://github.com/AIBanlv/AIBanlv-Bot) 提供独立的 AIBanlv 桌面伴侣。

## 1. 选择安装方式

| 你的需求 | 安装入口 | 准备条件 |
| --- | --- | --- |
| 使用、修改或跟随本仓库源码更新 | 按下文安装源码版 | Windows 10/11 x64 可自动准备运行环境；Apple Silicon 原生 macOS 15+ 可使用完整环境候选 ZIP，其他 Mac 源码环境按手动流程准备 |
| 使用已发布的桌面应用 | [官方下载页](https://aibanlv.ai/zh?view=desktop-companion) | 选择与系统和 CPU 匹配的安装包，功能以该版本发行说明为准 |

用户指定“源码版”、本仓库或现有源码目录时，沿用源码安装流程；用户指定安装包时使用安装包。
复用已知的安装目录和设置。安装包的文件名、下载地址及校验信息以下载页为准，不猜测未发布的版本。
选择安装包的用户按对应发行说明安装并打开一次应用，然后直接进入第 3 节配置对话。
Apple Silicon 完整环境候选 ZIP 已提供 Cloudflare R2 公开下载，地址与校验信息见[机器可读清单](mac-source-bundle.json)。按[包内安装流程](MAC_SOURCE_BUNDLE.md)准备，并以目标 Mac 的真实推理检查结果判断环境是否就绪；正式自动下载资源仍未发布。

## 2. 安装源码版

### Windows x64

准备 Git、可联网的环境和至少 4 GiB 可用空间。选择一个长期保留的源码目录，后续快捷方式和宿主接入会引用它。
首次模型、Python、JDK 资源下载约 669 MiB，此外还会安装 npm 依赖和 Electron；缺少合适的 Node 时另下载约 36 MiB。

**获取源码。** 已有本仓库时跳过克隆，直接进入已有目录。首次安装可在希望存放项目的目录执行：

```powershell
git clone https://github.com/AIBanlv/AIBanlv-Bot.git
Set-Location -LiteralPath .\AIBanlv-Bot
```

使用 Git 克隆可保留应用内源码更新所需的仓库和上游信息。下载 ZIP 解压可以准备运行环境，但不具备相同的 Git 更新条件。

**初始化。** 用户可双击根目录的 **Setup AIBanlv.cmd**。AI 助手在源码根目录执行其对应脚本，避免停在批处理的“按任意键继续”：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\demos\web-desktop-pet\scripts\setup-source.ps1
```

等待脚本成功退出后再继续。它会检查 Node.js 24+ 和 npm，按锁文件安装项目依赖和 Electron，
下载并校验 Python、LAM 模型和 JDK，创建 **AIBanlv Source** 桌面图标，并生成宿主启动登记和 WorkBuddy MCP 配置。
无需先手动安装 Python、Java，或切换系统 Node/nvm。已具备环境时会复用缓存。

**启动。** 双击 **AIBanlv Source** 或 **Start AIBanlv.cmd**；AI 助手也可从源码根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File .\demos\web-desktop-pet\harness-client-plugin\run.ps1 -Source
```

出现应用窗口表示桌面程序已启动；对话还需要下一节的角色和模型配置。初始化不会自动安装三个宿主的插件。
日常使用快捷方式即可，不必重新执行 Setup 或打开终端。

### macOS

Apple Silicon 原生 macOS 15+ 优先按 [Mac 完整环境 ZIP](MAC_SOURCE_BUNDLE.md) 校验并运行包内安装器。复用用户提供的对应 ZIP，或从[清单](mac-source-bundle.json)的 `downloadUrl` 下载并核对大小与 SHA-256。此路径提供便携 Node/JDK/Core ML；需要联网安装源码依赖，并由安装器完成真实推理检查。不要将候选 ZIP 描述为已正式发布的自动下载资源。不使用该 ZIP 时可按下面的手动流程准备。

准备 Git、Node.js 24+、Xcode 命令行工具、Java 17+、有权使用的 Core ML 模型和 Gson。
获取源码后，在仓库根目录依次执行：

```sh
npm ci
npm run setup:deps
```

然后按 [Mac 环境说明](../MAC-TEST.md#启动) 配置模型与 Gson 路径，运行 `npm run mac:prepare`。
准备成功后登记源码位置并启动：

```sh
node demos/web-desktop-pet/harness-client-plugin/desktop-launch.mjs --register-source
npm start
```

缺少模型或工具链时先补齐对应资源，不把依赖安装成功描述为完整语音环境已就绪。
Windows 快捷方式脚本不适用于 Mac；平台能力见 [跨平台约定](../CROSS-PLATFORM-SPEC.md)。

## 3. 第一次配置对话

安装程序、配置对话和连接工作工具是三个步骤。选择下面一种角色模式即可，不要求同时配置两种。

### 使用 AIBanlv 线上角色

1. 打开“设备绑定 → 扫码绑定”，使用 AIBanlv 手机 App 扫码确认。
2. 在角色列表选择线上角色，再开始对话。
3. 需要电脑任务时，在插件中心配置 Harness 或接入自己的工作工具。

线上角色使用平台服务和在线积分；填写本地 Key 不会改变线上角色的费用来源。
已有公共人物显示在桌面上，也不代表已完成扫码绑定或具备在线对话权限。

### 使用自己的本地角色

1. 打开“设备绑定 → 本地模式设置”，填写自己的 **Qwen Realtime API Key**，用于实时语音和声音复刻。
   服务地区按本机地区自动选择，填写界面所示地区对应的 Key；默认模型的 Workspace ID 为选填。
2. 文字对话和电脑任务可使用 **DeepSeek API Key**，或按下一节接入已登录的 Harness 客户端。
   客户端已连接并登录时优先使用客户端账号。本地智囊团生成仍需要自己的 DeepSeek Key。
3. 点击角色列表旁的“+”，选择本地模式，填写名称和人设，导入有权使用的 **LAM ZIP 形象包与声音文件**；头像照片为可选项。

**当前新建本地角色必须提供形象包和声音文件，声音复刻必须有自己的 Realtime Key。**
已有本地角色可在没有 Realtime 配置时使用可用的 DeepSeek/Harness 文字通道；
不要将“只登录 Harness”描述成新用户已经具备本地角色和语音。Codex、WorkBuddy 的登录也不代替 Realtime 配置。

本地角色、人设、记忆和对话记录保存在本机，不上传 AIBanlv；模型请求仍需联网，费用由自己的模型服务账号承担。
Key 在应用内填写，可选择在本机加密保存，不要粘贴到 AI 聊天、终端或安装日志。
详细数据流见 [本地角色说明](local-companion-spec.md)。

## 4. 按需连接工作工具

独立使用桌面伴侣无需同时安装三个宿主。内置 Harness 可使用自己的 DeepSeek Key；
接入外部客户端则需先安装并登录对应客户端。下面的入口适用于本仓库源码，安装包需确认对应发行版已包含这些入口。

| 宿主 | 安装或配置一次 | 接入后的作用 |
| --- | --- | --- |
| Harness | 将 `demos/web-desktop-pet/harness-client-plugin` 安装到当前实际使用的 profile | 插件加载时尝试唤起伴侣；已登录账号可承接本地角色的文字和电脑任务 |
| Codex | 将仓库根目录添加为本地插件市场，安装 AIBanlv 插件并审核 hook | 开始或恢复本地会话时尝试唤起伴侣；桌面端另通过本机 Codex 运行程序连接任务 |
| WorkBuddy | 导入 Setup 生成的 `demos/web-desktop-pet/artifacts/local-launch/workbuddy-mcp.json` | 连接器初始化时尝试唤起伴侣；桌面端另跟踪任务或调用本机任务运行程序 |

### Harness

优先使用当前宿主实际提供的插件安装工具，目标是上表的 **harness-client-plugin 子目录**。
Windows 桌面版没有安装工具时，完全退出 Harness 后，在独立终端使用其安装目录附带的 CLI：

```powershell
& '<Harness 安装目录>\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<源码根目录>\demos\web-desktop-pet\harness-client-plugin'
```

将占位符替换为本机实际路径。普通 CLI 使用 `dsh plugin --profile '<当前 profile>' add '<插件目录绝对路径>'`；
保留已有 profile 和插件，不为安装另建 profile，也不改模型配置。
重新打开 Harness 并登录后，可在 AIBanlv“插件中心 → Harness”查看来源是否为客户端账号。
客户端连接只承接文字和任务，语音仍按所选角色模式配置。

### Codex

使用支持本地插件市场和 `SessionStart` hooks 的本机 Codex，在终端添加本仓库：

```powershell
codex plugin marketplace add '<源码仓库根目录>'
```

在插件列表选择 **AIBanlv 本地插件**，安装 **AIBanlv 桌面伴侣**，按宿主提示审核并信任 hook。
开始或恢复本地会话后才会触发启动；只打开客户端主窗口不保证触发，云端会话不适用。
桌面端的任务连接还需要可用且已登录的本机 Codex 运行程序，可在“插件中心 → Codex”查看连接结果并选择任务目录。
官方机制参考：[本地插件市场命令](https://learn.chatgpt.com/docs/cli/reference)、[Hooks](https://learn.chatgpt.com/docs/hooks)。

### WorkBuddy

在 WorkBuddy“专家·技能·连接器 → 连接器 → 自定义连接器”中，按当前界面格式导入或合并上表中的 MCP 配置，保留已有连接器。
它是本地 **stdio** 连接器，使用已安装的 Electron 的 Node 运行模式，不要改成远程 HTTP 服务。
应用打开后也会在用户资料目录生成 `desktop-mcp-config.json`：Windows 位于 `%APPDATA%\Control Device`，
macOS 位于 `~/Library/Application Support/Control Device`。

连接器提供 `aibanlv_open` 和 `aibanlv_status`，分别用于打开伴侣和查看启动登记状态。
`aibanlv_status` 不代表桌面进程或任务执行器已经就绪；发任务还需已登录的 WorkBuddy 和可用的任务目录。
WorkBuddy 可能在新任务选用连接器时才加载它。

更多启动开关、退出恢复与排查见 [本地插件与独立启动](desktop-launch-guide.md)。
宿主插件安装成功、自动启动成功、任务连接成功应分别报告，不用创建真实任务来自动验证安装。

## 5. 日常启动、更新与排查

任务权限见[源码端安全说明](CLIENT_SECURITY.md)：Codex 的扩权请求由本机确认；WorkBuddy 只使用已验证支持的 `dontAsk` 模式；连接 Harness 执行电脑任务前需在本机选择并确认工作目录。安装助手不得为了跳过这些步骤而开启自动批准。源码及 Harness 连接插件更新后，退出并重开两端使改动生效。

- **启动与退出：** 日常使用桌面快捷方式。关闭窗口会隐藏；从托盘“退出”后暂停宿主自动拉起。
  再次手动打开或调用 `aibanlv_open` 可恢复暂停，主动关闭的长期自动启动开关仍保留。
- **更新源码：** Git 克隆的目录可在应用内“检查更新 → 更新并重启”，自动拉取当前分支上游并按需准备依赖和资源。
  本地有未提交修改、分支分叉或缺少上游时会提示处理，不覆盖用户代码。安装包使用其对应更新流程。
- **Setup 失败：** 查看退出码及 `%LOCALAPPDATA%\AIBanlv\logs\setup-*.log`，按具体失败步骤恢复。
  再次初始化前退出该源码目录的 AIBanlv，按提示断开占用同一 Electron 的 MCP 连接。
- **目录移动或资源损坏：** Windows 重跑 Setup；移动目录后重新登记并更新受影响的宿主路径。
  资源缓存与单独修复见 [源码运行环境](source-runtime-guide.md)，更新失败恢复见 [源码更新机制](source-update-spec.md)。

## 6. AI 助手执行约定

- 先识别系统、CPU、用户要求的版本和已知安装目录，读取本仓库 `AGENTS.md`。复用已有设置和源码修改，不扫描无关磁盘。
- 用户已明确安装及接入范围时，完成该范围内的步骤；只缺少必要信息时提问。普通安装不自动接入用户未要求的其他宿主。
- Windows 使用上面的初始化脚本；按已有锁文件安装，不为了消除错误升级依赖或重写锁文件。
  安装包用户按对应发行说明操作，源码与安装包之间的切换需有用户依据。
- 系统授权、账号登录、扫码和 Key 输入由用户处理，保留宿主与系统安全检查。
  如果安装要求退出承载当前会话的宿主，提供填好实际路径的外部命令和执行时机，不自行结束该宿主。
- 普通安装不打包、不发布、不跑整套开发测试，也不自动点击模型测试、创建真实任务、朗读邮件或传输文件。
  用户要求验证时说明范围，优先使用已有本地测试；资源校验与模型连通性验证分别报告。
- 结束时列明实际完成的安装方式、目录、启动结果和所请求宿主的接入结果；剩余登录、扫码、Key 或形象配置应明确写出。
  遇到失败只报告失败步骤、相关日志和必要的下一步，不反复执行同一失败命令。
