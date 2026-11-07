# 线上插件列表

## 本次范围

插件中心保留四个内置插件，进入页面或点击刷新时查询 Cloudflare 上的公开清单，展示线上插件名称、版本和简介。上架、下架均由维护者修改 Cloudflare 清单，Windows 用户端只有查询和刷新入口。无需绑定账号，不创建模型会话。ZIP 下载、安装、运行及包内规范等待首版插件后另行制定；本次不改 Java 服务端、数据库、认证或依赖。

## 发布清单

Windows 固定读取：

```text
https://download.aibanlv.ai/desktop-plugins/catalog.json
```

将 `docs/examples/desktop-plugin-catalog.json` 复制为 `catalog.json`，维护以下结构，然后上传到现有下载域名对应 R2 存储桶的 `desktop-plugins/catalog.json` 对象。客户端仅匿名读取，不保存上传密钥，也不会枚举存储桶。

```json
{
  "schema": 1,
  "plugins": [
    {
      "id": "example-tool",
      "name": "示例工具",
      "version": "1.0.0",
      "description": "填写插件的实际用途",
      "enabled": true
    }
  ]
}
```

上述条目仅说明格式，模板默认为空列表，不代表已有线上插件。

- `schema` 固定为 `1`；`plugins` 最多 200 条，清单总大小不超过 256 KiB。
- `id` 唯一，1–80 个小写字母、数字、点、下划线或连字符，首字符为字母或数字。
- `name` 必填，最多 120 字符；`version` 和 `description` 可省略，分别最多 80、2000 字符。字段内容只作为文本展示。
- `enabled` 可省略，默认为可用；设置 `false` 或移除条目即可下架。未识别字段不参与展示，也不执行。
- JSON 文件设置 `Content-Type: application/json`、`Cache-Control: no-store`，该清单路径应绕过 CDN 缓存；已缓存时清除该 URL 的缓存。
- 正常返回空数组显示“暂无线上插件”；404 显示“线上插件列表尚未发布”；网络或格式失败显示查询失败并允许刷新，不影响内置插件。

R2 的公开桶根路径不提供对象列表，因此新增文件不会自动成为插件条目，需要同步更新此清单。参考：[Cloudflare 公开桶](https://developers.cloudflare.com/r2/buckets/public-buckets/)。

## 实现与验证边界

沿用现有主进程、preload、视图模块分层：主进程只查询固定 HTTPS 清单，对并发查询去重、限时、限制响应大小并验证字段；IPC 只接受设置窗口。视图使用 `textContent` 和现有插件样式，提供加载、空列表和失败状态，侧栏数量随查询结果更新。客户端不接收自定义 URL，不携带设备凭证，不请求 ZIP。

实现顺序：先测试清单解析与查询，再接入 IPC 和插件中心，最后使用本机 HTTP 夹具验证实际 Electron 查询与界面。只运行相关验证，不打包、不做全量验证、不上传或部署。

源码位于 `demos/web-desktop-pet/electron/device-plugin-catalog.mjs` 和 `device-plugins-view.mjs`，测试位于同项目 `tests/`；沿用项目 ESM、两空格缩进和无分号风格。

从 `demos/web-desktop-pet` 使用 Node 24+ 执行：

```powershell
node --test tests/device-plugin-catalog.test.mjs
node tests/device-plugins-electron.mjs
node --test --test-name-pattern="device distribution includes its complete entry" tests/device-package.test.mjs
```

验收：线上新增/下架反映在刷新结果；四个内置入口保持可用；未发布、断网、非法 JSON 不显示为查询成功；清单文本不能生成 HTML；窗口正常打开和退出。测试使用隔离资料目录及本地清单，不访问账号数据或收费模型。

2026-11-06：六项清单测试、真实 Electron 读取/展示专项通过，覆盖 320/768/1024/1440 宽度、英文界面和设置窗口 IPC 限制。默认公开地址实际返回 404，尚需维护者上传清单；本轮没有向 Cloudflare 上传任何对象。
