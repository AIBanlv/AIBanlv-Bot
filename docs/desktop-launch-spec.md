# 本地插件与独立启动

用户于 2026-11-03 确认：一套 AIBanlv 支持 Harness 插件加载、Codex 会话开始、
WorkBuddy 本地 MCP 加载时拉起，也可通过桌面快捷方式独立启动。

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| desktop-launch | 登记运行目标、手动/自动启动、暂停状态、单实例 | 现有 Electron 主进程 |
| host-launch | Harness 加载入口、Codex hook、WorkBuddy stdio MCP | desktop-launch |
| source-entry | Windows 初始化、双击启动、快捷方式、接入配置 | desktop-launch、host-launch |

按表中顺序实施；本次用户已确认上述边界，不改宿主账号与模型、不构建安装包。

## 行为与边界

- 程序成功取得单实例锁后，登记自己的源码目录或应用路径。登记和暂停标记位于
  `Control Device` 用户资料目录；隔离测试使用 `PET_DEVICE_USER_DATA`。
- 启动器只执行固定的 AIBanlv/Electron 入口，使用参数数组、隐藏辅助进程和独立子进程，
  不接受模型提供的目录、命令或参数，不访问模型或收费接口。
- 自动启动需要已登记的目标且没有禁用/暂停；手动启动恢复暂停。用户退出 AIBanlv 后，
  暂停宿主自动启动，直到再次手动打开或显式恢复，避免新会话、连接器重连反复拉起。
- 自动重复启动不抢焦点；手动重复启动打开已有设置窗口。插件退出不终止桌面程序。
- Harness 每次加载仅尝试一次，可通过 `autoStart: false` 禁用；仍保留原有账号桥接。
- Codex 使用本地插件 `SessionStart` 的 startup/resume 事件，遵循宿主 hook 信任检查。
  它不是客户端窗口打开事件，也不支持云端 hook 拉起用户本机。
- WorkBuddy 使用本地 stdio MCP，初始化时尝试一次；仅提供打开与启动状态工具。
  不承诺 WorkBuddy 在窗口打开时加载连接器，不能用 CodeBuddy CLI 测试替代桌面宿主验证。
- Windows 源码初始化检查 Node 24+，安装锁定依赖，登记目标并创建快捷方式及本地 MCP 配置。
  日常启动使用已安装的 Electron，无需在 PATH 中保留 Node。完整推理的模型/Python/Java
  继续沿用已有 `runtime.local.json`，初始化不下载模型或替用户选择推理环境。
- 插件可被宿主复制到缓存，仍通过登记找到主程序；源码目录移动后重跑初始化。
- 更新策略与启动入口正交：源码沿用 Git，安装版沿用在线更新。

## 实现、风格与验证

现有 ES modules、单引号、无新增依赖。例如：
`await launchDesktop({ automatic: true, directory })`。

共用模块和宿主清单位于 `demos/web-desktop-pet/harness-client-plugin/`；
Windows 初始化位于 Demo 的 `scripts/`，根目录提供双击入口。
Node 测试位于 Demo `tests/`，用临时目录、子进程和本地服务验证路径、暂停与协议边界。

从 Demo 执行 `node --test tests/device-desktop-launch.test.mjs`，
`node --test tests/device-host-launch.test.mjs`，`node tests/device-launch-electron.mjs`；
从根目录执行 `npm test` 和 `git diff --check`。包装白名单必须包含共用模块和完整插件。
不跳过既有失败测试；记录已有失败和真实宿主、macOS 未验证项。

官方依据：
- https://developers.openai.com/codex/hooks
- https://developers.openai.com/plugins/build/plugins
- https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector

## 2026-11-03 验证结果

- Node 24.11.0，根目录 `npm test`：738 项，737 通过、1 项既有失败、无跳过。
  失败仍为 `tests/device-qr-only.test.mjs:42` 的游客形象旧断言，本轮未修改或屏蔽。
- `node --test tests/device-desktop-launch.test.mjs tests/device-source-entry.test.mjs`：7 项通过，
  包括并发登记、真实 PowerShell 初始化/快捷方式、实际 Codex hook 命令和缓存插件 stdio。
- Harness、MCP、打包复制及入口依赖图测试已包含在上述完整 Node 套件，均通过。
- `node tests/device-launch-electron.mjs`：真实 Electron 单实例、自动不抢窗口、手动显示、退出暂停、重开恢复通过。
- 设置 `DEVICE_UPDATE_SOURCE_ONLY=1` 后执行 `node tests/device-update-electron.mjs`：
  源码更新说明、无更新网络请求、键盘、320/768/1024/1440 宽度及 axe 通过。
- `bash -n demos/web-desktop-pet/harness-client-plugin/run.sh` 与 `git diff --check` 通过。
- 未构建安装包、未更改真实宿主配置、未发起收费会话；真实宿主安装/加载时机与 macOS 仍待目标环境验收。
