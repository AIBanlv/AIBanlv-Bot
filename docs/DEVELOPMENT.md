# 开发、构建与发布指南

面向源码开发者和维护者。产品介绍、安装入口与使用方式见[项目首页](../README.md)。

`control-windows` 是 AIBanlv 桌面端的统一开发仓库，支持 Windows x64、macOS Intel x64 和 Apple Silicon arm64，共用界面与对话源码。
主要功能包括角色形象、文字与语音对话、手机绑定，以及 Harness、只读邮箱、Codex 和 WorkBuddy 任务协同。
Windows 使用原 PyTorch/LAM 模型，Mac 使用 Core ML；应用版本以根目录和 Demo 的 `package.json` 为准，Electron 版本独立维护。

本文保留开发、打包与部署所需的操作步骤。产品行为、协议和历史验收记录见末尾的文档入口。
除特别说明外，命令均在本仓库根目录执行。

## 最新功能说明

- 设置统一采用独立菜单页：“设备绑定”“形象设置”“AI智囊团”“定时任务”“邀请记录”和插件中心；窗口设置合并在形象设置内，侧栏隐藏滚动条。
- AI智囊团与手机同步动态、图片/视频、点赞和评论，需后端支持 `desktopMomentsV1`，见 [AI智囊团规格](ai-moments-spec.md)。
- 各页面标题栏“分享邀请”打开统一透明弹窗，展示奖励规则并分别复制邀请链接、邀请码；邀请记录显示脱敏账户名和成功时间，首次设备登录可选填邀请码。
- 定时任务进入即自动加载，添加表单默认收起；剩余积分零值不反复查询，积分明细按绑定账号分页读取。
- Harness 使用独立只读语义路由和统一工具调度；明确截图指令直接执行，复杂指令先语义判断，Realtime 依据真实工具结果汇报。默认内核依赖固定为 0.2.1-rc.5。
- 邮箱、Codex、WorkBuddy 复用已保存启用状态/本机登录并自动关联；只读邮箱可单独开启“新邮件内容播报”，每次最多读 3 封新邮件的发件人、主题和正文节选，默认关闭、首次检查不读历史邮件。
- “设备已连接”下方实时展示 Harness、Codex、WorkBuddy 状态，点击可进入对应设置；首次完成绑定且没有可用工具时，自动引导填写 DeepSeek API Key，不随重连反复跳转。自动检测不会创建收费任务。
- Codex 汇报区分真实会话名、本轮要求与结果，优先显示进行中任务；外部任务只读核验原本机运行记录，不将独立 app-server 的历史中断标记当成真实中断，无法核实时显示状态待确认。
- 数字人下方“实时信息”显示本轮对话和公开任务进度，悬停或键盘聚焦展开带日期时间的互动记录；不展示隐藏推理。
- Windows 发布者字段为 Ieasysell Limited，不等同于已经接入代码签名。

具体行为、隐私与验收边界见 [设置与插件](settings-plugins-spec.md)、[语义工具与自动关联](semantic-tools-autoconnect.md)、[只读邮箱](assistant-mail-spec.md)。

## 开发启动

要求 Node.js 24+、npm，以及 Windows 10/11 x64 或 macOS 13+。安装后的桌面程序自带运行时，用户无需另装 Node、Python 或 Java。

Windows 源码用户可以先双击根目录的 **Setup AIBanlv.cmd**，完成依赖安装并创建
**AIBanlv Source** 桌面快捷方式。以后双击该图标或 **Start AIBanlv.cmd** 即可启动。
Windows 初始化会自动下载、校验并配置本地模型、Python 和 JDK，无需手工填写路径；还会生成 WorkBuddy 连接器配置。
Harness 插件、Codex 会话自动启动及安装版接入见[本地插件与启动说明](desktop-launch-guide.md)。

```powershell
npm ci
npm run setup
npm test
npm start
```

`setup` 按各目录锁文件安装依赖、Electron 和本地推理资源。Windows 首次资源下载约 669 MiB，运行环境约 1.13 GiB，准备时建议预留 4 GiB 空间。
资源缓存在 `%LOCALAPPDATA%/AIBanlv/runtimes/`，多个源码目录共享；日常启动无需重复下载。
可用 `npm run runtime:prepare` 单独检查和修复资源。高级开发者仍可通过 Demo 的 `runtime.local.json`
或 `PET_PYTHON`、`PET_LAM_SOURCE`、`GSON_JAR` 环境变量覆盖路径；`JAVA` / `JAVAC` 未配置时从 PATH 查找。
Mac 自动资源尚未发布；已有 Core ML/Java/Gson 环境会继续验证和使用，新用户按 [Mac 环境说明](../MAC-TEST.md) 准备。
资源来源、离线导入和发布方式见[源码运行环境](source-runtime-guide.md)。
真实对话和助手调用会访问线上服务，并按账号或所配置模型 Key 的规则计费。

源码启动的账号菜单提供“检查更新”，检查当前分支的上游并显示当前/目标提交。
点击“更新并重启”后，程序自动退出、快进拉取代码，依赖变化时重新安装依赖；资源要求变化时自动准备对应版本，验证成功后重新打开。
需要 Git 和源码目录之外的 Node.js 24+；存在未提交修改或分支分叉时会提示处理，不强制覆盖。
依赖安装失败可在提示框重试，或双击源码快捷方式继续。源码更新不下载安装包，详见[源码更新机制](source-update-spec.md)。

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动桌面伴侣 |
| `npm run start:web` | 启动网页开发入口 |
| `npm test` | 完整 Node 测试 |
| `npm run runtime:prepare` | 下载、校验或修复源码推理环境 |
| `npm run setup:deps` | 仅安装 npm/Electron 依赖，供高级开发与 Mac 环境准备 |
| `npm run test:device` | Electron 综合验收，环境要求见 Demo 文档 |
| `npm run windows:package` | 构建 Windows x64 应用目录 |
| `npm run windows:installer` | 将最近一次 Windows x64 应用目录制作成安装包、块图和清单 |
| `npm run mac:prepare` | 准备 Mac 推理资源 |
| `npm run mac:package:x64` / `npm run mac:package:arm64` | 分别构建 Mac 两种架构 |

Mac 的环境、模型和验收步骤见 [MAC-TEST.md](../MAC-TEST.md)，跨平台约定见 [CROSS-PLATFORM-SPEC.md](../CROSS-PLATFORM-SPEC.md)。

## Windows 打包

### 构建环境与资源

在 Windows x64 构建机准备 Node.js 24+、JDK 17+、Gson 2.11.0 和可信的原始 LAM 模型。首次构建可能需要联网下载固定版本的运行时与工具，校验失败应排查来源或缓存，不要跳过校验。

| 配置 | 用途 |
| --- | --- |
| `DEVICE_BUILD_PYTHON` | 用于提取固定推理依赖的构建 Python；其依赖须符合打包脚本的版本清单 |
| `DEVICE_MODEL_SOURCE` | 原始 LAM 源码目录，包含 `pretrained_models/LAM_audio2exp_streaming.tar` |
| `GSON_JAR` | Gson JAR 的绝对路径；未设置时尝试本机 Gradle 缓存 |
| `DEVICE_PYTHON_STAGE` | 可选：复用已验证的运行时目录，包含 `python/`、`model/`、`python-runtime.json`，替代重新组装 Python/模型资源 |
| `DEVICE_JAVA_HOME` / `MAKENSIS` | 可选：指定已准备好的 Java 运行时目录和 NSIS 编译器文件 |

没有配置构建 Python/模型路径时，脚本沿用仓库父目录中的 `.venv-lam-coreml` 和 `LAM_Audio2Expression-main/LAM_Audio2Expression-main` 布局。
源码运行的 `PET_PYTHON` / `PET_LAM_SOURCE` 与打包的 `DEVICE_BUILD_PYTHON` / `DEVICE_MODEL_SOURCE` 是不同配置。
复用运行时应确认模型、依赖与目标架构匹配，不要把开发虚拟环境直接作为分发运行时。详见 [分发约定](../demos/web-desktop-pet/electron/DISTRIBUTION-SPEC.md)。

### 版本与构建顺序

1. 先拉取、合并并验证要发布的源码，再构建安装包。源码提交后发生变化时，已有安装包不会自动更新。
2. 提高应用版本，确保根目录和 Demo 的 `package.json`、`package-lock.json` 共四个文件保持一致。
3. 先构建应用目录，再构建安装器；只执行安装器命令会沿用上一次打包目录，可能得到旧代码、旧版本。

以下以 `0.2.6` 为后续版本示例，实际发布时使用尚未发布且高于线上版本的版本号：

```powershell
npm version 0.2.6 --no-git-tag-version
npm --prefix demos/web-desktop-pet version 0.2.6 --no-git-tag-version
npm test

$env:PET_DESKTOP_UPDATE_URL = 'https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json'
$env:PET_DESKTOP_UPDATE_NOTES = '填写本次更新说明'
npm run windows:package
npm run windows:installer
```

`PET_DESKTOP_UPDATE_URL` 在构建时用于生成清单中的下载地址，不会自动更改客户端内置默认源；客户端也可通过该环境变量覆盖检查地址。当前源码默认源为 Cloudflare，下文说明旧安装版的过渡方式。

产物在 `demos/web-desktop-pet/dist/`。每个版本只需公开以下三个文件：

| 文件 | 作用 |
| --- | --- |
| `AIBanlv-<版本>-win-x64-Setup.exe` | 完整 NSIS 安装包，供首次安装和更新后的安装使用 |
| `AIBanlv-<版本>-win-x64-Setup.exe.blockmap` | 安装包的数据块索引，帮助客户端找出可复用数据并下载变化部分，不能单独安装 |
| `latest.json` | 最新版本、更新说明、EXE/块图地址、大小与 SHA-256；客户端首先读取它 |

三者必须来自同一次成功构建，文件名、大小和哈希由工具生成，不手工拼接清单或混用不同版本的块图。
`device-latest*.json`、`device-installer.json` 和构建目录包含本机路径，属于内部记录，不上传到更新目录。
本方案读取 `latest.json`，不是 `latest.yml` 或 `lastest.json`，也不需要另做补丁 ZIP。

### 打包注意事项

- 每版构建完成后，将三个公开文件一起保存到独立版本目录，再开始下一版。`dist/latest.json` 会被下一次安装器构建覆盖；可参考已有的 `dist/releases/<版本>/` 目录。
- 已经发布的版本号、EXE 和 blockmap 不覆盖、不改名；修复代码后发布更高版本。
- 增量更新依赖数据块复用，模型和依赖尽量保持稳定；大幅更换运行时或模型会增加下载量。NSIS 保持逐文件 zlib 压缩，修改压缩方式后重新验证增量效果。
- 安装包保留许可证，不能包含设备身份、账号凭据、私人形象、测试资料、日志和本地配置。模型、运行时、安装包及 `dist/`、`artifacts/` 不提交 Git。
- 图标修改后同时检查 EXE、窗口、任务栏和快捷方式；源码中配置了图标不代表目标机器的任务栏显示已经验收。
- 当前为未签名 EXE，Windows 可能提示未知发布者或阻止运行。HTTPS 和 SHA-256 不替代发布者签名；若接入签名，必须先签最终 EXE，再生成块图、大小及哈希，生成后不能再改 EXE。

## Cloudflare R2 线上部署

R2 存储桶绑定自定义下载域名 `download.aibanlv.ai`，更新只需静态文件服务，不需要新增业务接口。Android APK 和其他七牛云资源保持独立。

```text
https://download.aibanlv.ai/desktop-updates/windows/x64/
  AIBanlv-0.2.6-win-x64-Setup.exe
  AIBanlv-0.2.6-win-x64-Setup.exe.blockmap
  latest.json
```

使用当前源码构建的 Windows x64 安装版默认检查：
[latest.json](https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json)。
清单、EXE、blockmap 必须使用相同协议、域名和端口，路径可以不同；均需允许匿名 HTTPS 读取，不能跳转到登录页或其他下载域名。

### 上传顺序

1. 将新版本 **EXE 和 blockmap** 上传到 R2 的 `desktop-updates/windows/x64/`，确认传输完成且自定义域名的正式地址可访问。
2. 检查实际线上文件大小、SHA-256 与本次构建清单一致；验证 EXE 支持下方的 Range 请求。
3. **最后覆盖 `latest.json`**，使用本版本配套的清单；上传工具支持临时对象时，可先临时上传再替换正式对象。
4. 为清单设置 `Cache-Control: no-store` 并在 Cloudflare 配置绕过缓存；若之前缓存过此 URL，执行按 URL 清除缓存。刷新 R2 文件列表不会清除 CDN 缓存。
5. 打开固定的清单 URL，确认 `version`、下载地址和哈希均为本次发布值，再用旧版客户端检查更新。

旧版本 EXE 和块图可以保留，不影响新版检查；决定最新版本的是 `latest.json`。首次发布清单或替换清单都要检查实际对外返回内容。

700 MB 安装包超出当前 R2 网页上传的 300 MB 限制，使用 S3 兼容接口。AWS CLI 配置的 `r2` profile 使用 R2 的 Access Key ID / Secret Access Key，区域填 `auto`；端点复制后台 S3 API 地址，不能用公开下载域名。凭据只保存在本机。

```powershell
$r2Endpoint = 'https://你的账户ID.r2.cloudflarestorage.com'
$r2Bucket = 'aibanlv-downloads'
$r2Prefix = "s3://$r2Bucket/desktop-updates/windows/x64/"
aws configure set s3.multipart_threshold 64MB --profile r2
aws configure set s3.multipart_chunksize 16MB --profile r2
# 将版本号替换为本次构建版本；这两条命令不上传清单。
aws s3 cp demos/web-desktop-pet/dist/AIBanlv-0.2.6-win-x64-Setup.exe $r2Prefix --endpoint-url $r2Endpoint --profile r2
aws s3 cp demos/web-desktop-pet/dist/AIBanlv-0.2.6-win-x64-Setup.exe.blockmap $r2Prefix --endpoint-url $r2Endpoint --profile r2
# 校验文件可访问且配套之后，最后发布清单：
aws s3 cp demos/web-desktop-pet/dist/latest.json "${r2Prefix}latest.json" --endpoint-url $r2Endpoint --profile r2 --content-type application/json --cache-control no-store
```

### CDN 缓存与 Range

在 Cloudflare 的域名 `aibanlv.ai` → 缓存 → Cache Rules 中，为以下请求设置“绕过缓存”：

```text
(http.host eq "download.aibanlv.ai" and
 (ends_with(http.request.uri.path, ".exe") or
  http.request.uri.path eq "/desktop-updates/windows/x64/latest.json"))
```

粘贴到“编辑表达式”文本框，不要填进“URI 完整 / 通配符”的值输入框。也可分别创建 EXE 和清单规则。
2026-10-28 实测该 700 MB EXE 在默认缓存处理下，Range 返回完整 200；显式绕过缓存后返回正确 206，因此不能只检查文件能否下载。
块图可独立缓存；不要对 EXE/blockmap 开启透明压缩或内容改写。R2 不进入边缘缓存的文件仍由 R2 提供下载，计费和额度以 Cloudflare 账单为准。

增量下载要求 CDN 对 EXE 返回正确的 `206 Partial Content` 和 `Content-Range`。以下用示例版本检查，测试文件写在本地 `artifacts/`：

```powershell
New-Item -ItemType Directory -Force demos/web-desktop-pet/artifacts | Out-Null
curl.exe --fail --max-time 20 --max-filesize 1024 --range 0-1023 --header 'Accept-Encoding: identity' --dump-header - --output demos/web-desktop-pet/artifacts/range-test.bin 'https://download.aibanlv.ai/desktop-updates/windows/x64/AIBanlv-0.2.6-win-x64-Setup.exe'
(Get-Item demos/web-desktop-pet/artifacts/range-test.bin).Length
```

应返回 HTTP 206、`Content-Range: bytes 0-1023/<EXE 总字节数>`，文件长度为 1024。仅安装包 URL 能正常打开，不足以证明支持增量更新。

### 旧客户端切换（仅发布到 R2）

正式收尾版为 0.2.5，内置 Cloudflare 检查源，更新包和清单只发布到 R2，不向七牛云发布新包，也不自动回退到七牛云。
已有 0.2.3 及更早版本仍内置旧地址，需要从本地发布包或 Cloudflare 下载并手动安装一次 0.2.5；之后检查更新、完整下载和增量下载均走 Cloudflare。
增量下载的每个 Range 请求最多 1 MiB，避免大改动区域依赖单次长响应；完整文件大小、哈希校验与取消/超时规则保持不变。
不需要卸载旧版，完全退出旧进程后沿用原安装目录即可保留绑定和设置。若管理员曾设置 `PET_DESKTOP_UPDATE_URL`，应移除旧值或改为 Cloudflare，避免环境变量覆盖默认源。
七牛云原有历史对象本次不删除、不覆盖；Cloudflare 清单不要上传到旧域名。
详见 [R2 迁移与线上验证](cloudflare-r2-update-migration.md)。
0.2.4 为未发布清单的验收候选，最终构建及安装步骤以 [0.2.5 发布说明](release-0.2.5.md) 为准。

## 更新验收与故障处理

完整流程为：旧版检查更新 → 下载并校验 → 退出并安装 → 新版启动，确认版本、绑定、设置及任务栏图标。

**全量与增量由客户端自动选择。** 有新版块图、有效本地基线、正确的 Range 响应且能节省流量时使用增量；缺少基线、校验不通过或差分失败时完整下载。取消、超时不会触发继续完整下载。
两种方式最终都会得到同一完整 EXE 并校验 SHA-256，不能用最终 EXE 的磁盘大小判断是否节省流量，应看更新窗口的“实际下载”和“本地复用”。

首次手动安装不会生成下载基线。验证连续两版时，先让旧客户端在应用内完成第一版的下载，再安装；随后发布第二版以验证增量。
也可从空缓存测试一次全量更新，再用下一版测试增量。不要提前把第二版清单发布到线上。
基线在 `%APPDATA%\Control Device\updates\` 的 `base.exe`、`base.blockmap`、`base.json`，删除后下一次可能完整下载。

| 现象 | 检查与处理 |
| --- | --- |
| 一直显示没有新版 | 对比客户端版本与固定清单 URL 返回的 `version`；确认使用正确目录，并刷新 CDN 缓存 |
| 下载仍接近完整包大小 | 检查基线是否存在且有效、块图是否配套、CDN Range 是否返回 206；大幅变更模型也会降低复用比例 |
| 退出后未打开安装向导 | 旧版交接逻辑可能尚未修复；彻底退出后手动运行已校验的 `%APPDATA%\Control Device\updates\setup.exe`，或本版公开 EXE；重新检查会清理候选 `setup.exe` |
| 无法覆盖 `AIBanlv.exe` | 旧程序仍可能在托盘运行；完全退出后点“重试”，不要点“忽略” |
| 旧任务栏固定项仍显示旧图标 | 先确认启动的是新版；必要时取消旧固定项，再固定新版正在运行的 AIBanlv |

关闭设置窗口只是隐藏，彻底退出请使用托盘“退出”或账号菜单“退出登录”（当前含义为关闭软件），不会解除手机绑定。
停止问题版本分发可恢复旧 `latest.json` 并刷新缓存，但已升级客户端不会自动降级，需要另发更高版本修复包。
Windows 在线安装更新目前只支持 Windows x64 安装版；开发入口和未安装的便携目录不会覆盖正常安装。

详细方案见 [Windows 在线更新部署](windows-online-update.md)，两版操作与实测记录见 [0.2.2 / 0.2.3 发布验收](release-0.2.2-0.2.3.md)。

## 验证与目录

```powershell
npm test
Push-Location demos/web-desktop-pet
node tests/device-update-electron.mjs
# 构建应用目录后验证实际打包程序：
node tests/device-update-packaged.mjs
Pop-Location
```

Electron 验收需要 Demo 文档所列 Playwright 等工具，使用隔离资料目录和本地网络夹具，不创建正式收费会话。
修改 Java 后，从 Demo 目录执行 `node scripts/prepare-control.mjs --test` 和 `node tests/device-lam-control.mjs`。

| 路径 | 用途 |
| --- | --- |
| `demos/web-desktop-pet/electron/` | 桌面主进程、窗口、预加载与界面 |
| `demos/web-desktop-pet/src/` | 渲染宿主、字幕、表情与动作 |
| `demos/web-desktop-pet/scripts/` | 推理、Java 后处理与打包工具 |
| `demos/web-desktop-pet/tests/` | 单元测试与 Electron 验收 |
| `android-native/` | 桌面端所需的 Java/渲染器源码，不是完整 Android 工程 |
| `static/` | 应用图标等公共资源 |
| `docs/` | 产品规格、部署说明与历史验收 |

## 功能与技术文档

- [设置与插件](settings-plugins-spec.md)、[语义工具与自动关联](semantic-tools-autoconnect.md)
- [账号登录](account-login-spec.md)、[邮箱注册](account-registration-spec.md)、[游客使用](guest-access-spec.md)
- [对话记忆恢复](conversation-memory-recovery.md)、[桌面优化与积分规则](desktop-optimization.md)
- [Harness 助手](deepseek-assistant-spec.md)、[只读邮箱](assistant-mail-spec.md)
- [手机文件直传](direct-transfer-and-plugins-spec.md)、[Cloudflare TURN](cloudflare-turn-setup.md)、[桌面提醒](desktop-reminders-notifications.md)
- [Demo 环境与测试](../demos/web-desktop-pet/README.md)、[更新规格](windows-online-update-spec.md)、[仓库拆分记录](repository-split.md)

历史文档中的版本、目录和验证日期用于追溯；当前启动和发布步骤以本文及现行打包脚本为准。
