# Windows 在线更新部署

## 客户端行为

默认检查地址：
`https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json`。
该默认值从 2026-10-28 起用于新构建的 Windows x64 安装版；已发布的 0.2.3 及更早安装包仍检查七牛云。
Cloudflare R2 的上传、缓存规则、线上增量实测和旧客户端过渡见 [R2 迁移说明](cloudflare-r2-update-migration.md)。
账号菜单 → 检查更新 → 下载更新 → 退出并安装。
“稍后”关闭窗口，正在进行的下载会继续；“取消下载”终止下载并清理临时包。
下载失败、大小/哈希不匹配、清单 404 分别给出提示，不会执行失败的包。
下载优先使用 blockmap 差分：从保留的安装包复制相同数据块，只下载变化范围，
在本地重建完整 EXE 后校验。缺少基线、块图不兼容或 Range 不可用时回退完整下载。
每个增量 Range 响应最多 1 MiB；大改动区域分多次请求，避免依赖单次长响应。
取消或超时不会自动回退继续耗费流量。
窗口显示“增量下载/完整下载”、实际接收量和本地复用量；进度为完整包下载与重建进度。
接收量统计包含块图及失败尝试中已消费的数据，不含 HTTP/TLS 头和底层取消前的传输缓冲。
下载只保留一份基线包及其块图，再加当前候选包。重新检查会清理候选包，保留基线。
关闭应用后不恢复未完成下载；重启重新检查时仍可复用校验通过的基线。
基线发布失败不会影响已校验的新安装包；下一次更新必要时完整下载。

安装只在 Windows x64 的已安装 `AIBanlv.exe` 中启用，并验证原有安装标记。
源码入口和便携目录均不检查安装包清单、不提供下载和安装。安装版升级保留现有用户数据目录、设备绑定和设置。
点击安装后先重新校验缓存，启动隐藏的 Windows PowerShell 辅助进程并确认就绪，
再走现有应用退出流程以释放对话、推理和助手工作进程。
辅助进程等桌面主进程退出（最多 90 秒），再次校验后打开现有 NSIS 安装向导。
安装失败或取消有本机提示；下次启动检查更新可见上次交接失败状态。
“退出并安装”不是静默安装；用户仍需完成安装向导。

旧版客户端没有下载和安装逻辑，首次须手动安装带本功能的新版本。
手动安装本身不向应用缓存写入基线。第一次应用内更新没有可复用包时仍完整下载；
客户端校验并保存这份包以后，后续更新才可差分。
基线是最近下载并校验过的包，不要求已经安装；它仅供复用字节，
任何重建结果都必须匹配新版本清单的完整哈希，不能据此跳过安装前校验。
首个流程验收构建版本为 `0.2.0`，后续升级验收版本为 `0.2.1`；
旧开发入口显示的 `44.9.0` 为 Electron 版本。
实际发版需统一调整应用版本及对应锁文件，使用更高的应用版本号；
下文 `0.1.5` 目录与命令仅为部署示例，上传时使用实际构建版本的文件名。

## 源码与便携版

源码启动时，账号菜单显示“源码更新说明”：展示应用版本、启动时的 Git 分支和提交号，并说明手动更新步骤。
完全退出程序后，在仓库根目录执行 `git pull --ff-only`；依赖有变化时执行 `npm ci` 和 `npm run setup`，然后 `npm start`。
命令更新当前分支的上游，不自动切换到 master。分离 HEAD 时先切换目标分支；缺少 Git 或来自源码压缩包时显示对应说明。
源码模式不会获取 Cloudflare 清单，也不会自动拉取源码、执行 npm 或启动安装包；主进程同时拒绝下载/安装 IPC。
便携目录提示使用新版 Windows 安装包手动安装；其他平台提示获取对应版本。安装版的原有在线更新步骤见上文。

## 构建产物与清单

仅在用户明确要求构建时，从 `control-windows` 根目录执行：

```powershell
# 使用 Node.js 24+。这里的版本号来自 demos/web-desktop-pet/package.json。
$env:PET_DESKTOP_UPDATE_NOTES = '本次更新说明'
$env:PET_DESKTOP_UPDATE_URL = 'https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json'
npm run windows:package
npm run windows:installer
```

产物位于 `demos/web-desktop-pet/dist/`：

- `AIBanlv-<应用版本>-win-x64-Setup.exe`：公开安装包。
- `AIBanlv-<应用版本>-win-x64-Setup.exe.blockmap`：公开块图，由锁定的构建工具自动生成。
- `latest.json`：公开版本清单，包含 version/platform/arch/url/bytes/sha256/notes。
- `device-installer.json`：内部构建记录，含本机路径，不能作为公开清单上传。

`latest.json` 的版本、大小和哈希直接来自实际安装包；不需要手填哈希。
清单增加 `blockmap: { url, bytes, sha256 }`，描述对应 `.blockmap`。
上传这三个生成文件即可，不手工生成补丁 ZIP，也不需要为每对新旧版本分别制作补丁。
现有 NSIS 安装器保持不变，只调整为按文件压缩以利数据块复用。
本方案复用 `electron-updater@6.8.11` 的块匹配算法，不整体迁移打包和卸载流程，
因此仍读取 `latest.json`，不是 `latest.yml`；不要混用另一套清单格式。
如需管理员测试源，在构建机器或客户端配置 `PET_DESKTOP_UPDATE_URL`。
源地址必须为 HTTPS，安装包地址必须与源同源；禁止跳转到其他域名、HTTP 或携带 URL 凭据。
新构建生产版使用默认地址，无需给用户设置环境变量；旧安装版需过渡升级或手动指定检查源。
构建环境变量只影响生成的清单，不会改写已有 EXE 内置地址。Windows 与控制端 APK 独立维护版本号。

## 服务器目录

当前生产采用 Cloudflare R2：桶 `aibanlv-downloads`，公开自定义域 `download.aibanlv.ai`，对象前缀 `desktop-updates/windows/x64/`。
下面的磁盘目录与 Nginx 配置仅供自建源站备选，不是 R2 上传所需步骤；Android 下载地址保持独立。
示例中的版本号应换成本次实际构建版本，磁盘根目录应换成实际服务器目录：

```text
/srv/aibanlv-downloads/desktop-updates/windows/x64/
  AIBanlv-0.1.5-win-x64-Setup.exe
  AIBanlv-0.1.5-win-x64-Setup.exe.blockmap
  latest.json
```

对应公开 URL：

```text
https://download.aibanlv.ai/desktop-updates/windows/x64/AIBanlv-0.1.5-win-x64-Setup.exe
https://download.aibanlv.ai/desktop-updates/windows/x64/AIBanlv-0.1.5-win-x64-Setup.exe.blockmap
https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json
```

如果使用 Nginx，可在现有域名的 `server` 块中添加以下配置。
保留现有 TLS、其他 location 和 Android APK 路由；替换磁盘根目录后先 `nginx -t` 再重载：

```nginx
location = /desktop-updates/windows/x64/latest.json {
    root /srv/aibanlv-downloads;
    default_type application/json;
    add_header Cache-Control "no-cache" always;
    try_files $uri =404;
}

location ^~ /desktop-updates/windows/x64/ {
    root /srv/aibanlv-downloads;
    default_type application/octet-stream;
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}
```

这些路径须允许客户端匿名读取。清单和安装包都不能重定向到登录页、对象存储或其他地址。
支持长文件传输；如域名前有 CDN，同时配置清单重新验证和版本化安装包长缓存。
差分要求 EXE 支持单段 HTTP Range，不能对 EXE/blockmap 做透明压缩或内容改写。
确认实际对外链路（包括 CDN）返回 `206 Partial Content`、准确的 `Content-Range`
及未压缩的原字节。以下 PowerShell 请求应返回 206，范围长度 1024 字节：

```powershell
curl.exe --fail --max-time 20 --max-filesize 1024 --range 0-1023 --header 'Accept-Encoding: identity' --dump-header - --output './range-test.bin' 'https://download.aibanlv.ai/desktop-updates/windows/x64/AIBanlv-0.1.5-win-x64-Setup.exe'
(Get-Item -LiteralPath './range-test.bin').Length
```

Nginx 的静态文件服务通常已支持 Range；若当前服务或 CDN 不支持，客户端仍可完整更新，
但不会省下安装包流量。客户端已缓存旧 blockmap，因此不必再向服务器下载旧块图；
保留旧版 EXE 和 blockmap 仍便于首次安装及追溯，不覆盖版本化文件。
更新总时限为 60 分钟、无数据空闲超时 30 秒、清单超时 10 秒。
完整安装包最大 8 GiB；下载和重新校验所需磁盘空间与时间应纳入发版验收。

## 发布顺序

1. 上传带版本号的安装包和对应 `.blockmap`，先使用临时名称，传完后在同一目录改成正式名称。
2. 验证两个正式 URL 返回 HTTP 200，并下载验证大小与 SHA-256；确认 EXE 的 Range 返回正确 206。
3. 最后替换生成的 `latest.json`；R2 上传对象时设置 `Content-Type: application/json`、`Cache-Control: no-store`，并在 CDN 绕过清单缓存，清除旧缓存。
4. 验证清单 URL 返回 JSON（不是 HTML 登录页），且指向已上传包。
5. 用带已校验基线的上一个应用版本实测差分流量、取消、回退、升级及绑定/设置保留。

不要覆盖已有版本的安装包。停止问题版本分发时可将清单恢复为前一个可信版本；
客户端不会自动降级已升级的安装，需要另行发布更高版本的修复包。
当前安装包构建仍为内部未签名分发；SHA-256 校验不替代发布者数字签名。

## 本地验证

安装交接由独立隐藏的 Windows PowerShell 进程执行。主程序先等待带本次随机令牌的
`handoff.json` 就绪回执，再退出；辅助进程继续校验安装包并启动安装向导。
准备超时会写入本次取消标记，避免延迟启动的辅助进程在以后退出应用时误安装。
回执记录 `wait-parent`、`verify-after-exit`、`launch-installer` 等阶段，便于定位失败。
旧版通过主程序直接启动的辅助进程可能随主程序退出而结束，表现为退出后没有安装向导。
已下载的包位于 `%APPDATA%\Control Device\updates\setup.exe`，可手动运行完成当次升级；
源代码修复需要构建并发布新的版本才会进入已安装客户端。

从 `control-windows/demos/web-desktop-pet` 使用 Node.js 24+：

```powershell
node --test tests/device-account.test.mjs tests/device-update.test.mjs tests/device-update-install.test.mjs tests/device-update-release.test.mjs
node --test tests/device-update-delta.test.mjs
node tests/device-update-electron.mjs
node tests/device-settings-browser.mjs
```

从仓库根目录执行 `npm test`。完整记录见 [规格与验收](windows-online-update-spec.md)。
本地 Electron 验证使用隔离资料目录、模拟 HTTPS 返回和本地 WebSocket，
不会连接正式账号或开启付费会话，也不会执行真实安装包。
安装回归测试会编译一个只记录启动参数的安全 EXE 夹具，用真实 Electron 父进程退出
验证辅助进程继续运行、启动夹具并返回完成回执；覆盖含中文、空格及特殊字符的路径。
