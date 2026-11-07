# 源码版应用内更新（2026-11-03）

用户要求把源码更新说明改成按钮执行，不再要求用户输入 Git/npm 命令。
本规格取代 windows-online-update-spec.md 中源码模式只提供说明的要求。

## 行为

- “检查更新”查询当前分支已配置的上游；显示当前/目标提交及更新状态。
- 发现更新后点“更新并重启”：准备独立更新进程，正常退出应用，快速前进到刚检查的提交；
  依赖清单变化时执行 `npm ci` 和 `npm run setup:deps`，旧源码兼容 `npm run setup`。
  `source-runtime.lock.json` 变化时独立执行资源准备，验证成功才重启；只有资源变化时不重装 npm。
- 更新进程使用源码目录之外的 Node.js 24+，避免 npm 重装 Electron 时删除自身运行时。
  Windows 优先使用 Setup 登记的专用 Node/npm，兼容合适的系统 Node；环境缺失时提示重跑 Setup 自动准备。
  检查并定位 Node/npm 后才允许退出；无需额外下载更新器。
- 源码更新器及任务配置复制到临时目录，退出交接有令牌、就绪回执、取消文件和超时。
  等待旧进程彻底退出后才修改工作区。失败保留明确状态，Windows/macOS 原生提示可重试。
  重试只在原分支和原提交或本任务已应用的目标提交上继续，不自动回滚用户代码。
- 回执原子关联不可变任务文件；续装交接失败或退出等待超时，不会清除此前未完成的依赖安装。
  源码快捷方式使用已准备的外部 Node，Electron 被中断的安装移除后仍可继续；待续装检查不依赖 Git 网络。
  同一仓库的更新进程通过操作系统锁互斥，进程退出自动释放。Windows 使用命名管道；
  其他平台使用按仓库路径确定的本机回环端口，端口被占用则拒绝此次交接，不并发安装。
- 未提交的受跟踪文件、分离 HEAD、缺少上游、分支分叉或检查后代码变化时拒绝更新，
  不使用 reset、stash、clean 或切换分支。未跟踪和忽略文件不主动清理；Git 禁止覆盖忽略文件。
- 无依赖变化时不重装依赖；安装失败重试仍须完成依赖步骤，不能把新 HEAD 当成成功。
- 资源下载或推理验证失败同样保留待完成任务；旧运行资源继续保留。启动器不会把旧版自动填充的运行路径当成用户覆盖，详见 [源码资源规格](source-runtime-spec.md)。
- 渲染层仅触发检查/更新，不提供命令、路径、远程或分支；源码版不访问安装包清单。
  安装版原有 Cloudflare 全量/增量下载和安装交接保持。

## 实现与风格

`electron/device-source-git.mjs`：有界命令、仓库预检、上游检查和快速前进；
`device-source-update.mjs`：应用内状态、运行时预检和独立进程交接；
`device-source-update-worker.mjs`：等待退出、更新依赖、重启和失败重试。
复用 update-mode、现有受限 IPC、更新弹窗、系统退出清理和源码启动入口。
ESM、两空格、具名函数、参数数组和无 shell 进程；错误不暴露远程地址及原始凭据。

## 顺序与验证

1. Git 检查及保护：本地 bare remote/两个 checkout，覆盖快进、分叉、脏文件与未跟踪文件。
2. 独立交接：本地假应用和 npm 夹具，验证退出前零修改、依赖失败恢复、超时与自动重启。
3. 弹窗及主进程：真实 Electron 加载源码入口，使用本地 Git 夹具，验证按钮、IPC、错误、
   320/768/1024/1440 布局、键盘和 axe；安装版回归。
4. 根目录 `npm test`；Demo 内 `node tests/device-update-electron.mjs`，
   源码场景设置 `DEVICE_UPDATE_SOURCE_ONLY=1` 运行同一脚本；`git diff --check`。

仅操作临时测试仓库，不用更新按钮改写开发者当前 checkout，不调用收费服务。
不生成安装包、不改服务端；源码更新会运行用户当前上游仓库的安装脚本，并按资源清单下载独立的 Cloudflare 资源包。

## 本次验证结果

- Node.js 24.11.0：根目录 `npm test`，744/744 通过，零跳过。
- Demo 内 `node --test tests/device-source-update.test.mjs tests/device-source-git.test.mjs tests/device-update-mode.test.mjs`，15/15 通过。
  含真实本地 Git、依赖失败续装、重复恢复互斥、晚到进程取消、独立进程存活及重启。
- Demo 内 `DEVICE_UPDATE_SOURCE_ONLY=1 node tests/device-update-electron.mjs` 和不设该变量的安装版场景均通过；
  源码检查/取消/脏代码/交接重试、受限 IPC、安装版增量/全量/校验/取消均由本地夹具验证。
  320/768/1024/1440 截图、键盘与 axe 均通过，截图保存在 `artifacts/windows-update/`。
- Windows 5.1 原生窗口冒烟：中文标题、回执进度刷新、完成自动关闭及失败对话框取消返回值通过。
  本地验证脚本为 `artifacts/source-progress-smoke.ps1`、`artifacts/source-retry-smoke.ps1`，未随产品分发。
- 独立代码审查已复核并发与恢复修复，无剩余阻断项；`git diff --check` 通过。
- macOS 启动器已同步，原生窗口与进程运行尚需在 Mac 上验收；本次未构建 EXE/安装包。
