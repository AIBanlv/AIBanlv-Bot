# 桌面端邮箱注册

> 历史规格：2026-11-02 桌面邮箱注册随账号登录一起移除，注册与登录请在手机端完成后扫码。
> 现行入口见[扫码登录规格](qr-only-desktop-spec.md)；服务端其他客户端接口不受本次移除影响。

## 首次登录邀请码（2026-10-29）

桌面首次使用时，注册表单增加可选邀请码，最多 32 位、去除首尾空白；留空不影响注册。
复用现有 `website-auth/register` 的 `inviteCode` 参数，不修改后端，也不在账号密码登录、
二维码或验证码请求中携带邀请码。邀请奖励由服务端首次注册规则确认，不能在已有账户登录或绑定时补领。
邀请码不持久化、不进入日志或公共状态；表单失败可以保留草稿，断线或绑定后清空。

设备完成登录或扫码绑定后，仅在原 userData 保存 `invite-onboarding.json` 的完成布尔标记；
退出、重启和解绑不会重新显示邀请码。已有绑定证明/游客积分已认领记录会迁移为已完成。
同手机端一样复用匿名余额响应中的 `accountLoginCompleted` 恢复在线完成状态，不新增轮询。
主进程再次检查资格，拒绝将已完成设备的陈旧邀请码透传到注册请求。
完成标记只是显示偏好，不作为邀请资格或积分奖励的安全判定。

自动化使用本地注册、登录和余额夹具，不发送真实验证码、不注册正式账号、不领取真实邀请奖励。

状态：用户于 2026-10-23 明确注册范围与验收条件，按下述范围实施。

## 目标

在现有账号登录表单中增加注册入口和返回登录入口。提供邮箱、四位邮箱
验证码、6-50 位密码和确认密码；注册成功后继续现有账号登录和当前电脑
绑定流程，仍以设备通道收到的服务端绑定确认为授权完成依据。

验证码发送成功后开始 60 秒重发倒计时；失败可重试，切换登录入口不重置
倒计时。提交期间防止重入；切换入口、隐藏、刷新、断线、退出取消客户端
等待并忽略迟到响应。账号创建和服务端绑定不能由取消操作撤销。

## 已核实接口

### 验证码位数对齐（2026-10-23）

按现有服务端生成规则，邮箱验证码固定为四位 ASCII 数字；渲染层、
输入框及主进程统一校验，验证码始终作为字符串传递，保留 `0123` 的前导零。
输入提示为“四位邮箱验证码”；拒绝三位、五位、六位、非数字及数字类型输入。
服务端两分钟有效期和客户端 60 秒重发倒计时不变，Talkpage 配置不变。

验证：根目录 `npm test` 439/439 通过，无跳过；
`node demos/web-desktop-pet/tests/device-mail-brand-electron.mjs` 通过，
本地夹具确认真实输入表单提交 `0123`，品牌参数、发送失败/成功、倒计时、
注册拒绝/成功和后续登录均符合预期；320/768/1024/1440 布局与 axe 通过。
`git diff --check` 通过。未发送真实邮件、未部署、未构建安装包。

只读参考 `control/pages/login/register.vue` 和服务端
`WebsiteAuthController`、`WebsiteAuthServiceImpl`：

- `GET https://scrm.ieasysell.com/jwt/client/website-auth/send-email-code?email=...&mailBrand=aibanlv`
- `GET https://scrm.ieasysell.com/jwt/client/website-auth/register`，参数为
  `email`、`password`、`code`、`origin=app`、`type=website`、`mailBrand=aibanlv`。
- `/jwt/` 由线上 Nginx 剥离，使请求进入新版公开账号接口；原 `/client/`
  被转发至 legacy。此修改保留现有 Basic 认证，不要求用户登录令牌。
- 沿用现有 Basic 客户端认证，拒绝重定向，不发送会话 cookie。
- 验证码接受业务码 0/200；注册接受业务码 200 且存在对象数据。
  注册响应中 token、ticket 和跳转 URL 均丢弃。
- 服务端已创建账号但内部登录失败的固定消息也表示注册完成；之后仍尝试
  Windows 的 `passwordLogin`。后续登录或授权失败明确提示“注册成功”，
  可返回登录重试，不重新注册。

## 结构与风格

沿用 Electron 44.9.0、ES modules 和 Node 内置测试，不新增依赖。
`electron/device-registration.mjs` 负责主进程校验和有界请求；
`device-login.mjs` 复用现有单任务、取消、身份验证及绑定生命周期；
`device-login-view.mjs`、HTML/CSS 和窄 preload IPC 承载表单。
`tests/` 存放协议、视图及 Electron 本地夹具；本目录存放规格。

沿用单引号、camelCase、小函数和纯文本错误：

```js
if (!windows.fromController(event)) return { ok: false, code: 'FORBIDDEN' }
return login.register(value)
```

## 验证

从 `control-windows` 执行 `npm test`、`git diff --check`。
从 `demos/web-desktop-pet` 执行：

```powershell
node --test tests/device-registration.test.mjs tests/device-login.test.mjs tests/device-login-view.test.mjs tests/device-modules.test.mjs
npm run device:test
```

先写失败测试，覆盖接口参数、邮箱/验证码/两次密码校验、发送失败、60 秒
倒计时、重入、取消、迟到响应、注册后登录/绑定失败、已有绑定隔离、凭据
脱敏和 IPC 来源限制。Electron 验证真实表单、键盘提交、320/768/1024/1440
布局、axe、控制台及注册后默认形象。全部使用本地网络夹具。

## 边界

- 始终：主进程再次校验输入；请求 15 秒超时、响应上限 64 KiB；
  密码、验证码、token 仅在必要的临时内存中，不写盘、不进日志或公开状态。
- 另行授权：EXE/安装器构建、依赖变更、服务端协议或第三方登录。
- 禁止：修改 `control` 或服务端；调用真实验证码/注册接口进行测试；
  创建正式收费会话；覆盖已有绑定或其他任务文档。

计划与验收清单位于 `docs/account-registration/tasks/`，不覆盖根目录已有任务。

## 验证记录（2026-10-23）

- 实施前根目录 `npm test`：385/385 通过。
- 接口测试在模块未实现时失败；生命周期与视图新增测试先失败，再实现通过。
- 定向命令：35/35 通过；最终根目录 `npm test`：402/402 通过，
  无失败、取消或跳过。
- 根目录 `npm run test:device`：完整 Electron 本地夹具验收通过。
  新增注册覆盖发送拒绝/网络错误、60 秒倒计时与入口切换、重复请求、
  两次密码不一致、注册拒绝、取消与迟到响应、服务端内部登录失败、
  Windows 登录/绑定失败、成功绑定后默认 waner、已有绑定拒绝和凭据隔离。
- 登录与注册页 320/768/1024/1440 布局断言与 axe 检查通过，
  并人工查看注册页 320/1440 截图。原扫码、登录、形象、对话、麦克风、
  助手、邮箱、重启清理回归通过，控制台错误/警告及外部请求断言通过。
- 首次 Electron 检查发现旧登录布局测试把新增隐藏输入框视为可见元素，
  已改为检查有实际布局的元素；保留所有可见元素的边界与溢出断言。
- `git diff --check` 通过，仅有已有 Git 换行转换提示。
- 未修改 `control` 或服务端，未请求真实邮件/注册/收费会话，未构建 EXE
  或安装包；验收截图与本地配置不提交。
