# 本地插件与独立启动

首次安装、角色与模型配置、三个宿主的接入步骤统一见[安装与首次使用](INSTALL_FOR_AGENTS.md)。
本页补充源码启动登记、开关、退出恢复及排查。安装包是否包含下列入口，以对应发行版为准。

一套 AIBanlv 可以独立双击，也可以由本地宿主拉起。多个入口使用同一个实例、绑定和设置。
自动拉起不会触发模型调用；正常使用对话时仍按所选角色及模型来源计费。

## Windows 源码首次配置

1. 安装 Git、拉取源码，双击根目录 `Setup AIBanlv.cmd`。缺少 Node/npm 或 Node 低于 24 时，脚本自动准备专用环境。
2. 脚本安装项目依赖并自动准备 Python、LAM 模型与 JDK，验证后登记运行目录，创建 `AIBanlv Source` 桌面图标。
3. 以后双击图标或根目录 `Start AIBanlv.cmd`。启动器复用已登记的 Node，再启动本地 Electron，不依赖系统 PATH 中的 Node。

Windows 无需另装 Python、Java 或手工寻找模型。首次资源下载约 669 MiB；失败后重跑即可。
需要补齐 Node 时另下载约 36 MiB 的官方便携包，校验后存入 `%LOCALAPPDATA%/AIBanlv/tools/`。不改系统 PATH、不切换 nvm，也不需要管理员权限。日常启动不下载；环境损坏时重跑 Setup 修复。Node/npm 检测有超时，并隔离宿主的 Node 启动参数。
官方源不可用时自动尝试 npmmirror 镜像，仍按同一官方哈希校验；每个下载源最多等待 180 秒，失败后可重新双击初始化。
已有自定义配置仍可保存在 Demo 的 `runtime.local.json`，环境变量优先；不上传该文件。
资源缓存、修复与离线导入见[源码运行环境](source-runtime-guide.md)。

已经完成依赖和运行资源准备、只需重新创建图标时，可以从仓库根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File demos/web-desktop-pet/scripts/setup-source.ps1 -SkipInstall
```

代码目录移动后重新执行初始化；应用内源码更新会自动处理依赖与资源版本变化。
脚本失败会保留错误信息，不把未完成的依赖安装当成成功。
再次初始化前，请从 AIBanlv 托盘菜单选择“退出”，关闭窗口只会隐藏程序。
Setup 和 `npm run setup:deps` 会先检查此源码目录的 Electron 占用；发现正在运行的桌面或 MCP 进程时，先停止安装，避免 `npm ci` 删除部分依赖后才报 `EBUSY`。
如已退出但仍提示占用，请断开指向该源码目录的 WorkBuddy/MCP 连接后重试；其他目录的 Electron 不受影响。
双击初始化的完整输出保存到 `%LOCALAPPDATA%\AIBanlv\logs\setup-*.log`，失败时显示具体退出码和日志位置。若之前安装已中断，退出占用程序后重新双击 Setup 即可恢复依赖。

macOS 自动资源尚未发布，新用户按[统一安装流程](INSTALL_FOR_AGENTS.md#macos)和 [Mac 环境说明](../MAC-TEST.md#启动)准备本地环境；已有环境可执行 `npm run setup` 验证。然后执行
`node demos/web-desktop-pet/harness-client-plugin/desktop-launch.mjs --register-source` 登记；
现有 `npm start` 保留。桌面快捷方式生成脚本本次只提供 Windows 版本。

## 宿主安装一次

### DeepSeek Harness

先完成源码初始化，或打开一次安装版 AIBanlv。
优先使用当前宿主实际提供的插件安装工具，选择 `demos/web-desktop-pet/harness-client-plugin`；
包含此连接插件的安装版选择分发目录中的 `harness-client-plugin`。
Windows 桌面版无安装工具时，完全退出 Harness 后使用自带 CLI；若当前会话由它承载，先提供外部命令，不自行结束宿主：

```powershell
& '<Harness 安装目录>\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<插件目录绝对路径>'
```

重启 Harness；插件加载时自动尝试启动 AIBanlv。已登录 Harness 的账号桥接继续保留。
支持 Harness 0.2.1-rc.2 至 0.2.x；插件配置 `autoStart: false` 可单独关闭此宿主的拉起。
普通 CLI 使用实际正在使用的 profile，保留原设置；不要为接入另建 profile。

### Codex

源码仓库提供本地插件市场；安装包需确认分发目录已包含该入口。先登记 AIBanlv，再添加市场：

```powershell
codex plugin marketplace add '<源码仓库根目录或安装分发根目录>'
```

在客户端插件列表选择 **AIBanlv 本地插件**，安装 **AIBanlv 桌面伴侣**。
按宿主要求审核并信任 hook；更新 hook 后可能需要重新审核。
开始或恢复本地会话时自动尝试拉起；仅打开客户端窗口不保证触发。
插件可复制到 Codex 缓存，无需将整个源码项目复制进缓存。

需使用支持本地插件市场及 `SessionStart` hooks 的客户端版本。
本功能不适用于云端会话，也不会改变 Codex 登录、模型或权限设置。

### WorkBuddy

源码初始化生成 `demos/web-desktop-pet/artifacts/local-launch/workbuddy-mcp.json`。
源码与包含此连接器的安装版在打开一次后，也会生成用户资料目录下的 `desktop-mcp-config.json`：

- Windows：`%APPDATA%\Control Device\desktop-mcp-config.json`
- macOS：`~/Library/Application Support/Control Device/desktop-mcp-config.json`

在 WorkBuddy 的“专家·技能·连接器 → 连接器 → 自定义连接器”按页面格式导入/合并配置，
保留已有连接器。它是本地 stdio 服务，使用已安装的 Electron/AIBanlv 的 Node 运行模式。
不能配置为远程 HTTP 服务，不需要填写模型 Key。

连接器初始化时自动尝试启动一次。可显式调用 `aibanlv_open` 打开/恢复，
`aibanlv_status` 查看是否已配置、启用或暂停（该状态不代表桌面进程已经就绪）。
WorkBuddy 可能在新任务选择连接器时才加载它；不承诺只打开主窗口就触发。
更换源码/安装路径后重新登记，并重新导入生成的配置。

## 退出、恢复与更新

关闭宿主不关闭 AIBanlv。重复自动启动不打开设置窗口；手动重复启动会打开已有窗口。
主动退出 AIBanlv 后暂停宿主自动拉起，避免新会话或连接器重连立即打开它。
再次双击桌面图标/启动入口，或显式调用 `aibanlv_open`，恢复此暂停。

要长期关闭/重新开启所有宿主的自动启动，从插件目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 -DisableAutoStart
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 -EnableAutoStart
```

macOS 使用 `sh run.sh --disable-auto-start` / `sh run.sh --enable-auto-start`。
长期关闭选项不会被普通手动启动重新打开。开机自启动属于原有安装版设置，与宿主启动独立。

安装版沿用应用内安装包更新；源码版点击“检查更新”→“更新并重启”，自动拉取当前分支上游，
按需安装依赖并重启。Windows 源码启动器和更新器复用 Setup 登记的 Node.js 24+，Mac 使用系统 Node；依赖安装失败后再次双击可以继续未完成的更新，
即使 Electron 尚未装好也可恢复。更新需要关闭占用同一源码 Electron 的宿主 MCP 连接后重试时，会显示提示。
宿主缓存了旧插件时，按宿主的插件更新/重新安装流程刷新；无需重装桌面程序。详见[源码更新机制](source-update-spec.md)。

## 验证范围

自动测试使用隔离目录和本地服务：固定目标和退出暂停、Harness 生命周期、MCP 握手与输入边界、
Windows 原生脚本/快捷方式与缓存插件 stdio、Electron 多入口单实例。未创建收费会话。
实际 Harness/Codex/WorkBuddy 客户端的安装界面与加载时机、macOS 原生启动仍需对应客户端验收。
本次未构建 EXE 或上传更新包，安装版新能力需随下一次正式构建发布。
