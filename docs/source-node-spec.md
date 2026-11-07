# Windows 源码启动环境补齐

## 目标

双击 Setup 时，缺少 Node 或默认 Node 低于 24 不再直接退出。复用可用的 Node 24+ 与配套 npm，否则安装固定版本的官方便携包。系统 Node、nvm 和持久 PATH 保持原样。

## 行为与结构

- `harness-client-plugin/source-node.ps1` 提供初始化与启动共用的环境选择；固定包清单位于同目录 `source-node.json`。
- 使用 `%LOCALAPPDATA%/AIBanlv/tools`，缓存独立于 checkout 与 node_modules；保存选中的 Node 路径供插件缓存和源码更新读取。
- 先使用已登记的有效环境，再检查 PATH，最后在 Setup 中自动下载。Node 与 npm 必须配套，Node 至少 24、Windows x64，且位于源码仓库之外。
- 每个下载源有覆盖整个响应体的 180 秒超时，官方源失败时回退 npmmirror；两者使用同一官方固定大小与 SHA-256 校验。响应体最多缓冲一个约 36 MiB 的 Node 包；临时解压并验证 Node/npm 后发布，失败不登记成功。重复初始化使用文件锁保护缓存。
- 日常启动与检查更新只读取已准备好的环境，不自动下载；异常时提示重新运行 Setup。
- Node/npm 探测子进程隔离 `NODE_OPTIONS` 等宿主参数，分别设 10 秒硬超时，npm 的非致命 stderr 警告不会被当成不可用。
- Git 仍是拉取/更新源码的前提；缺少时提供清楚的安装提示。Mac 保持现有 Node 准备方式。
- Windows Setup 在根目录 `npm ci` 之前检查当前源码 Electron 的进程占用，`setup:deps` 在 renderer 和 Demo 的安装前分别显式执行同一检查；不依赖被 `ignore-scripts` 禁用的 npm 生命周期钩子。占用时提示从托盘退出或断开本目录 MCP，不结束进程。确认属于其他 checkout 的 Electron 不阻塞；进程路径不可读时停止安装，不把未知当作空闲。
- Setup 将完整输出写入用户本地日志目录；失败显示阶段、退出码及日志位置，便于定位真正的 npm/运行时错误。安装期间应保持该目录的桌面及 MCP 关闭；检查不是阻止其他进程启动的全局锁。

## 实现顺序与风格

先以 PowerShell 5.1 实现选择/下载及本地夹具测试，再接入 Setup、插件启动、更新器。沿用具名函数、参数数组调用程序；例如 `& $node $npm ci`，不拼接 shell 命令。说明放入现有源码启动与运行环境文档。

## 验证

- Demo：`node --test tests/source-node.test.mjs tests/device-source-entry.test.mjs tests/device-source-update.test.mjs`，覆盖无系统 Node、缓存复用、配套 npm、坏包拒绝和源码目录内 Node 拒绝。
- Windows PowerShell 5.1：真实下载固定官方包、实际执行 Node/npm，验证系统 Node 23 不变；现有入口测试使用隔离配置和桌面目录。
- Demo：`DEVICE_UPDATE_SOURCE_ONLY=1` 下运行 `node tests/device-update-electron.mjs`；根目录运行 `npm test`。

## 边界

不自动修改系统环境、安装 Git、打包 EXE、改变模型或账号配置。不得提交下载包、用户路径登记文件及日志。Node 固定为官方当前 24 LTS 的 24.22.2，升级包版本时同步校验清单并重新验收。

## 验证结果（2026-11-04）

- 官方 Node 24.22.2 ZIP 下载、大小/SHA-256 校验、解压和实际 Node/npm 执行通过；系统 Node 前后均为 23.11.1。
- 追加限速网络验收中，镜像全包请求未在 180 秒内完成，新的下载器按时退出；该轮未完成镜像全包验收。已安装的官方包仍可复用，网络失败时不会将不完整内容登记为可用环境。
- 无 PATH Node 的完整初始化使用真实 npm 与离线空依赖夹具通过；快捷方式、缓存插件 stdio、外部 Node 更新选择通过。
- 错误大小和同大小错误哈希均被拒绝；继承失效宿主 loader 不影响探测；挂起 npm 在 10 秒后被终止；已有环境启动不等待下载锁。
- 根目录 `npm test`：797/797 通过，0 跳过，包含响应头已到达但响应体一直不结束的下载超时回归。`DEVICE_UPDATE_SOURCE_ONLY=1 node tests/device-update-electron.mjs`：本地 Git/更新界面和交接检查通过，仍有原有 Electron DEP0190 与监听器数量警告。
- 独立代码审查通过。未构建安装器；Mac 行为未改动，本次只验收 Windows。

### 初始化占用错误回归（2026-11-04）

- 实际 npm 日志定位为运行中的源码 Electron 占用 `default_app.asar`，导致 Demo 的 `npm ci` 部分删除依赖后报 `EBUSY`；Node 准备已经成功。
- 从托盘退出后，真实 `npm run setup` 恢复成功；修复后的原始 `Setup AIBanlv.cmd` 完整执行成功，验证本地推理资源并重新生成实际桌面快捷方式及 MCP 配置。系统默认 Node 仍为 23.11.1，Setup 使用专用 Node 24.22.2。
- 入口回归覆盖同目录进程阻止安装且保留依赖、其他目录进程不误拦截、退出后可重试、直接 npm 入口保护，以及原始错误和退出码写入本地日志。最终根目录 `npm test`：797/797，0 跳过。未构建安装器。
