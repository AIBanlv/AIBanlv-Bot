# 游客使用与无积分文字回复

> 历史规格：2026-11-02 桌面改为[仅扫码授权](qr-only-desktop-spec.md)，不再允许未绑定游客进入对话。
> 已绑定账号的零积分纯文字模式继续保留；旧游客记录仍加密读取并按原归属补传。
> 下文为旧游客功能的历史规则和验收，不代表现行桌面入口。

承接 2026-10-23 会话中已确认的实现范围：Windows 客户端复用
Control 服务端游客 800 积分与登录 claim；DeepSeek 使用用户配置的 Key。
用户随后明确授权修改 `live-broadcast-java-test` 的服务端扫码认领逻辑，
使扫码绑定也按 Windows 安装身份认领，并覆盖绑定后才完成结算的游客用量。

## 验收

- 未登录可加载、切换公共形象，使用现有 realtime 和服务端扣费协议。
- 首次认领把游客剩余积分加入租户余额；手机和电脑各一次，设备换绑和重复请求不会再次赠送。
  绑定后才结束的旧游客会话从原接收租户扣除，防止晚到结算重复赠送。已按旧规则认领的设备不追溯补赠。
  新注册默认套餐与月度补足资格见 [桌面优化与积分规则](desktop-optimization.md)。
- 服务端确认无积分后清空 realtime context，关闭预连接、重连与计费连接。
- 文字回复首先应用当前角色人设，并携带同角色近期历史；无语音、无口型、无积分扣除。
- 未配置 Key 时提示设置，不回退到收费链路。
- 游客对话在内存使用，并通过 Windows 系统加密在本机保存；重启恢复，绑定确认后补传。
- 内存补传缓存保留最近 80 条消息；文字上下文最多保留 20 个角色、各 40 条，
  每次请求仅发送当前角色最近 20 条。退出时等待已排队的加密写入，不保存音频或凭据。
- 隐藏、退出、角色/绑定切换取消旧工作，不把上一账号的对话带给其他账号。

## 实现顺序

公共形象访问与积分服务 → 对话路由与纯文字渲染 → 历史补传 → 集成回归。
保持绑定状态由控制服务确认，游客权限单独表示；不伪造绑定身份。
源码在 `demos/web-desktop-pet/electron`，测试在相邻 `tests`，沿用 ESM、
具名模块和依赖注入。外部服务使用本地夹具，不修改旧 Control。
服务端仅调整控制绑定和游客认领/晚到结算，复用既有积分流水，不部署生产服务。

## 验证命令

仓库根目录 `npm test`；`npm run test:device` 运行本地 Electron 夹具。
不构建 EXE 或安装包，不发起真实收费请求。凭据不落入日志、渲染进程或历史。

2026-10-23：`npm test` 423/423 通过；
`$env:DEVICE_INITIAL_ONLY='1'; npm run test:device` 通过，覆盖两轮纯文字、
人设与历史、零新增 realtime/计费、禁用麦克风、登录注册及游客/绑定切换。
证据在 `demos/web-desktop-pet/artifacts/device-electron/guest-text-results.json`
及 `initial-avatar-results.json`。服务端 15 项定向通过；精确 Maven 命令与
已复现的原有测试失败记在服务端 `docs/anonymous-digital-human-billing-spec.md`。
最终默认 `npm run test:device` 亦退出成功，完整覆盖登录注册、语音口型、
触摸、布局、电脑助手/桌面整理、邮件、解绑游客与重绑及退出清理；
完整证据在 `demos/web-desktop-pet/artifacts/device-electron/results.json`。
