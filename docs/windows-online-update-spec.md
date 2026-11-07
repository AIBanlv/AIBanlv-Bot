# Windows 在线更新规格（2026-10-27 已确认）

## 安装版与源码版入口区分（2026-11-03）

用户后续要求源码更新也由按钮自动执行，源码行为以[源码版应用内更新](source-update-spec.md)为准，取代本节最初的手动更新方案。Windows x64 已安装程序保留 Cloudflare 清单、差分/全量下载、校验和退出安装；源码启动检查当前分支上游，通过独立进程退出后快进、按需安装依赖并重启，不访问安装包清单。便携目录和暂不支持在线更新的平台显示对应说明。

`electron/device-update-mode.mjs` 负责模式选择和源码信息；复用现有 `device-update.mjs`、主进程受限 IPC 与更新弹窗。源码更新的 Git/npm 命令仅由主进程定义，设置超时和输出上限，不返回远程地址或原始错误。缺少 Git、缺少仓库或分离 HEAD 均有明确状态，不影响应用启动。ESM、两空格、参数数组执行命令、渲染文本使用 textContent。

验收：源码模式从 UI 和 IPC 均不能访问安装包更新源、下载或运行安装器；安装版原有下载、取消、失败、增量和安装交接边界保持；新模块进入分发白名单。源码 Git 预检、更新进程和续装验收见新规格；Electron 本地夹具分别验证两种模式、四种宽度、键盘和 axe。

命令：根目录 `npm test`；Demo 内 `node --test tests/device-update-mode.test.mjs tests/device-update.test.mjs tests/device-update-delta.test.mjs tests/device-package.test.mjs`、`node tests/device-update-electron.mjs`，源码模式设置 `DEVICE_UPDATE_SOURCE_ONLY=1` 后运行同一脚本。
本轮沿用既有依赖，不构建安装包、不发布 Cloudflare。

验证结果：根目录 `npm test` 为 724/725 通过，唯一失败仍为本轮之前已复现的 `tests/device-qr-only.test.mjs:42`，没有跳过或削弱断言。新增三个 Node 测试覆盖源码元数据与模式边界；分发测试验证新模块已进入包内依赖图。
`node tests/device-update-electron.mjs` 的安装模式夹具通过，覆盖完整/增量下载、取消、损坏包、404、失败交接、受限 IPC；只在测试中注入已安装能力并拒绝真实安装，没有运行应用安装包。
同一脚本设置 `DEVICE_UPDATE_SOURCE_ONLY=1` 后通过，使用真实源码入口和本机 Git 信息，确认未请求清单且拒绝下载/安装。两种模式均覆盖 320/768/1024/1440 宽度、键盘、axe 无违规，页面错误为 0，并检查实际截图。
运行模式使用 `runMode`，独立于既有下载方式 `mode`；安装回归发现字段重名后已修正并补充断言。测试日志 `artifacts/update-mode-node-test.log`、截图 `artifacts/windows-update/source-320.png` 和 `differential-ready.png` 为本地忽略产物。

## 更新源迁移修订（2026-10-28）

当前源码默认源迁移为 `https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json`，
清单和安装包/块图仍须 HTTPS 同源，不放开任意跨域下载。`PET_DESKTOP_UPDATE_URL` 保留显式覆盖能力。
用户最终选择不再通过七牛云下载：最终版 0.2.5 只向 R2 发布，旧安装版需手动覆盖安装一次 0.2.5，后续均走 Cloudflare。
不修改或删除旧域名历史对象，不生成新的七牛云清单，也不增加自动回退旧源；环境变量仍可显式覆盖测试源。
存储搬迁本身不会改变旧客户端的默认源，因此必须明确说明首次手动安装步骤。
Cloudflare EXE 绕过缓存后，实际线上 0.2.2 → 0.2.3 增量下载和完整哈希校验已通过。
0.2.4 候选的大区域传输遇无数据超时，未发布清单；0.2.5 将每个 Range 请求限制为最多 1 MiB，
保留原有取消、30 秒无数据超时、完整包总时限及 SHA-256 校验，新增大区域分段与重建一致性回归测试。
迁移步骤及验收边界见 [R2 迁移说明](cloudflare-r2-update-migration.md)，下文 2026-10-27 的源地址与结果保留为历史基线。

## 差分下载修订（2026-10-27 用户要求实施）

目标是减少客户端更新下载流量，保留原 NSIS 安装身份、数据目录和退出安装交接。
本轮不整体迁移 electron-builder：锁定 `electron-updater@6.8.11` 的块匹配计划算法，
使用其同一上游 `app-builder-bin@4.2.0` 工具生成通用 blockmap。
下载协议由现有有界 fetch 执行，继续禁止重定向并校验最终 SHA-256。
新增依赖分别为运行时算法和仅构建期工具，不在运行时下载工具。

- 发布产物：完整版本化 EXE、`EXE.blockmap`、`latest.json`。清单增加可选
  `blockmap: { url, bytes, sha256 }`；缺少 blockmap 的旧清单继续完整下载。
- blockmap URL 必须 HTTPS、同源，压缩输入最多 8 MiB、展开最多 32 MiB、
  数组项总数最多 1,000,000，且块覆盖范围必须与包大小一致。
- 下载前获取并校验新 blockmap，验证保留基线 EXE 和其 blockmap；
  用固定版本上游算法生成 COPY/DOWNLOAD 计划，逐段写出完整新安装包。
- Range 请求只接受精确匹配的 HTTP 206/Content-Range/字节数；同一更新仅允许
  一次差分尝试，失败删除半成品并回退一次完整下载。用户取消/总超时禁止回退。
- Range 分段有空闲/总时限与总字节预算，规划请求数超过 4096 或没有复用收益时直接完整下载。
- 所有重建结果须通过完整文件大小与 SHA-256 校验，沿用安装前再次校验。
- 下载成功后保留一份安装包和 blockmap 作为下次基线，优先用硬链接避免额外复制。
  缓存损坏、缺失、格式不支持时完整下载；只清理固定拥有的缓存文件，不能影响安装目录。
  缓存发布不完整时验证失败并回退，不能把未完成结果当成成功安装包。
- NSIS 改为按文件压缩，降低小文件变化导致后续压缩流全部变化的概率。
  安装包大小和真实流量收益须在获准正式构建后测量，不承诺固定节省比例。
- UI 显示差分/完整下载方式、实际下载字节与复用量；不把整个包大小冒充下载流量。
- 验证：真实工具生成两版非可执行二进制夹具，本地 HTTP Range 服务器统计字节，
  验证流量减少、重建一致、基线/块图/范围/哈希失败回退、取消/超时和跨版本复用。
  完整 Node 与现有 Electron 回归；不生成实际应用安装包或部署服务器。

官方来源：
- https://github.com/electron-userland/electron-builder/blob/v26.0.12/packages/electron-updater/src/differentialDownloader/downloadPlanBuilder.ts
- https://github.com/develar/app-builder/blob/master/pkg/blockmap/blockmap.go
- https://nsis.sourceforge.io/Reference/SetCompressor

### 差分修订验证结果

- 根 `npm test`：590 项通过，0 失败/跳过；Node.js 24.22.1。
- 7 项差分测试加既有更新/账号/发布/交接测试共 23 项，覆盖真实工具块图、
  流量计数、坏范围/不支持 Range/跳转/坏数据回退、取消/超时不回退、
  缺失/损坏基线、跨重启复用、零变化整包本地复制、缓存写入失败、
  无复用收益与损坏远端块图。全部包含在根测试中通过。
- `node tests/device-update-electron.mjs` 通过，最新 1 MiB 夹具传输 34,081 字节
  （含块图），本地复用 1,015,808 字节；重建文件逐字节相同。
  数字来自随机二进制夹具，不代表真实安装包固定节省比例。
  更新窗口显示增量下载/实际下载/本地复用，KB 小流量不会显示成 0.0 MB。
  宠物 IPC 拒绝、开发模式拒绝安装、键盘、四种宽度及 axe 检查保持通过。
- `node tests/device-settings-browser.mjs` 通过，页面错误与资源失败为 0。
- 分发测试确认新运行时模块及固定版本匹配算法能在源码树外加载，
  仅构建期的 blockmap 生成模块/工具不进入运行时白名单。
- 审阅网络请求、Range 边界、字节预算、重建哈希、持久缓存发布顺序、
  取消不回退和失败清理；`git diff --check` 通过。
- npm 生成并更新拥有方锁文件，原有依赖版本无变化；只新增两项固定版本及依赖闭包，
  安装时禁用依赖脚本。`npm audit` 当前报告 44 项（41 high、3 moderate），
  均落在原有 Electron/Harness/fflate/undici/zod 依赖树；新增两包未出现在报告列表中。
  未为通过审计而强制升级无关依赖；这些既有项仍需在正式生产发布前单独处置。
- 新证据：`artifacts/windows-delta-node-tests.log`、`artifacts/windows-delta-audit.json`、
  `artifacts/windows-update/report.json` 和 `differential-ready.png`（相对 demo）。
- 未构建实际应用 EXE/NSIS、真实覆盖安装或部署服务器；真实安装包压缩率、
  差分命中率及 CDN Range 仍须在正式构建获准后验收。

## 目标与现状

让 Windows x64 安装版 AIBanlv 从现有服务器检查更新、下载完整安装包，
校验成功后由用户点击启动升级安装。保留设备身份、绑定、设置与用户数据。

当前 `device-account.mjs` 只检查 `PET_DESKTOP_UPDATE_URL` 指定的版本 JSON，
没有默认源、下载或安装能力。开发入口直接启动 `device-main.mjs`，
`app.getVersion()` 可能返回 Electron 的 `44.9.0`；应用清单实际为 `0.1.4`。
打包脚本已将应用版本写入包清单，安装包使用现有 NSIS。

## 假设与边界

- 本轮仅支持 Windows x64 完整安装包更新，macOS 显示对应平台说明。
- 域名 `zhanlvgpt.ieasysell.com` 可提供 HTTPS 静态文件，不要求新增数据库或业务接口。
- 更新目录是拟议路径，尚未部署或验证可用；域名根路径本地 HEAD 检查返回 404，
  不能据此判断已有业务路径或拟议更新目录是否可用。
- 用户明确点击下载与安装；不强制升级，不在对话期间自动退出。
- 基础完整更新沿用 Electron、Node 内置 API、NSIS 和现有打包脚本；差分修订增加的锁定依赖见文首。
- 不修改旧 `control` 项目，不上传用户数据，不改模型权重或推理流程。
- 本规格不授权生成 EXE、真实覆盖安装或服务器发布，需分别按用户指令执行。

## 更新协议

默认版本清单地址（拟议）：

`https://zhanlvgpt.ieasysell.com/desktop-updates/windows/x64/latest.json`

保留 `PET_DESKTOP_UPDATE_URL` 作为管理员覆盖配置。示例版本仅用于说明，
真实清单必须来自对应安装包构建结果，不能手工填写假哈希或假大小：

```json
{
  "version": "0.1.5",
  "platform": "win32",
  "arch": "x64",
  "url": "https://zhanlvgpt.ieasysell.com/desktop-updates/windows/x64/AIBanlv-0.1.5-win-x64-Setup.exe",
  "sha256": "<构建生成的64位十六进制SHA-256>",
  "bytes": 123456789,
  "notes": "本次更新说明"
}
```

- 应用版本使用应用清单的三段数字版本；禁止用 Electron 版本参与比较。
- 清单限制为 64 KiB，检查超时 10 秒，禁止重定向、HTTP、URL 凭据与 fragment。
- 安装包仅接受与更新源同源的 HTTPS URL、匹配平台和架构、合法大小及 SHA-256。
- 流式下载到用户数据下独立更新缓存，显示进度并允许取消；限制实际字节数，
  设置空闲超时与总时限；断网、取消、大小或哈希不匹配均不得执行安装包。
- 主进程持有下载状态和可信文件路径；渲染层不能指定本地执行路径或任意启动参数。
- SHA-256 用于校验文件完整性，不替代发布者数字签名；服务器清单属于更新信任边界。
- 相同或更旧版本不提供安装，404、无效清单和网络失败不能显示“已是最新版”。

## 客户端体验与安装交接

设置中的“检查更新”展示当前应用版本、新版本、说明和下载按钮；
下载完成且校验通过后显示“退出并安装”，允许稍后安装。

只在已安装的 Windows 包中启用安装交接。开发入口可以检查版本，不能自动覆盖安装。
点击安装前再次验证缓存文件；安全交接机制等待当前进程及其拥有的工作进程退出，
再以当前用户权限启动现有 NSIS 安装器并保留安装向导。
升级使用已登记的安装目录，安装身份及用户数据目录保持不变。
交接失败必须显示错误；不能声称安装成功或静默留下半完成下载。

## 发布流程

构建安装包后，由现有 `device-installer.json` 的 version、bytes、sha256
生成公开 `latest.json`，不泄露本机路径。
先上传带版本号的不可变安装包，验证可下载后，再原子替换 `latest.json`。
清单采用 `Cache-Control: no-cache`，安装包使用版本化长缓存。
服务器仅需将拟议 URL 目录映射到静态文件；具体目录与 Nginx 配置需根据服务器现状填写。

旧版没有下载/安装逻辑，首次需手动安装具备本功能的版本，之后才能使用应用内升级。
首次发布版本号在实际构建前确定，不使用 `44.9.0`。

## 目录与代码风格

- `demos/web-desktop-pet/electron/device-account.mjs`：既有检查逻辑及迁移入口。
- `demos/web-desktop-pet/electron/device-main.mjs`：应用版本、主进程更新服务与受限 IPC。
- `demos/web-desktop-pet/electron/device-preload.cjs`、`device-view.mjs`、`device.html`：设置页操作。
- `demos/web-desktop-pet/electron/device-package.mjs`、`device-installer.mjs`：打包白名单与发布清单。
- `demos/web-desktop-pet/tests/`：Node 测试和本地 Electron 夹具。

沿用 ES modules、单引号及依赖注入，例如
`checkDesktopUpdate({ version, url, fetchImpl })`；进程启动使用参数数组并关闭可见辅助控制台，
不拼接 shell 命令。

## 命令、测试与验收

从仓库根目录运行 `npm test`；聚焦现有检查测试：
`node --test demos/web-desktop-pet/tests/device-account.test.mjs`。
新增更新测试继续使用 Node 内置测试框架；Electron 验证只连接本地夹具。

验收包含真实应用版本、默认源与覆盖配置、版本比较、清单大小限制、平台架构校验、
下载进度/取消/超时、重定向拒绝、哈希/大小失败不执行、重复点击互斥、
退出后安装交接、原安装目录及账号数据保留。
安装交接先通过假进程测试；真实 NSIS 覆盖安装需使用隔离安装身份与测试目录，
得到用户构建/安装指令后才执行，不影响正常已安装程序。

已实现默认源、真实应用版本、清单校验、有界流式下载、取消/重试、完整性校验、
设置页更新窗口、仅安装版可用的安装交接和自动公开发布清单。
服务器部署说明见 `windows-online-update.md`。
最终源码验证结果记录在文末；未构建 EXE、真实覆盖安装或部署服务器。

## 已确认范围

用户已确认“服务器静态清单 + 完整安装包 + 用户点击退出安装”并要求开始实施。
实施计划和任务单独保存在 `tasks/windows-online-update/`，不覆盖其他功能的未完成任务。

## 最终验证（2026-10-27）

- Node.js 24.22.1 下执行根 `npm test`：582 项通过，0 失败、0 跳过。
  初次两项失败是本机缺少已声明的 attachment-local 依赖；使用
  `npm install --ignore-scripts --no-save --package-lock=false --audit=false --fund=false`
  恢复本机依赖后通过，未改应用清单或锁文件。
- 更新聚焦测试：15 项通过，覆盖版本、默认源、平台/架构、同源限制、清单有界、
  取消、超时、大小/哈希、缓存篡改、并发安装准备、交接失败与安全重试。
- `node tests/device-update-electron.mjs`：真实 Electron + 本地控制夹具通过。
  模拟 HTTPS 响应，验证下载/取消/失败/成功、开发模式安装拒绝、宠物窗口 IPC 拒绝、
  404 状态、纯文本发布说明、Escape/Tab/焦点恢复和 320/768/1024/1440 宽度。
  更新弹窗 axe 检查 0 违规，页面错误和资源失败均为 0。
- `node tests/device-settings-browser.mjs`：既有设置页回归通过，320/650/960 宽度、
  登录注册、账号菜单、退出行为保持；页面错误和资源失败均为 0。
- 真实 Windows PowerShell 辅助进程在隔离临时目录校验并确认 READY；
  父进程仍运行时停止辅助进程，未执行任何安装包；坏哈希在 READY 前被拒绝。
- 审阅检查版本源、下载执行边界、取消/互斥、退出时机、打包白名单和发布元数据。
  `git diff --check` 通过。测试进程仍有既有 Playwright shell deprecation 和
  DeviceChannel listener 数量告警，本次未修改这些无关路径。
- 证据在忽略目录 `demos/web-desktop-pet/artifacts/windows-update/`、
  `artifacts/settings-browser/`、`artifacts/windows-update-node-tests.log`。
  没有可用 DevTools MCP，因此使用现有 Playwright/Electron 运行时并人工检查截图。
- 本轮只验证源码；正式构建后仍需隔离 NSIS 覆盖安装、真实大包下载、绑定/设置保留
  和线上目录验收。未生成安装包、执行真实覆盖安装、配置服务器或提交 Git。
