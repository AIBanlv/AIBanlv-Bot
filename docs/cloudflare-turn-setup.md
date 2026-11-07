# Cloudflare TURN 兜底接入（2026-10-27）

## 2026-10-29 发送失败诊断

桌面日志已确认一例直连 ICE 失败后，后端返回 `TURN_UNAVAILABLE`；旧实现隐藏全部上游原因，
无法仅凭此码判断具体是哪一项配置错误。新后端和桌面分别提供以下脱敏分类：

- `TURN_AUTH_FAILED`：Cloudflare 返回 401/403，检查当前令牌及权限，不自动重试。
- `TURN_KEY_NOT_FOUND`：404，检查 TURN key ID。
- `TURN_RATE_LIMIT`：429，稍后重试；原进程/设备签发预算仍保留。
- `TURN_TIMEOUT` / `TURN_NETWORK_ERROR`：检查实际处理 `/ws/control` 的服务器出网、DNS/TLS。
- `TURN_PROVIDER_UNAVAILABLE`：Cloudflare 5xx；`TURN_INVALID_RESPONSE`：响应不符合安全端点与凭证校验。

凭证请求遇到瞬时超时、网络或 5xx 最多重试一次，不重定向、不重试无效令牌或限流。
桌面等待凭证上限调至 16 秒，完整传输和手机 SHA-256 回执仍是成功依据。
日志只记录分类，不记录上游响应正文、长期 token 或短期凭证。必须部署更新后端才可取得新分类；
本地模拟通过不代表真实 Cloudflare 服务已连通。官方[凭证接口](https://developers.cloudflare.com/realtime/turn/generate-credentials/)。

## 已实现与上线前必做

桌面、后端和手机三端源码均已接入。默认先纯直连；未建立 DataChannel 时，最多发起一次
Cloudflare TURN 兜底，使用新的 transferId 和同一份暂存文件，不重新选文件或截图。
已打开通道/开始发送、等待 SHA-256 回执、手动取消或手机未应答的任务不自动重发。
业务服务器只转发授权、信令与短期凭证，文件内容不经过业务服务器、不上传对象存储。

**源码已修改不代表服务已部署。** 需要更新后端、桌面与手机，并在后端进程的环境中配置：

```dotenv
CONTROL_TURN_ENABLED=true
CLOUDFLARE_TURN_KEY_ID=<Cloudflare TURN 令牌 ID>
CLOUDFLARE_TURN_API_TOKEN=<重新生成的 API 令牌>
# 可选：每个后端进程每分钟签发凭证的上限，默认 60，范围 1–600
CONTROL_TURN_MAX_CREDENTIALS_PER_MINUTE=60
```

也可通过受保护的服务端配置使用 `control.turn.enabled/key-id/api-token/max-credentials-per-minute`。
未配置或未显式启用时不声明 `turnFallbackV1`，继续纯直连，不影响其他绑定/对话功能。
环境变量必须注入实际运行控制 WebSocket 服务的 Java 进程；改配置后重启服务，客户端重连。
不需要修改数据库，不需要另建文件上传接口，也不需要把业务域名接入 Cloudflare CDN。

用户截图中的长期令牌已经暴露，应在 Cloudflare 撤销并重新生成；不要再贴到聊天中。
长期令牌仅保存在服务器部署机密中，不进入源码、Git、桌面或手机安装包、日志、模型上下文。
本文仅包含占位符；本次没有使用截图中的令牌，没有部署或创建真实中转会话。

## 授权与费用边界

- 桌面申请 `get_transfer_ice` 使用当前绑定 secret 与当前 socket nonce 的 HMAC 证明。
  服务端核对当前绑定、目标手机前台接收就绪与新版能力；单设备最多 4 次兜底申请/分钟。
- 手机沿用 JWT 签发、绑定当前控制 WebSocket 的短期票据，只有本次指定的接收会话可取凭证。
  每次传输的两端各取一次，不可换手机或重放；断线/解绑后不接收迟到凭证。
- 服务端请求固定 HTTPS Cloudflare 凭证 API，TTL 300 秒，禁用重定向，响应最多 16 KiB。
  仅下发 `turn.cloudflare.com` 的白名单端口/协议，绝不把上游响应错误或长期令牌透传。
  外部请求在信令锁外执行，不阻塞所有设备的信令处理。
- TURN 只在明确授权的 `transport=cloudflare` 路由允许 relay SDP，旧纯直连路由仍拒绝。
  SDP 最大 24 KiB，文件 8 MiB、16 KiB 分片与完整 SHA-256 回执约束不变。
- 数据仍由 WebRTC DTLS 端到端加密。界面明确区分直连与 Cloudflare 中转，不把“已申请”
  或“连接建立”当成“手机已收到”。普通文件明确保留文件名解析范围，不因中转扩大读取权限。
- 单文件 8 MiB 是应用协议限制，**不是 Cloudflare TURN 的硬带宽配额**。短期凭证和签发限流
  只能降低滥用风险，不能等同于费用硬上限。应在 Cloudflare 配置用量监控与费用通知。
  限流/授权路由是进程内状态；多实例仍需会话粘滞，不宣称跨实例天然可用。

官方当前标价：每月 Realtime TURN/SFU 共享前 1,000 GB 免费，超出 $0.05/GB 出站流量；
账单以 Cloudflare 实际统计为准。中国大陆网络不属于该 TURN 服务的中国网络覆盖，需三网真机验收。

## 验收

自动化仅用本地协议与合成文件：覆盖纯直连失败、一次性兜底、旧事件隔离、暂停/断线后迟到凭证、
错误归属/票据/手机、非法端点、重复请求、签发限流、无凭据泄漏、收到完整校验回执才成功。
真实浏览器验证本地 DataChannel 分片、损坏文件拒绝以及设置页面 320/650/960 无溢出。
它们不能替代 Cloudflare 真实连通性验证。

部署并配置后，手机保持远程对话页在前台，使用流量，电脑接其他网络，显式发一个合成截图；
检查直连成功或日志 `transfer.relay-requested`、relay 候选、channel-open、transfer.received。
日志不应包含 SDP、公网候选 IP、TURN username/credential 或 API 令牌。重复测一次后关闭
手机页面，确认不再向其他同账号手机发送；有完整校验回执才能验收成功。

原生 Electron 测试仍受本机目录 ACL 限制，Maven 离线缺 resources-plugin；桌面 Java/LAM
测试缺 Gson 2.11.0 缓存。未改系统权限或关闭沙箱；隔离 Java 源码编译和 JUnit 用例另行执行。
未打包 EXE/APK、未部署服务、未通过真实 Cloudflare 中转或发送私人文件。

## 官方依据

- [临时凭证接口](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
- [TURN 服务与端口、覆盖范围](https://developers.cloudflare.com/realtime/turn/)
- [Realtime 计费](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)
