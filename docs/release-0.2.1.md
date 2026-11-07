# AIBanlv 0.2.1 Windows x64 升级流程验收包

用于从线上已发布的 0.2.0 测试“发现新版 → 下载并校验 → 退出安装”。
沿用 0.2.0 的功能和安装身份，本次只提高应用版本与更新说明，不引入额外功能。
构建前已实际读取线上清单，确认版本为 0.2.0。

公开产物：`AIBanlv-0.2.1-win-x64-Setup.exe`、对应 `.blockmap`、`latest.json`。
保留 0.2.0 产物，先上传新版 EXE 和 blockmap，再替换清单。不由本地工具自动上传。

沿用现有未签名验收包；原有依赖审计告警及旧整体验收的游客断言限制见
`release-0.2.0.md`。第一次应用内更新没有基线时完整下载属于正常情况。

## 实际产物

目录：`demos/web-desktop-pet/dist/releases/0.2.1/`（仅三个公开文件）。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| AIBanlv-0.2.1-win-x64-Setup.exe | 737894620 | 83158cae569d24301d66861970b036a5ecd831d11735b6c42a4e5f7ed836f95a |
| AIBanlv-0.2.1-win-x64-Setup.exe.blockmap | 771312 | 83f9c0d07baf4811f348f9c7fd43989ba3db4e724c9fc0ff58eea1ca465a67db |
| latest.json | 以文件为准 | 清单包含上述大小与哈希 |

公开清单中的版本、完整包地址和 blockmap 地址均已重新验证。
0.2.0 和 0.2.1 的目录清单为独立文件快照，后续生成 dist/latest.json 不会改动它们。

## 验证结果

- 根 `npm test`：590 项通过，0 失败/跳过。
- 使用已在 0.2.0 验证的同一固定版本 Python/模型运行时、Java 和 NSIS 工具，未重新下载或更换版本。
- 应用目录与 NSIS 构建成功；Java 编译保留原有弃用 API 提示。
- `node tests/device-update-packaged.mjs`：实际打包程序版本 0.2.1、更新检查、
  下载校验通过；未安装目录正确拒绝覆盖安装，隔离资料目录，未触发收费服务。
- 对实际 EXE、blockmap 重新计算完整 SHA-256 并解析块图，发布清单与实际文件一致。
- 使用两个真实发布安装包，通过本地 HTTP Range 夹具验证 0.2.0 → 0.2.1：
  有基线时传输 1,303,999 字节（包含 771,312 字节块图），复用 737,361,933 字节，
  6 个范围请求，重建完整哈希通过；相比完整包下载量减少约 99.82%。
  此结果针对这次仅改版本的包和本地服务器，不保证线上实际节省比例，
  也不表示首次手动安装已有基线。
- 线上 0.2.0 EXE 实际 Range 请求返回 HTTP 206、准确的 Content-Range 和 1024 字节，
  当前 CDN 对外链路具备范围读取条件。
- `git diff --check` 通过。未上传、未操作用户正常安装目录、未创建提交或标签。

## 线上缓存配置必须调整

本次 HEAD 检查发现线上 `latest.json` 返回 `Cache-Control: public, max-age=31536000`，
同时已有缓存 Age。上传新清单后应在 CDN/源站对这个精确 URL 改为
`Cache-Control: no-cache` 并刷新已有 CDN 缓存，否则可能继续返回旧版。
版本化 EXE 和 blockmap 继续长期缓存即可。不要为刷新清单而覆盖旧版本安装包。

检查地址：`https://zhanlvgpt.ieasysell.com/desktop-updates/windows/x64/latest.json`。
确认返回 `version: 0.2.1` 后，再在已安装的 0.2.0 中点击“检查更新”。

日志与证据在 demo 的 `artifacts/release-0.2.1*` 及
`artifacts/release-0.2.1/real-installer-delta.json`。
