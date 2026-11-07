# 角色来源、自有 Key 与平台服务

用户于 2026-11-02 确认实施聊天中的九项拆分。账号密码登录保持移除。

2026-11-03 用户调整现有模块：线上角色按平台规则计费，本地角色使用自己的供应商额度且不上传；模型配置并入设备绑定的 Key 分页。继续复用下列模块与依赖关系，本轮任务记录在 `tasks/role-model-binding/`，不覆盖旧计划。本地角色导入入口后续实现。

| 模块 | 任务 | 依赖 | 规格 |
| --- | --- | --- | --- |
| model-source | 1 来源规则、2 Key 配置 | 无 | SPEC-model-source.md |
| standalone-runtime | 3 公共形象、4 DeepSeek、5 自有 Realtime、6 平台链路 | model-source | SPEC-standalone-runtime.md |
| conversation-storage | 7 本地记录、8 扫码补传、9 组合验收 | standalone-runtime | SPEC-conversation-storage.md |

顺序：model-source → standalone-runtime → conversation-storage。任务和证据保存在
tasks/standalone-desktop/，不覆盖旧账号登录计划。无新增依赖、服务端鉴权放宽或打包。
