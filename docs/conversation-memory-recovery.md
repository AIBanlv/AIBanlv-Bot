# Windows 重进后的对话记忆恢复

## 问题与修复

旧版将账号对话上报到数据库，但重启时既不读取这些消息，也不回放到模型。
Realtime 每次重连是新的上下文；传入 tenantId 并不等于读取历史。
DeepSeek 使用的 Map 和游客记录也随进程退出丢失。

已绑定设备通过现有控制连接发送 `device_history_request`，按服务端确认的
设备绑定、账号、租户与当前角色取得正序历史。服务端最多返回 20 条、总计
8000 字，每条最多 800 字。客户端等待历史读取成功后才创建首轮回复。
Realtime 使用 `conversation.item.create` 回放，等待全部 created 回执后就绪；
历史回放不发送 `response.create`，不朗读、不重复上报为新对话。
Realtime 回放最多 20 条、总计 8000 字，游客长回复每条最多回放 4000 字，避免超量上下文。
参考 [Qwen 官方客户端事件](https://www.alibabacloud.com/help/en/model-studio/fun-audiochat-client-events)：
user 使用 input_text，assistant 使用 output_text。

游客以 Windows safeStorage 加密保存近期文字和待补传消息，在相同应用数据目录
重启后恢复；不保存音频、API Key 或账号凭据。原子替换与串行写入保证最后快照
不被旧写入覆盖；损坏、系统加密不可用或写入失败会显示提示，不降级明文。
游客登录后依旧补传到原有历史协议，先把目标账号和租户写入加密待补传快照，
收到每条 `reply_saved` 后才从磁盘移除；重启后只向同一账号补传，不向其他
账号或游客暴露待确认内容。绑定身份变化会清除上一账号的内存上下文。
如果上一账号仍有待确认快照，新游客当前对话只在内存保留并显示存储提示，
避免覆盖原有未确认记录；重新连接原账号完成补传后可继续保存。

这是有界的近期对话上下文恢复，尚未增加无限期事实库或历史摘要；游客上限仍为
80 条待补传消息、20 个角色各 40 条上下文，DeepSeek 每次使用最近 20 条。
旧版本退出前未保存的游客对话无法事后恢复；已绑定账号原有数据库记录可读回。

## 验收与命令

- 本地夹具告知“我的狗叫 MAX，是金毛犬”，重建进程或存储实例后首次问题的
  模型输入仍含 MAX；同时覆盖已绑定服务端恢复、游客本机恢复。
- 历史加载超时、取消、换账号、换角色和越权响应不能触发空记忆生成或跨账号回放。
- `npm test`：仓库根目录完整 Node 测试。
- `npm run test:device`：本地 Electron 网络夹具，禁止正式收费请求。
- 在 `demos/web-desktop-pet` 执行 `node tests/device-memory-electron.mjs`：
  同一数据目录真实重启 5 次，验证游客 MAX 恢复、账号回放、未确认补传恢复、
  同账号稳定 ID 重试、异账号隔离，以及收到回执后才清除待补传快照。
- 服务端协议与测试见 `live-broadcast-java-test/docs/device-history-recovery.md`。

发布时需要同时更新 Windows 客户端与支持新历史读取协议的服务端；不自动部署或打包。

2026-10-23 验证：`npm test` 439/439 通过；服务端定向 25/25 通过；
上述真实重启专项和完整 `npm run test:device` 均退出成功，证据为
`artifacts/device-memory-electron/results.json` 和 `artifacts/device-electron/results.json`。
