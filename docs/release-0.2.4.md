# AIBanlv 0.2.4：Windows 更新全部使用 Cloudflare R2

**状态：未发布清单的验收候选，不作为最终交付。** 较长范围响应在实测网络中停顿并触发无数据超时，
收尾版本改为 [0.2.5](release-0.2.5.md)，加入最多 1 MiB 的范围请求分段。
本文件记录候选构建；下面的 0.2.4 安装计划由 0.2.5 发布说明替代。已上传候选对象保留，未覆盖版本文件，也未切换线上清单。

当前版本将默认检查源切换为 `https://download.aibanlv.ai/desktop-updates/windows/x64/latest.json`。
完整包、块图与清单只发布到 R2 的 `aibanlv-downloads/desktop-updates/windows/x64/`；不向七牛云发布新文件，不设置自动旧源回退。
保留既有增量下载、完整哈希校验、退出安装和任务栏品牌修复，并包含构建前已合入的远端任务/图标生成等改动。

## 首次切换

0.2.3 及更早的 EXE 内置旧源，无法凭服务器文件迁移自动切换。请从本地发布目录或 Cloudflare 手动安装一次：

```text
https://download.aibanlv.ai/desktop-updates/windows/x64/AIBanlv-0.2.4-win-x64-Setup.exe
```

先从托盘“退出”旧版，再运行安装包并沿用原安装目录，不需要卸载。文件占用时完全退出后点重试，不点忽略。
保留 `%APPDATA%\Control Device`，以保留绑定、设置与下载基线。若曾配置 `PET_DESKTOP_UPDATE_URL`，清除旧覆盖或改为 Cloudflare。
安装后确认版本为 0.2.4；线上清单同为 0.2.4 时没有更新属于正常情况，以后的更高版本均使用 Cloudflare。

## 发布与回退

构建产物保存于 `demos/web-desktop-pet/dist/releases/0.2.4/`，公开文件仅有 EXE、对应 blockmap 和 latest.json。
先上传 EXE/块图并验证，再最后替换清单；清单响应头 `Content-Type: application/json`、`Cache-Control: no-store`。
沿用下载域名现有的 EXE 与精确清单 URL 两条 Bypass cache 规则，验证公开清单与 206 范围响应。
旧的 0.2.3 R2 产物保留。遇到问题时暂停分发或恢复 Cloudflare 上一个可信清单；已安装新版不会自动降级，后续修复使用更高版本。

## 验证范围

根 Node 测试 604 项通过。实际打包程序验证应用版本、内置 Cloudflare 默认源、更新检查、下载校验、任务栏属性及快捷方式修复。
安装交接使用安全夹具验证父进程退出后仍能启动安装程序；不自动覆盖用户正常安装目录。
运行时复用已验证的固定 Python/模型/Java 资源。构建保留原有 Java 弃用 API 提示，安装包仍未签名；已知依赖审计和旧综合 UI 验收限制参见历史发布说明。
用户已在 Cloudflare 配置真实 R2 域名、凭据与缓存规则，线上大文件范围读取和 0.2.2 → 0.2.3 增量重建已通过。
0.2.4 的实际产物与线上验证结果随本轮构建发布补充；证据在 demo 的 `artifacts/release-0.2.4*`。

## 最终构建产物

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| AIBanlv-0.2.4-win-x64-Setup.exe | 737993093 | 313f27332f534c255250ef320ce1f0b1a84153ce31e36458108f60e66c6a78db |
| AIBanlv-0.2.4-win-x64-Setup.exe.blockmap | 770143 | d114cda4620a6daae9d7cd3c168e58c283df6fc156177236d7b03cc5799d5b36 |

本地公开目录仅含上述两个文件与配套 `latest.json`，清单地址全部为 `download.aibanlv.ai`。
应用 EXE 产品版本为 0.2.4，打包的默认源、安装交接和窗口品牌模块与当前源码逐文件 SHA-256 一致。
