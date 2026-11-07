# 独立桌面验收记录 — 2026-11-02

对应 CAPABILITY-MAP-standalone.md 和用户确认的九项任务。

- [x] 1 来源规则：明确选择优先；auto 仅自有 Key；扫码、积分和调用失败不改变费用来源。
- [x] 2 独立 Key 配置：本机加密、只记进程可选、独立清除及供应商连接测试；快照无 Key。
- [x] 3 游客本地形象：内置二维形象离线启动，可编辑角色、校验并导入本机 ZIP、恢复内置形象。
- [x] 4 自有 DeepSeek：不等待平台余额或云历史；纯文字和已启用的受限本机助手。
- [x] 5 自有 Realtime：供应商直接连接，无平台 session、billing ticket 或用量上报。
- [x] 6 平台模式：保留设备证明、JWT、角色和音色权限及原计费顺序；切来源停止旧工作。
- [x] 7 本地记录：完整档案与40条上下文分开；用户文字先落盘，助手检查点及中断末态保存；支持导出/清除、旧数据迁移。
- [x] 8 扫码补传：稳定ID、ACK、离线及重启归属、换号隔离、认领批次独立；旧手机输入保留原保存协议。
- [x] 9 独立运行：默认不连平台；扫码不改变自有来源；私有服务继续鉴权；无自动收费回退。

## 已通过的验证

- 根目录 `npm test`：688项通过，0失败、0跳过。Node 24.22.2。
- Demo `node tests/device-standalone-electron.mjs`：真实 Electron + 本地供应商/控制服务。
  游客文字、自有语音、无计费通道、扫码不切来源、断开平台继续使用、独立 Key 测试、
  IPC拒绝宠物窗口配置、离线重启恢复原账号7条记录、离线续聊后补传9条且不重复。
  320/768/1024/1440四种设置页宽度通过，axe无违规，页面无异常。
- Demo `$env:DEVICE_JWT_ONLY='1'; node tests/device-electron.mjs`：配对证明、四种私有路径
  `/jwt/client/desktop/{roles,voices,sessions,account}` 均带 JWT，重连换 JWT，解绑清凭据。
- 分发文件清单及隔离的源码启动图检查通过；没有实际打包安装器。
- 服务端 JDK8：`mvn -pl lb-modules/lb-live-broadcast -am test -Dmaven.compiler.skip=false -DskipTests=false -Dtest=ControlReplyHistoryTest,ControlChannelHandlerTest -Dsurefire.failIfNoSpecifiedTests=false`，32项通过。
- 两轮独立代码审查：已修复离线重启归属、游客中断丢记录、恢复内置形象、中文档案写读容量不一致；复审无新增高置信阻塞问题。

## 验证范围与限制

只使用临时用户目录、本地服务夹具与合成语音，不使用生产 Key 或创建收费会话。
没有执行部署、安装包构建或 Mac 原生运行；真实供应商 Key 的权限、地域和音色需由用户配置。
完整旧 Electron 助手/邮箱流程未列为通过：脚本仍以旧记住 Key 默认值和逐次审批为前提。
排查期间对这些无关脚本的试改已撤回，不继续扩大本次范围。新增独立链路和 JWT 专项均通过。

服务端需配套 desktop-local-history 变更后，才接受 local-companion 的历史补传；旧服务端拒绝时本机保留待传记录。
本轮没有修改legacy接口鉴权策略，也没有将IDE文件、模型、私有形象、运行日志或本机配置纳入提交。

## 审查修复补充 — 2026-11-02

- 清除历史前暂停对话与补传、收敛写入；清除后的旧持久化回调不能重新建立待传队列。
- 已有 DeepSeek Key 留空时，仍保存记住选项；取消记住会删除磁盘密钥，保留本次进程的 Key。
- 纯文字任务向 Harness 透传发起手机的 targetSession 和完整 originalTask，与 Realtime 一致。
- 四个 Node 回归先复现失败，修复后相关38项通过：
  `node --test tests/device-history-control.test.mjs tests/device-remote-replies.test.mjs tests/device-text-conversation.test.mjs tests/device-conversation-store.test.mjs`。
- Electron 专项先复现“remember仍为true”和“清除后残留1条”，修复后约3秒通过：
  `$env:DEVICE_REVIEW_ONLY='1'; node tests/device-standalone-electron.mjs`。
  使用临时用户目录与本地模型响应，确认磁盘已删除密钥、进程内Key仍可用、在途回复不再写回或补传。
- 本轮只运行上述相关用例及差异检查，未重跑全量、未推送或部署。

## 扫码入口与模型配置分离 — 2026-11-02

- 左侧新增“模型配置”独立页，移入来源、DeepSeek/Realtime Key、地域、业务空间、模型、音色和本地记录管理。
- 设备绑定页自动获取二维码，可刷新或关闭连接，不再依赖模型表单的连接勾选及保存。
- 单独改变平台连接不重置正在使用的自有模型对话，不修改模型来源。
- 导航/模型设置相关8项 Node 测试通过；`DEVICE_MODEL_PAGE_ONLY=1 node tests/device-standalone-electron.mjs`
  约4秒通过：实际解码二维码、绑定页不含Key表单、独立模型页、断开后刷新、草稿保留、
  模型来源不变、四种宽度无横向溢出及axe无违规。截图保存在忽略的 artifacts/standalone-electron/。

## 移除本地形象 — 2026-11-02

- 删除本地伙伴二维资源、推理替代模块、本地编辑/导入/恢复入口及对应 IPC，不再读取旧本地形象配置。
- 默认使用上官婉儿，保留游客公共角色选择和自有 Key；加载失败显示原因及重试，不使用二维回退。
- 旧形象配置和聊天档案不主动删除；服务端历史兼容保持原样。
- 相关运行时、输入边界和模型设置用例通过；分发文件清单确认不再包含已删除模块。
- `DEVICE_PUBLIC_AVATAR_ONLY=1 node tests/device-standalone-electron.mjs` 使用旧本地配置复现后修复：
  确认默认公共形象、无本地选项/表单/IPC、游客切换与自有 Key 对话、重启加载失败及重试恢复。
- 只执行相关测试，没有构建安装包或部署。
