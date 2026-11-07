# 扫码设备 JWT

2026-11-02 后续范围变更：账号登录与桌面注册入口已移除，未绑定不再使用游客形象或业务 API。
下文旧边界与验收按历史记录保留；现行入口和迁移约定以[仅扫码规格](qr-only-desktop-spec.md)为准。

用户于 2026-11-02 确认优先补扫码获得 Token，账号登录暂不改造，legacy 保留放行。

## 目标与边界

设备已有扫码配对密钥和当前控制连接 nonce。主进程使用 HMAC 证明向
`POST /jwt/client/desktop-auth/token` 换取五分钟 JWT；服务端从数据库绑定和
账号查出用户/租户，禁止由调用者指定。JWT 绑定设备及配对密钥摘要，解绑、
重新配对或账号不可用后拒绝使用；无需密码、账号登录或 refreshToken。
Token 只在主进程内存中保存，不发送到 Renderer、控制消息、日志、URL、模型或对象存储。

角色、音色与积分业务使用 `/jwt/client/desktop/{roles,voices,account}`。
会话入口以 [DEVICE-SPEC](../demos/web-desktop-pet/electron/DEVICE-SPEC.md) 的现行桌面中继规格为准。
服务器 `/client/desktop/**` 在通配放行前要求 JWT；设备 JWT 仅可访问上述方法及路径。
公共游客形象、游客会话/积分与注册登录入口保留原行为；legacy 与其他客户端不改。
音色仅允许绑定租户和既有公共租户 1508290699769155584、24、1。
会话 deviceId 必须等于 JWT 设备标识的 SHA-256，角色只能是公共/租户共享/该用户的角色。

## 协议

Token 请求 JSON：`{ deviceId, deviceProof }`。证明沿用
`HMAC-SHA256(pairingSecret, deviceId + '\n' + nonce)`，服务端定位当前在线设备并校验。
成功返回既有 R 包装：`data: { accessToken, expiresAt, deviceId, tenantId, controllerUserId }`。
无绑定/证明/账号返回 401；不回传配对密钥。客户端按单个在途请求取得 Token，
过期前续期，断线/解绑/身份变化中止请求并清理；不能在未知 POST 结果后自动重放。

## 实现与验证

桌面 ES modules/Node 24、现有 Electron；服务端 Java 8/Spring/JJWT，无新依赖。
先完成 token 签发、失效与作用域测试，再接桌面凭证、私有 HTTP 和端到端夹具。
代码使用现有 camelCase、单引号及各 Java 包风格。源码在 demo/electron 与
lb-broadcast-app/config、controller；测试在各自 tests 与 src/test/java。

验收：无证明/伪造/跨设备请求拒绝，合法扫码换 Token；JWT 缺失、伪造、过期、
解绑或换绑拒绝私有业务；公共音色配对保留；合法业务发送 Bearer；凭据不泄漏。
执行根目录 `npm test`、demo `npm run device:test`、服务端 JDK 8 Maven 聚焦测试与
相关模块测试、`git diff --check`。全部使用本地夹具，不调用线上付费模型、不打包部署。

## 实施与验证记录

已接入 `device-http-auth.mjs` 和服务端 `DesktopDeviceTokenService`、
`DesktopHttpController`。既有配对 HMAC 不变；主进程收到当前连接挑战后，
单次交换获得 JWT，在后续请求前按需续期；解绑、断线、身份切换清除内存凭证。
HTTP 401 不自动重放业务 POST。没有修改账号登录或 legacy 放行规则。

| 公网调用 | 后端调用 | 身份要求 |
| --- | --- | --- |
| POST `/jwt/client/desktop-auth/token` | `/client/desktop-auth/token` | 在线绑定设备的当前 HMAC 证明 |
| GET `/jwt/client/desktop/roles` | `/client/desktop/roles` | 设备 JWT，限定绑定用户/租户与公共角色 |
| GET `/jwt/client/desktop-public/roles` | `/client/desktop-public/roles` | 无需登录，只返回无个人归属的公共角色；固定公共查询范围，忽略租户/用户参数；保留并发和 SQL 超时保护 |
| POST `/jwt/client/desktop/voices` | `/client/desktop/voices` | 设备 JWT，限定自身和既有公共音色租户 |
| GET `/jwt/client/desktop/account` | `/client/desktop/account` | 设备 JWT，只返回绑定租户积分 |
| POST `/jwt/client/desktop-public/voices` | `/client/desktop-public/voices` | 游客公共读取，仅允许三个固定公共租户 |

原公网路径由主进程传输层映射到这些受保护入口，不向第三方资源下载或模型调用注入设备 JWT。
公共角色和游客会话仍是原有公开流程，不能把游客请求当作登录成功。旧绑定没有本机
配对密钥时必须在手机解绑后重新扫码；不会用设备 ID 冒充持有配对密钥。

- Node 24.22.2：根目录 `npm test`，702 项通过，0 失败、0 跳过。
- 服务端 JDK 8：11 个聚焦测试类共 74 项通过，包含实际签名/过期 JWT、
  配对证明、换绑失效、桌面 HTTP 安全链、资源范围以及原客户端兼容。
- Electron 专项：demo 中设置 `$env:DEVICE_JWT_ONLY='1'` 后运行 `npm run device:test`，
  真实扫码二维码、HMAC 换 Token、四类业务 Bearer、渲染器隔离、断线重取与解绑清理通过。
  该专项验证 HTTP 鉴权链路，不宣称完成云端语音或模型服务验收。
- 完整 Electron 验收：游客文字回复检查超时；使用 `git show HEAD` 提取原版主入口、
  相同隔离网络夹具和全新配置目录后，同一检查也超时，确认该完整验收问题并非本次 JWT 改动引入。
  未降低该检查要求；源码保留完整验收，另外用 `DEVICE_JWT_ONLY` 执行本次扫码鉴权专项。
- 还修复了已有 `RealtimeSessionSecurityTest` 中过时的用户加载 Bean 类型，以便执行安全链断言。

源码改动没有部署。上线前先更新两台服务节点，再使用新版桌面端。
现有 Nginx `/jwt/` 代理已覆盖以上路径，不要求修改 legacy 配置。
日志位于系统临时目录 `scan-jwt-final-node.log`、`scan-jwt-final-server.log`、
`scan-jwt-focused-electron.log`；Electron 专项产物为 demo 下
`artifacts/device-electron/scan-jwt-results.json`（不提交生成产物）。
对照日志为系统临时目录 `scan-jwt-baseline-electron.log`；临时原版入口已删除。

## 服务端慢依赖保护补充

本轮按审查问题补充：设备换 Token、JWT 用户加载/绑定校验与桌面角色、私有/公共音色、账户读取共用每节点 2 个查询名额，
缺少证明直接拒绝，桌面范围内 JDBC 语句超时默认 2 秒；会话创建改为异步 HTTP 响应、
每节点 4 个专用线程、8 秒创建时限和依赖失败短路。同一设备、账号、租户与
`clientRequestId` 的相同请求在单节点内合并，完成结果复用 30 秒，不提供跨节点恰好一次。
超时但未实际结束的任务继续占用名额。已认证会话跳过全量绑定查询。

会话饱和或短路返回 503、总时限返回 504、下游失败返回 502；客户端仍不自动重放业务 POST。
SQL 超时通过 JDBC 语句配置，与 Hikari 获取连接等待超时独立。真实数据库慢 SQL 的取消行为
尚未集成验证；本轮测试使用阻塞桩、真实 Spring 过滤器/异步响应、MyBatis 插件链和 localhost HTTP。
具体配置、边界与 Maven 命令见服务端仓库 `docs/control-desktop-jwt.md`，日志为
系统临时目录 `desktop-guard-final.log`。账号登录和 legacy 放行保持原样，未部署。
上一轮慢依赖修复的服务端 JDK 8 Maven 回归为 16 个测试类、114 项通过，0 失败、0 错误、0 跳过；编译成功。
查询入口保护补充还在真实全局异常 advice 下检查 HTTP 状态，桌面控制器保留超载 503、
权限拒绝 403 及异步超时 504，原全局处理器和 legacy 行为未改。
新增四入口各自及公私混合的 16 并发回归、JDBC 2 秒超时与失败后恢复测试；
本轮日志为系统临时目录 `desktop-query-final.log`。
查询保护补充后的 JDK 8 Maven 编译及回归：21 个测试类、129 项通过，0 失败、0 错误、0 跳过。
四入口及公私混合阻塞测试中，16 个请求最多 2 个进入业务查询，其余快速返回 503。

提交前再次执行 `git pull --ff-only`，桌面 `master` 已是最新；服务端 `jwt` 无冲突快进至
`da7b739`。合并后服务端追加远端设备绑定及 legacy 兼容回归，共 23 个测试类、145 项通过。
Node 24 下根目录 `npm test` 再次 702 项通过，`DEVICE_JWT_ONLY=1` Electron 专项再次通过。
日志为系统临时目录 `scan-jwt-precommit-server.log`、`scan-jwt-precommit-node.log`、
`scan-jwt-precommit-electron.log`。本机 `.iml` 文件、日志和生成产物不纳入代码提交。
