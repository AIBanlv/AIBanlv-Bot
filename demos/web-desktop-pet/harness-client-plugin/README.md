# AIBanlv 与 Harness 客户端连接插件

此目录也包含共用启动器、Codex 本地插件和 WorkBuddy MCP 入口，完整步骤见
[本地插件与启动说明](../../../docs/desktop-launch-guide.md)（源码仓库）。

安装后，AIBanlv 可以把本地角色的 DeepSeek 聊天和电脑任务交给本机已登录的 DeepSeek Harness 客户端，
无需再填写 DeepSeek Key。客户端账号用量按 DeepSeek 的规则计算，不扣 AIBanlv 平台积分。
线上角色的对话仍按平台规则计费；本地角色的 Realtime 使用自己的配置。

## 安装一次

在 Harness 的插件安装入口选择本目录，或让客户端中的助手安装这个本地插件。
源码目录为 `control-windows/demos/web-desktop-pet/harness-client-plugin`；分发版在应用目录附带同名文件夹。
保留目录，不要在安装后移动或删除。支持 Harness 0.2.1-rc.2 至 0.2.x。

Windows 桌面版也可以先退出 Harness，再用其自带 CLI 安装：

```powershell
& '<Harness 安装目录>\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<本插件目录的绝对路径>'
```

先运行一次 AIBanlv 或完成源码初始化，登记本机运行路径。重新打开 Harness 并登录，
插件加载时会尝试一次自动启动 AIBanlv。在 AIBanlv 的“插件中心 → Harness”中，
当前来源应显示“使用 Harness 客户端账号”。无需在 AIBanlv 重复登录或粘贴账号凭据。
普通 CLI 用户改用 `dsh plugin --profile <实际使用的 profile> add <本插件目录>`，不要另建 profile。

## 使用规则

- 连接插件已加载、客户端正在运行且已登录：优先使用客户端账号，即使 AIBanlv 已保存自有 Key。
- 客户端未连接或未登录：新任务使用“设备绑定 → Key 配置”中的自有 Key，由内置助手执行；未填 Key 则提示配置。
- 执行过程中断线、退出登录或切换来源：停止本次任务，不改用另一来源自动重做。超时时请先在客户端核对结果。
- 原生电脑任务先由本机选择并确认工作目录，再在 Harness 中创建独立会话；取消、目录不可用或断线时不执行，不默认使用用户主目录。工具及审批遵循客户端设置，工作目录本身不是沙箱；只读分类、聊天和汇报不执行工具，也不要求选择目录。
- 关闭“启用电脑助手”会暂停此连接及电脑任务；自有 Key 的普通文字聊天仍可用。
- “测试 DeepSeek”：当前填了 Key 就测试该 Key；留空且客户端已连接登录时测试客户端，否则使用已保存的 Key。

## 本机连接与排查

插件只读取 AIBanlv 创建的配对文件：Windows 为 `%APPDATA%\Control Device\harness-connection.json`，
macOS 为 `~/Library/Application Support/Control Device/harness-connection.json`。
该文件含随机本机配对口令，请勿分享。它不含 DeepSeek Key；关闭 AIBanlv 后会删除。
开发或隔离测试可在插件配置中使用 `connectionFile` 指定配对文件。

通信只访问带随机鉴权的 `127.0.0.1` HTTP 服务；模型调用和登录凭据留在 Harness。
只传用户要求的任务、已确认的工作目录、必要对话上下文和公开回复，不读取凭据文件，不传内部推理或工具参数。
该插件不会自动启动 Harness，也不会更改客户端模型、账号或其他插件。

## 自动启动与其他宿主

插件加载时只尝试拉起已登记的 AIBanlv，不轮询重启进程。Harness 插件配置
`autoStart: false` 可只保留账号连接。关闭宿主不关闭 AIBanlv。
主动退出 AIBanlv 后暂停自动拉起，手动双击打开后恢复；单实例保证多个宿主共用桌面程序。

Codex 使用本目录的 `.codex-plugin/plugin.json` 和 `hooks/hooks.json`。
源码仓库根目录、安装分发目录根部均带 `.agents/plugins/marketplace.json`，可用
`codex plugin marketplace add <根目录>` 登记为本地市场，然后在客户端安装并审核 hooks。
触发点是 `SessionStart`（startup/resume），不是单纯打开客户端窗口。
Windows hook 使用固定 EncodedCommand 适配宿主 shell，解码内容为
`$ProgressPreference = 'SilentlyContinue'; & (Join-Path $env:PLUGIN_ROOT 'run.ps1') -Automatic`，
关闭 PowerShell 模块加载进度输出后，只调用插件内的脚本。

WorkBuddy：先打开一次 AIBanlv，然后在“自定义连接器”中合并/导入用户资料目录下的
`desktop-mcp-config.json`。Windows 目录为 `%APPDATA%\Control Device`，macOS 为
`~/Library/Application Support/Control Device`。这份配置直接使用 AIBanlv 的运行时，
不需要系统 Node；不要覆盖已有其他 MCP 配置。它提供 `aibanlv_open` 和 `aibanlv_status`，
不读取任务记录或登录凭据。仅在本地连接器加载并初始化时自动尝试启动。

Windows 可通过本目录 `run.ps1 -DisableAutoStart` / `run.ps1 -EnableAutoStart` 关闭/恢复
全部宿主的自动启动（从 PowerShell 调用脚本路径）。macOS 对应 `sh run.sh --disable-auto-start`
与 `sh run.sh --enable-auto-start`。源代码或安装路径移动后，需要重新登记并重新导入连接器配置。

安装版通过原有在线更新；源码通过 Git 更新。插件升级后按宿主要求刷新/重装插件、审核变更的 hooks。

没有连接时，先确认两端已重启、插件加载到正在使用的 profile、客户端已登录、电脑助手已启用。
“测试当前连接”会真实调用所显示的来源，可能产生少量供应商费用。

实现参考 `aibanlv-harness-plugin` 的公开 Host 服务和本机桥接方式；此目录自带完整源码，
运行不依赖该参考仓库。使用宿主公开的 `llm`、`agents`、`deepseekAccount` 服务。
