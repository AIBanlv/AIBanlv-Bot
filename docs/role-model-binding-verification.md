# 设备绑定 Key 分页与角色来源验收（2026-11-03）

本轮按用户要求将模型配置合并至设备绑定页，分为扫码登录和 Key 配置。线上角色（包括公共角色及其缓存）沿用平台积分；本地角色使用自有模型额度。本地 DeepSeek 保留 Harness 登录账号优先，未登录时使用 Key。Realtime 新配置默认 `qwen-audio-3.0-realtime-flash` / `longanlingxi`，既有显式配置保留。

本地角色导入/编辑入口属于后续功能。本轮通过仅存在于测试主进程中的本地角色验证路由、存储、通知和撤权边界，未把线上角色标记成本地角色。没有改动 Java 服务端或制作安装包。

## 验证结果

- 仓库根目录 `npm test`：719/720 通过。唯一失败为已有 `tests/device-qr-only.test.mjs:42`，旧游客夹具预期不加载默认形象，实际加载一次；本轮之前已在 `92fc052a` 父版本复现。未跳过或削弱该测试。
- Demo 目录 `node tests/device-standalone-electron.mjs`：本地文字/Realtime、扫码、断线、重启、Key 不回显、平台提醒入口拒绝本地角色、记录不补传及角色不上报通过。
- 同一 Electron 脚本在下表各模式分别运行通过。PowerShell 在独立进程中设置 `$env:模式名='1'` 后执行上述命令，不同时设置多种模式。
- `git diff --check` 通过。没有新增依赖。测试只使用本机模型服务、控制服务及推理夹具，没有使用生产收费会话。

| 模式 | 验证内容 |
| --- | --- |
| `DEVICE_ROLE_BILLING_ONLY` | 线上角色扫码/积分门槛、平台临时会话、计费 WebSocket 和历史同步；平台失败不回退自有 Key |
| `DEVICE_HARNESS_CLIENT_ONLY` | Harness 账号优先、未登录时 Key 回退、电脑任务、登录变化不打断 Realtime |
| `DEVICE_MODEL_PAGE_ONLY` | 可扫码二维码、扫码/Key 分页、键盘切换、未保存草稿、默认值和来源说明 |
| `DEVICE_MODEL_TEST_ONLY` | 两种模型按表单草稿测试、留空复用凭据、测试不保存或清空输入 |
| `DEVICE_PUBLIC_AVATAR_ONLY` | 未登录可显示/切换公共形象、失败重试、自有 Key 不能绕开线上角色绑定 |
| `DEVICE_REVIEW_ONLY` | 留空 Key 取消记住仍保留进程内凭据、进行中回复在清除历史后不回写 |

设备绑定 Key 页与 Harness 页验证 320/768/1024/1440 宽度无横向溢出，axe 检查无违规。页面截图保存于 Demo 的 `artifacts/standalone-electron/`，作为本地验证产物不提交。

独立只读复核验证：迟到和排队中的本地任务结果不会进入线上通知推理；线上/本地角色互相切换时，在下载及渲染阶段发生换绑/解绑，无论先撤权或先收到账号状态，16 个场景均保留合法本地角色并清除旧私有资源。

Electron 输出已有 EventEmitter 监听数提示；没有屏蔽该提示，运行结果与页面错误检查正常。Mac 原生运行和真实供应商连通性未在本轮验证。

## 旧默认值迁移补充（2026-11-03）

截图中的 `qwen3.8-omni-flash-realtime / Tina` 来自旧版已保存配置；新安装的默认值原本已正确。
加载旧配置时仅迁移这组默认值，保留 Key、地域、业务空间和其他偏好；其他自定义组合保留。
新保存的配置带迁移版本标记，用户主动选回旧组合后重启也不会被覆盖。

- `node --test tests/device-model-settings.test.mjs tests/device-model-control.test.mjs`：9/9 通过；新增迁移用例已先确认修复前失败。
- 根目录 `npm test`：721/722 通过，唯一失败仍为上述旧游客测试。
- Demo 目录同时设置 `$env:DEVICE_MODEL_PAGE_ONLY='1'`、`$env:DEVICE_MODEL_LEGACY_DEFAULTS='1'`，执行 `node tests/device-standalone-electron.mjs`：通过。夹具先写入截图中的旧默认组合，再验证页面显示新模型/音色及原有分页、草稿、四种宽度和 axe 检查。
- 已查看生成的 `artifacts/standalone-electron/model-settings.png`，确认表单显示 `qwen-audio-3.0-realtime-flash / longanlingxi`。

## 移除平台连接开关（2026-11-03）

删除设备绑定页的“连接账号和手机”开关、说明卡片及开关事件处理；保留扫码自动连接、刷新二维码及解除绑定。
Electron 页面夹具预先保存 `platformEnabled: false`，验证启动后自动恢复连接，页面没有开关，二维码可解码；模拟连接暂停后刷新可以恢复，Key 草稿保留。

- 根目录 `npm test`：721/722 通过，唯一失败仍为已有旧游客测试。
- Demo 内设置 `DEVICE_MODEL_PAGE_ONLY=1` 和 `DEVICE_MODEL_LEGACY_DEFAULTS=1` 后运行 `node tests/device-standalone-electron.mjs`：通过，含四种宽度和 axe 检查。复核了移除卡片后的 `binding-only.png`。
- 页面测试曾因当前停留在邀请记录页而等待隐藏的二维码超时；夹具现在先确认自动连接状态，再显式进入设备绑定分页进行界面断言。
