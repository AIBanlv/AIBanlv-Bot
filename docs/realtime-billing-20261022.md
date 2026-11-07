# Realtime 积分（2026-10-22）

本文保留当时的实现与验证记录。当前桌面会话已改用服务端中继，用量由服务端接收并结算，现行接口见 [DEVICE-SPEC](../demos/web-desktop-pet/electron/DEVICE-SPEC.md)。

设备版 `DeviceRealtime` 对打字、麦克风和触碰回复都请求 `text + audio`，因此打字输入仍产生语音，全部按现有语音价格计费；静音播放不代表没有生成音频。

当时的 `device-session.mjs` 会话请求固定 `provider: qwen-realtime, outputMode: audio`。`device-realtime.mjs` 在每次完成的 response 用量中一并报告输出 PCM 字节，保留 responseId 去重、取消后的延迟 Token 上报及会话结算。

语音保持 `ceil(tokens / 1000) * 10`。只有新接口 text 模式且全会话无输出音频时，后端才将上述费用除以 3 向下取整。此修改不把现有设备回复改成纯文字；离线文字动画演示也不接入在线计费。

发布顺序：全部后端实例先升级，再发布此客户端，避免旧实例忽略新票据模式。未构建 EXE/安装包，也未部署。

验证：仓库根目录 `npm test`，326 项全部通过，无跳过，使用本地 fixture。

## 合并后复核（2026-10-22）

拉取远端 `778226d` 后发现会话创建仍使用旧路径且缺少 `outputMode`，
与保留的计费测试不一致。当时已恢复对应会话入口和 `audio` 参数，同时保留
远端新增的绑定租户传递及角色会话记忆逻辑。

修复前定向会话测试复现路径断言失败；修复后登录、会话与实时模块
`node --test tests/device-session.test.mjs tests/device-realtime.test.mjs tests/device-login.test.mjs tests/device-login-view.test.mjs`
78/78 通过。仓库根目录 `npm test`：385/385 通过，无失败、无跳过。
