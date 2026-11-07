# Cloudflare R2 更新源迁移（2026-10-28）

## 当前地址与状态

- 存储桶：`aibanlv-downloads`，对象前缀：`desktop-updates/windows/x64/`。
- 新检查地址：`https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json`。
- 旧检查地址：`https://zhanlvgpt.ieasysell.com/desktop-updates/windows/x64/latest.json`，仅用于说明旧版行为，本次不向其发布新版本。
- 用户最终选择只走 Cloudflare：最终交付 0.2.5 内置新源，包、块图和清单只发布到 R2；0.2.3 及更早版本通过手动安装一次切换。
- R2 已发布 0.2.5 的 EXE、块图与清单，公开检查和 `no-store` 复测通过。0.2.4 是未发布清单的验收候选，最终发布记录见 [0.2.5 发布说明](release-0.2.5.md)。
- R2 原有 0.2.3 文件和 0.2.4 候选对象保留，版本化对象没有覆盖；旧清单已在替换前备份。

## 上传与公开访问

700 MB EXE 使用 S3 兼容接口，AWS CLI 会自动分段上传。`r2` profile 使用 R2 的 Access Key ID 和 Secret Access Key，区域为 `auto`。
上传端点复制 R2 后台的 S3 API 地址（按实际区域原样使用）；公开下载地址使用自定义域 `download.aibanlv.ai`，两者不同。
凭据只配置到本机，不放进脚本、清单或仓库。命令示例见根 README。

先上传同一次构建的 EXE 和 blockmap，验证大小、哈希和 Range 后，最后上传 `latest.json`，设置：

```text
Content-Type: application/json
Cache-Control: no-store
```

当前已在本地生成 `demos/web-desktop-pet/dist/cloudflare/0.2.3/latest.json`：
从保留的 0.2.3 发布文件读取元数据并重新校验本地 EXE/块图，只修改两个下载地址到 Cloudflare。
原 `dist/releases/0.2.3/` 的七牛云清单和原始产物未修改。

可在已配置好 `$r2Endpoint` 和 `r2` profile 的 PowerShell 中，从仓库根目录上传该小清单：

```powershell
aws s3 cp demos/web-desktop-pet/dist/cloudflare/0.2.3/latest.json s3://aibanlv-downloads/desktop-updates/windows/x64/latest.json --endpoint-url $r2Endpoint --profile r2 --content-type application/json --cache-control no-store
```

该清单用于验证当前 R2 文件，并不表示旧 0.2.3 安装包已内置 Cloudflare 源。

## 缓存与范围响应

首次测试 EXE 请求 `Range: bytes=0-1023`，得到完整 `200` 响应、大小 737,895,355 字节；
小块图的 Range 正常。用户为下载域名的 `.exe` 部署显式 Bypass cache 后，复测得到：

```text
HTTP 206 Partial Content
Content-Length: 1024
Content-Range: bytes 0-1023/737895355
cf-cache-status: DYNAMIC
```

因此保留 EXE 的绕过缓存规则；清单同样绕过缓存。块图可单独缓存，禁止透明压缩或内容改写。
Cloudflare Cache Rules 使用“编辑表达式”，不要把表达式作为 URL 通配符的值。可使用两个规则或合并表达式：

```text
(http.host eq "download.aibanlv.ai" and
 (ends_with(http.request.uri.path, ".exe") or
  http.request.uri.path eq "/desktop-updates/windows/x64/latest.json"))
```

配置后仍须实测 206，不以“浏览器可以完整下载”代替增量验收。
Cloudflare 的缓存、R2 请求和存储有各自计费规则，未进入边缘缓存不等于不能从 R2 下载。

## 旧客户端切换：手动安装一次，不走七牛下载

1. 构建最终版 0.2.5，内置 Cloudflare 默认源；三个公开产物只上传到 R2，最后替换清单。
2. 旧版用户从本地文件或 Cloudflare 的公开地址获取 `AIBanlv-0.2.5-win-x64-Setup.exe`。
3. 从托盘彻底退出旧版（不是关闭设置窗口），运行安装包，沿用原安装目录。文件占用时退出旧进程后重试，不忽略错误。
4. 打开新版，确认当前版本 0.2.5；若线上也是 0.2.5，“没有可用更新”为正常结果。后续更高版本从 Cloudflare 检查、下载及安装。
5. 保留用户资料和更新基线，不卸载清空；七牛云已有历史对象不在本次操作中删除或覆盖。

仅将已有 0.2.3 文件复制到 R2，不会让已有安装版自动切换；直接手动安装该旧 EXE 也不会切换。
管理员可在启动进程前显式设置 `PET_DESKTOP_UPDATE_URL` 测试新源，但不修改全局环境变量；相同版本不会提示升级。
若管理员曾设置旧 `PET_DESKTOP_UPDATE_URL`，启动新版前应移除该覆盖或改成 Cloudflare。
新源异常时暂停发布新清单、排查 R2/规则，必要时恢复 Cloudflare 上一个可信清单；不自动改走七牛云。

## 实际验证与边界

- 两次小范围测试使用有界请求，EXE 不接受 Range 时即停止，没有下载整包。
- R2 块图大小 771,357 字节，SHA-256 为 `f811b3a5c260f771db42e7eef5f7972a32e94de0a4c329d8b59d09baef02dc26`，与原产物一致。
- 使用真实 0.2.2 本地基线，块图和 EXE 范围均通过 Cloudflare 公开 HTTPS 下载：7 个 EXE 范围请求、1 个块图请求，
  接收 1,247,024 字节，复用 737,419,688 字节，没有完整下载回退。
- 重建 EXE 大小 737,895,355 字节，完整 SHA-256 `8d5c1695bc2c41991e08aecd98ce7a00d7a8e3735b74e4bf0f4f32f903bcc485` 校验通过。
- 增量重建测试时清单使用本地待发布元数据；随后用户上传清单，公开 URL 实测为 HTTP 200、`application/json`、`Cache-Control: no-store`、`cf-cache-status: DYNAMIC`。
  当前客户端检查逻辑直接访问该线上清单，以 0.2.2 为当前版本成功发现 0.2.3；EXE 和块图地址均指向 Cloudflare。
- 自动化未执行真实安装向导，没有改动正常安装目录、设备身份或正式账号。

报告保存在 demo 的 `artifacts/cloudflare-r2-check/`，其中 `live-delta-report.json` 记录真实网络量。
