# 桌面端接口鉴权审查（2026-11-02）

后续用户选择优先补扫码换 Token，账号登录暂不改造。该链路现已实现，最新接口和验证见
[扫码设备 JWT](scan-jwt-spec.md)。下面保留的是改动前代码的审查记录，不代表实施后的最终状态。

## 用户确认后的范围与判断

用户已明确：`/legacy/**` 是另一个客户端的既定匿名入口，必须保留放行。本次只判断 control-windows 使用 `/jwt/...` 后是否正常鉴权，不将 legacy 放行本身列为待整改项，不修改另一个客户端或其接口。

按提供的 Nginx，`/jwt/client/...` 到达后端 `/client/...`，进入现有 JWT 过滤器。当前结果是：非白名单接口携带有效 Bearer 会认证，携带无效/过期 Bearer 会返回 HTTP 401；但不带 Bearer 仍会经过过滤器，且 `"/**".permitAll()` 不阻止匿名访问。因此“能验证提交的 JWT”成立，“加前缀后自动强制 JWT”不成立。

| control-windows 调用 | 加 `/jwt` 后的具体判断 |
| --- | --- |
| 角色目录 `aliBot/getBotListTWithPublic` | 已使用 `/jwt/client/...`；未发送 Bearer。缺失 Token 无统一拦截，控制器也无登录检查 |
| 历史实时会话入口（桌面已停用） | 当时已使用 `/jwt/client/...`；未发送 Bearer。后端仍接受匿名/设备绑定识别流程 |
| 音色 `Voice/aliyun/listClientVoices` | 当前使用 `/client/...`，改为 `/jwt/client/...` 会进入新版控制器；不带 Bearer 返回业务码 401。有效 Bearer 可认证，但新版强制查询登录租户，当前逐个查询公共租户的配对逻辑还需适配 |
| 积分回退查询 `reception/getReception` | 已使用 `/jwt/client/...`；该 HTTP 回退未发送 Bearer，缺失 Token 不会统一拦截 |
| 游客 `digital-human/anonymous/status` | 已使用 `/jwt/client/...`；当前设计允许无 Bearer 查询 |
| 游客积分归集 `digital-human/anonymous/claim` | 已使用 `/jwt/client/...` 且发送 Bearer；控制器检查 BaseUser，已有实际认证保护 |
| 登录、注册、发送验证码 | 是获取身份之前的入口，不能用“必须已有登录 JWT”的规则统一拦截；当前按各自认证/验证码流程处理 |

桌面登录函数解析了 access_token，但仅在游客积分归集时使用，返回结果只有用户/租户 ID；其他业务请求没有统一取得、保存和发送此 Token。扫码绑定也没有提供可直接用于 HTTP 的账号 JWT。因此仅修改 URL 不能保证上述接口正常鉴权和正常使用。

如要让 `/jwt` 入口真正强制认证，需在保留 `/legacy/**` 放行的前提下修正非 legacy 安全规则，并为桌面业务补齐 Bearer 获取与携带。以下为前一轮扩展审查记录；超出上述范围的 WebSocket、其他客户端与存储建议不属于本次实施要求。

## 结论与范围

**结论：需要整改，当前不能认为桌面端业务接口已完整鉴权。** 缺口同时存在于全局 HTTP 安全策略、旧版兼容入口、WebSocket 身份注册、设备会话创建和资源归属校验。只在桌面请求头补 `Authorization` 无法修复服务端缺口。

- 桌面仓库：`F:/zhanlvAndroidSdk/control-windows`，`master`，`5e9b970`；已执行 `git pull --ff-only`，结果 `Already up to date`。
- 服务端参考：`F:/zhanlvwork/live-broadcast-java-test`，本地 `jwt` 分支，`e43d674`；本轮未更新服务端分支。
- 网关参考：用户提供的线上 Nginx 文本。未取得 include 文件、完整 `nginx -T`、防火墙规则、ASR 服务源码或生产部署版本。
- 审查重点：桌面主入口 `demos/web-desktop-pet/electron/device-main.mjs` 使用的网络接口，以及相应服务端安全链和兼容路由；不是整个 Java 平台全部业务的逐方法权限审计。
- 本轮只判断并记录，无鉴权代码修改、提交、部署或生产探测；未创建付费会话。

## 信任边界

外部客户端经过 Nginx 到达 HTTP/Servlet WebSocket；旧 `/websocket/{key}` 还可能直接进入独立 Netty 监听器。桌面主进程再访问云端模型、对象存储与本机工具服务。

需要保护的资产包括：账号/租户身份、绑定设备与控制指令、私有角色与音色、会话记录、积分与计费、云端临时凭证、私有模型文件。客户端提交的 `tenantId`、`controllerUserId`、`deviceId`、角色 ID 和 `SHA-256(deviceId)` 均不等于已经认证的身份。

主要滥用场景：冒充控制端下发指令；冒充设备读取历史；指定其他租户下载目录或音色；凭设备标识创建计费会话；通过旧路由绕过新路由保护；无票据注册计费流。整改测试应直接覆盖这些场景。

## 关键发现

### P0：HTTP URL 安全策略整体放行

`JwtSecurityConfig.java:48` 的 `.antMatchers(..., "/**").permitAll()` 在 `.anyRequest().authenticated()` 之前匹配所有路径。`JwtAuthenticationFilter.java:94` 只有收到 Bearer Token 才验证，未携带 Token 时继续过滤链。因此大量缺少控制器内部检查的接口可匿名进入业务。

此外，`JwtSecurityConfig.java:34` 放行 `/legacy/**`，`JwtAuthenticationFilter.java:29` 开始的白名单跳过整个 `/legacy/`；这是用户确认需要保留的另一个客户端行为，本次不修改。微信/支付宝部分支付业务有专门例外。

`MyHandlerInterceptor.java:14` 的 `preHandle` 直接返回 true，不能补上这个缺口。启动类的 `@EnableBaseResourceServer` 已注释，不能假定旧 OAuth 或方法级注解自动兜底。部分控制器确实有显式身份检查，需保留，不能把“全局放行”误写为“所有业务均能成功匿名执行”。

### P0：控制 WebSocket 首次身份不可信，设备证明只覆盖部分消息

- `ControlWebSocketConfig.java:23` 未注册身份握手拦截器。
- `ControlChannelHandler.java:118` 直接注册 `ControlMessageParser.readOnlineIdentity` 的结果。
- `ControlMessageParser.java:43` 从 `controller_online` 的 `tenantId/controllerUserId` 构造控制端身份；设备端只需 `device_online/deviceId`。没有验证账号 JWT 或设备私钥/配对证明。
- `requireOwnedBinding` 虽检查数据库绑定，但比较的是这份自报身份，不能阻止冒充已有绑定的控制者。受影响操作包括 `get_bound_devices`、`send_text`、`switch_avatar`、`apply_agent_config`、`distribute_agent`、`unbind` 等。
- 已绑定设备上线时，服务端在证明校验前发送 `bind_success`、身份和期望角色配置；`device_history_request`、`agent_state_report`、`assistant_reply` 等也没有统一的设备证明门禁。知道设备 ID 后存在设备冒充、历史泄露/污染和连接替换风险。
- `ControlDeviceProof` 已对 `desktop_action`、`get_device_account`、设备侧文件传输相关消息校验配对 HMAC。它是有效的局部保护，不是整个通道的认证。
- 桌面 `device-login.mjs:63` 登录成功后只返回用户/租户 ID，`:179` 发出的 `controller_online` 没带登录 Token。服务端收紧后必须同步修改这个流程。

### P0：实时会话用设备 ID 哈希直接恢复付费身份

`device-session.mjs:120` 创建会话不携带用户或设备凭证。服务端 `DigitalHumanSessionService.java:98` 起，在没有登录身份时按请求中的设备哈希查绑定，并据此构造付费会话身份。`MybatisControlStateStore.java:150` 仅比较 `SHA-256(binding.deviceId)`，没有持有者证明。

这不是完全没有范围校验：服务确实限制匿名角色，并核对绑定租户与角色租户。但是设备标识一旦泄露，哈希可直接计算，不能防止冒充设备领取模型临时凭证、访问该绑定允许的私有角色或消耗其积分。需要先验证设备凭证，再从有效绑定确定计费主体；用户私有角色还需检查用户归属。

### P1：角色目录与旧版音色列表按外部 tenantId 查询

- `AliBotController.java:75` 的目录查询直接传入 `tenantId`，服务与 Mapper 未从认证身份收敛范围；Mapper 条件为指定租户或公共租户 `1`。
- 桌面 `device-catalog.mjs:46` 未携带凭证。客户端 `profileFor` 过滤只能隐藏 UI，完整响应已到达请求者，不能承担服务端授权。
- `LegacyClientVoiceListController` 明确接受外部 `tenantId`，且被全量 legacy 放行。桌面实际调用的是该旧版路由。
- 新 `ClientVoiceListController` 要求 `BaseUser` 并强制使用登录租户，已有内部保护；不能只修这个新路径而留下旧入口。

同一角色控制器的 `bindingBot`、`updateBot`、`delAliBot` 也未验证当前用户与目标数据库记录的归属。请求体里声明“不是公共租户”不能证明有修改权限。新旧控制器均需覆盖；`updateBotForAdmin`、`delAliBotForAdmin`、新版 `deleteRoleWithAssets` 已有内部身份/权限检查，应区别处理。

### P1：计费 WebSocket 保留无票据分支

桌面 `device-billing.mjs:49` 正常发送 `billingTicket`，服务端 `DigitalHumanSessionGrantStore` 验证签名、有效期、会话和设备，是已有保护。

但 `DigitalHumanSessionHandler.java:129` 的 `authenticatedRegistration` 对非匿名 producer 缺票据或 listener 分支可直接返回客户端声明的身份；随后 Registry 只比较这些声明字段。知道会话及身份字段后存在冒充监听或生产者的风险，且可无票据建立自报身份的新计费流。所有 producer 应强制校验票据，listener 应持有经过授权签发、限定会话和角色的凭证，不能信任消息中的身份字段。

### P1：旧 Netty WebSocket 不经过 Servlet JWT 安全链

`NettyWebSocketServer.java` 自建 pipeline；握手只检查路径 `/websocket/` 和非空 key。`WebSocketServer.java` 从 key 的下划线字段取租户/用户，消息路由还接受正文中的 `tenantId/type`，没有凭证验证。用户 Nginx 将 `/websocket` 指向独立 6371 上游。

仅修改 `JwtSecurityConfig` 不能保护这个监听器。若继续开放，需独立验证凭证并绑定连接身份、路由范围；不再使用的入口应明确下线。`/recognition` 在所读 Netty 实现中不匹配 `/websocket/` 前缀，实际线上处理程序仍需以部署配置确认。

## 桌面直接使用的 HTTP 接口清单

下表路径为浏览器/桌面访问的公网路径，域名均为 `scrm.ieasysell.com`。

| 方法与公网路径 | Nginx 后端路径 | 当前状态 | 整改判断 |
| --- | --- | --- | --- |
| GET `/jwt/client/aliBot/getBotListTWithPublic` | `/client/aliBot/getBotListTWithPublic` | 无凭证；按 tenantId 查询 | 私有目录必须验证用户/设备身份和归属；公共目录单独限定范围 |
| POST `/client/Voice/aliyun/listClientVoices` | `/legacy/client/Voice/aliyun/listClientVoices` | 无凭证；旧路由接受 tenantId | 必须补设备/用户鉴权；公共音色采用服务端固定范围 |
| 历史实时会话入口（桌面已停用） | 历史会话后端入口 | 无凭证；设备哈希可恢复绑定身份 | 必须补设备/用户认证及角色归属校验 |
| POST `/jwt/client/digital-human/anonymous/status` | `/client/digital-human/anonymous/status` | 只提供设备哈希 | 采用游客设备会话凭证，防止查询他人状态 |
| POST `/jwt/client/digital-human/anonymous/claim` | `/client/digital-human/anonymous/claim` | 带登录 Bearer；控制器验证 BaseUser | 保留已有用户认证，补设备持有证明和归属规则 |
| GET `/jwt/client/reception/getReception` | `/client/reception/getReception` | `device-score.mjs` 留有无凭证回退；主流程优先 WS | 回退路由也必须鉴权，服务端决定租户；不能只保护客户端主流程 |
| POST `/new/oauth/token` | `/auth/oauth/token` | 用户密码认证；客户端发送固定 Basic | 登录入口；不要求已有登录 Token，固定 Basic 不是用户身份 |
| GET `/jwt/client/website-auth/send-email-code` | `/client/website-auth/send-email-code` | 注册前入口；固定 Basic | 保留窄入口，使用验证码/防滥用策略，不整体放行目录 |
| GET `/jwt/client/website-auth/register` | `/client/website-auth/register` | 邮箱验证码注册；固定 Basic | 保留注册校验，不能要求已有账号 JWT |

`loadDefaultProfile` 与游客目录复用第一条接口并传 `tenantId=1`，不是另外一个接口。登录/注册目前将密码放在 URL 查询参数中，后续应迁移到请求体以避免访问日志记录凭据；这属于凭证传输整改，不是业务 JWT 白名单扩张的理由。

## 已有保护与额外边界

| 入口/调用 | 判断 |
| --- | --- |
| `/ws/control` 的 `desktop_action/get_device_account` 等 | 已有 HMAC 与绑定检查，但必须补通道级认证并统一覆盖所有业务消息 |
| `/ws/digital-human-session/{sessionId}` | 桌面正常带签名票据，但服务端无票据兼容分支必须收紧 |
| `/digital-human/ws` | 已有一次性票据：握手或首帧验证；首帧超时关闭；不能仅因 permitAll 判断为无鉴权 |
| 云端 Realtime WebSocket | 桌面带服务端返回的临时模型凭证；上游认证不替代会话签发接口的认证 |
| DeepSeek API | 使用配置的 API Key；不要向第三方转发业务登录 JWT |
| 七牛上传 | 由经 HMAC 保护的 desktop_action 获取上传 Token，随后上传对象存储；需保留对象范围限制 |
| 本机静态 HTTP | `text-server.mjs` 验证 Host 和 `X-Pet-Token`；不是匿名公网业务接口 |
| 本机工具 `/tools` | 随机 Bearer、回环地址和活动会话检查；已有认证 |
| 模型 ZIP、智囊团图片/视频 | 客户端下载没有业务认证；未取得存储端策略。私有对象需要短期签名 URL/私有桶，不能只限制目录接口 |
| 更新清单、安装包、公共形象 | 可作为明确公共资源，下载完整性与私有资源授权分别处理 |
| `/ws/session` ASR | 指向独立 8282 服务，源码未提供，不能判断为已认证或确认漏洞；需单独核查握手、首帧与凭证签发 |

## Nginx 判断

1. `/jwt/`、`/websiteClient/` 会改写到非 legacy 后端；`/client/`、`/webClient/` 会改写到 legacy 后端。同一业务存在多个外部入口，必须一起验证，不能只按 URL 名称判断。
2. 所贴文本没有执行 JWT 验证的 `auth_request/auth_jwt`。`proxy_set_header Authorization $http_authorization` 只是转发请求头。
3. 没显式写这条 `proxy_set_header` 不等于丢失 Authorization；Nginx 默认传递请求头，需结合上层配置和 include 确认。不要误把“补转发头”当作完整鉴权方案。
4. include 文件未提供，不能断言线上无其他防护，也不能确认所有公开别名。验收时需核对完整 `nginx -T`。
5. 6371/6372/8282 的网络访问范围未核实；应检查是否能绕过网关直达上游。服务端本身仍需验证凭证。
6. 两个 6372、6371 上游节点应同时升级并验证凭证/撤销状态可跨节点生效。Nginx 的权重配置不能证明节点代码或状态一致。

依据：[Spring Security 5.3 HttpSecurity](https://docs.spring.io/spring-security/site/docs/5.3.4.RELEASE/api/org/springframework/security/config/annotation/web/builders/HttpSecurity.html) 的顺序匹配规则，以及 [Nginx proxy 模块](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass) 的 URI 替换与请求头转发规则。

## 推荐修复顺序与验收条件

1. 先明确用户 JWT、已配对设备、游客设备三种身份。控制端 JWT 必须验证并由服务端解析用户/租户；设备使用可撤销、有限范围的凭证或握手证明。游客通过受限初始化获取游客凭证，不再凭任意设备标识调用业务。
2. 桌面保留和使用必要凭证，完成刷新/过期/解绑清理；同步修改手机端或其他控制端协议。仅在 Renderer 保留“已绑定”布尔值不能授予权限。
3. HTTP 保留 legacy 的既定放行；修正非 legacy 的全量 permitAll，按精确公开入口与需认证业务分别处理。注册/登录/验证码入口以及供应商签名回调分别执行自己的认证策略。
4. `/ws/control` 在首次业务前认证；设备证明成功前禁止发送私有角色/绑定信息。HTTP 会话签发与计费/监听 WS 强制验证对应凭证，删除无凭证身份兼容分支。
5. 控制器/服务按认证身份限制租户和用户，查询目标记录后验证所有者。保护别名、legacy、独立 Netty 和私有存储；不能依赖客户端过滤。
6. 两个线上节点和所有调用端协调发布，验证旧客户端的升级处理。不能在客户端仍无设备凭证时直接收紧服务端并宣称兼容完成。

必要验收：缺失/伪造/过期/撤销凭证拒绝业务执行；跨租户、同租户不同用户和不属于该设备的角色拒绝；未证明设备不能读取历史/配置；producer/listener 无票据或错误会话票据拒绝；重连、解绑、账号切换和跨节点不恢复旧权限；每个 Nginx 别名/legacy 路径得到同样结果；合法登录/注册、游客与已绑定业务仍工作。模型调用和修改操作使用本地夹具，不消耗生产额度。

## 本轮验证

- 桌面：从仓库根目录执行 `npm test`，693 项通过，0 失败、0 跳过。
- 服务端：65 项聚焦测试中 64 项通过、1 项错误、0 跳过。`RealtimeSessionSecurityTest` 在创建 Spring 测试上下文时缺少 `LocalJwtUserDetailsLoader` Bean；夹具仍只提供 `BaseUserDetailsService`，与过滤器实际注入类型不符，尚未执行到 HTTP 断言。这是本地原有测试问题，本轮未修改源码修复。
- 通过的服务端用例：`JwtAuthenticationFilterTest`（8）、`ControlProtocolTest`（5）、`ControlChannelHandlerTest`（23）、`DigitalHumanSessionHandlerTest`（12）、`DigitalHumanSessionServiceAnonymousTest`（12）、`ClientVoiceListControllerTest`（2）、`LegacyClientVoiceListControllerTest`（2）。
- 默认 JDK 21 编译被旧 Lombok 的模块访问错误阻断；切换本机 JDK 8 后编译完成。父 POM 默认 `maven.compiler.skip=true` 会跳过测试编译，本轮最终命令显式关闭跳过并检查实际测试数，未把空测试构建当作通过。
- 当前已有测试明确允许部分匿名/legacy 请求、消息自报控制端身份；通过这些测试只表示当前行为一致，不能作为鉴权已安全的证明。

最终 Maven 命令（工作目录为服务端仓库；仅当前子进程设置 JDK）：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk1.8.0_202'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
mvn -pl lb-server/lb-broadcast-app -am '-Dmaven.compiler.skip=false' '-Dmaven.test.skip=false' '-DskipTests=false' '-Dtest=JwtAuthenticationFilterTest,RealtimeSessionSecurityTest,ControlProtocolTest,ControlChannelHandlerTest,DigitalHumanSessionHandlerTest,DigitalHumanSessionServiceAnonymousTest,ClientVoiceListControllerTest,LegacyClientVoiceListControllerTest' '-Dsurefire.failIfNoSpecifiedTests=false' test
```

日志：`C:/Users/Administrator/AppData/Local/Temp/control-auth-audit-node.log`、`C:/Users/Administrator/AppData/Local/Temp/control-auth-audit-maven-tests.log`。没有对线上接口进行无凭证试探，生产可达性仍需在受控环境补验。
