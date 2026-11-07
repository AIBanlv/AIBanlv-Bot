# model-source

目标（2026-11-03 用户修订）：费用来源由角色来源决定。所有线上角色（含默认婉儿、公共角色及其本机缓存）走现有平台计费；仅本地主进程创建并明确标记的本地角色使用自有额度。自有 Key 不上传平台。
命令：根目录 `npm test`；Demo 内 `node --test tests/device-model-settings.test.mjs`。
结构：electron/device-model-settings.mjs 管理 Realtime 凭据与来源；DeepSeek 复用
AssistantSettings；renderer 仅接收脱敏快照，通过 controller-only IPC 配置。
风格：ESM、两空格、无分号；`{ ok: false, code: 'KEY_REQUIRED' }` 返回脱敏错误。
测试：Node 测试真实加密存储边界和来源矩阵，Electron 本地夹具检查表单和隔离。
边界：固定 HTTPS/WSS 供应商域名，输入有界；不得改 JWT、上传 Key、自动收费降级。
验收：线上角色必须扫码且满足现有积分规则，已有 Key、Harness 登录或历史来源设置均不能绕开；未绑定、离线、积分不足时提示对应原因，不自动用自有额度。本地角色首选自有 Realtime，其次 DeepSeek（用户确认保留 Harness 账号优先、未登录时使用 Key）；未配置则提示 Key，不回退平台。未知角色不能发起对话，线上输入不能声明自己是本地角色。
DeepSeek 与 Realtime 各自可清除；勾选记住后使用 safeStorage 加密，完整 Key 不回显。

设备绑定页包含“扫码登录 / Key 配置”分页，保持表单草稿和键盘操作；移除左侧独立模型配置页及手动费用来源选择，按当前角色显示来源与费用说明。Harness 的配置跳转打开 Key 分页，绑定状态更新不切走当前分页。进入扫码分页获取二维码，Key 分页保存不自动连接平台。
Realtime 默认模型 `qwen-audio-3.0-realtime-flash`，音色 `longanlingxi`；旧版默认组合 `qwen3.8-omni-flash-realtime / Tina` 加载时迁移，其他自定义组合及更新后主动保存的选择保留。
移除“连接账号和手机”开关及说明卡片；保留设备绑定页自动连接与二维码刷新，即使旧版连接开关保存为关闭也能恢复。费用仍由角色来源决定，平台连接不会使本地角色记录上传。
本轮不增加本地角色导入/编辑界面，不修改服务端计费算法，不构建安装包。角色来源与存储边界用本地夹具验证。
