# Harness 客户端与自有 Key

目标：数字人只保留一处 DeepSeek Key 配置。独立 Harness 桌面客户端正在运行且已登录时，
电脑助手优先复用账号认证；客户端未运行或未登录时，使用数字人内置 Harness 和用户自己的 Key。

## 行为与边界

- 客户端认证、手动 API Key、平台扫码身份独立；两条 DeepSeek 路径均不扣本平台积分。
- 每次新任务确认来源，在途任务来源变化时取消，不重放或静默转另一计费来源。
- 已完成结果上传失败时按原任务 ID 最多尝试 3 次（重试间隔 250/500 毫秒），不重新调用模型或执行电脑任务；取消、退出或来源变化时中止上传。持续失败则使桥接租约失效，释放等待请求。
- 参考 aibanlv-harness-plugin，通过安装在 Harness 内的连接插件调用公开宿主服务；不读取任何凭据文件。
- 登录态和模型认证始终留在 Harness；数字人通过带随机凭据的本机桥接发送任务并接收公开结果。
- 客户端关闭后即使保留登录文件也不使用其账号；退出登录、过期、无权限需明确提示。
- 模型配置保留唯一的可选 Key 输入和测试；Harness 页保留开关、当前来源、测试和日志。
- 已保存 Key 自动复用；清除自有 Key 不删除客户端登录。未检测到客户端登录且没有 Key 时提示两种入口。
- Realtime 仍独立使用自己的阿里云 Key 或明确选择的平台服务。Harness 登录、退出或掉线只取消受影响的 DeepSeek 对话和助手任务，不重置独立的 Realtime 对话上下文或连接。

## 结构与验证

Electron 主进程提供鉴权本机桥接；连接插件由宿主心跳报告在线及登录状态，并调用宿主 llm/agents。
客户端已登录时任务在该宿主创建独立会话；只读分类/聊天不调用电脑工具。客户端离线时内置受限 Harness 负责已支持工具。
沿用 ESM、固定依赖版本、超时及取消约定。Node 本地夹具覆盖运行/关闭、登录/退出、来源切换、
拒绝未知来源、无凭据与隐私边界；Electron 本地模型服务验证去重配置与自动识别。
只跑相关测试，不创建真实收费会话、不构建安装包、不声称 Mac 运行验证。

实现顺序：统一 Key 入口 → 客户端鉴权心跳 → 宿主推理与任务 → 验证退出/费用边界。
验收命令：Demo 内 `node --test tests/device-harness-client.test.mjs tests/device-model-settings.test.mjs`，
配套的 Harness runtime / Electron 本地夹具；根目录 `npm test` 为完整测试入口。

官方依据：
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/credentials/credentials-local
- https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/llm/llm-deepseek-account

## 本轮实现验证

- Demo 内 `node --test tests/device-harness-client.test.mjs tests/device-model-settings.test.mjs tests/device-text-conversation.test.mjs tests/device-assistant-service.test.mjs`：33 项通过。
- PowerShell 设置 `$env:DEVICE_HARNESS_CLIENT_ONLY='1'` 后运行 `node tests/device-standalone-electron.mjs`：统一 Key 入口、账号聊天/测试/电脑任务、客户端优先、退出后新调用使用自有 Key、暂停、四种宽度和 axe 均通过。
- Electron 使用真实界面与本机鉴权 HTTP 桥接，Host 的模型和 agent 为夹具；未发起真实供应商调用，未构建安装包。
- [连接插件及安装步骤](demos/web-desktop-pet/harness-client-plugin/README.md)随源码和分发目录提供；本机已通过 Harness 桌面版自带 CLI 安装，真实账号模型联调尚未执行。

## 审查修复验证（2026-11-03）

- Demo 内 `node --test tests/device-harness-delivery.test.mjs tests/device-harness-client.test.mjs`：13 项通过。上传失败和退出取消用例在修复前失败；回归覆盖临时上传失败、确认丢失、持续失败释放请求、退出取消上传，以及模型/电脑任务均只执行一次。
- `DEVICE_HARNESS_CLIENT_ONLY=1` 下运行 `node tests/device-standalone-electron.mjs`：修复前在 Harness 登录时中断在途语音；修复后显式 Realtime 和自动选中 Realtime 的四组登录/退出场景均保留原连接和轮次并完成回复。
- 根目录 `npm test`：710/711；唯一失败为 `device-qr-only.test.mjs:42`，父提交已复现，不属于此次修复。未跳过或修改该测试，未构建安装包，未调用真实模型或生产数据库。
