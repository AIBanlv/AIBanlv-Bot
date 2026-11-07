# 邮箱注册验收清单

- [x] 主进程请求：正确接口和编码、输入校验、成功判断、有界响应、取消、
  错误脱敏。验证：`node --test tests/device-registration.test.mjs`。
  文件：device-registration.mjs、device-registration.test.mjs。依赖：无。
- [x] 注册后登录绑定：单任务、60 秒发送限制、重复提交、失败分阶段、
  迟到响应隔离、已有绑定不覆盖。验证：registration 与 login focused tests。
  文件：device-login.mjs、device-login.test.mjs。依赖：请求模块。
- [x] 表单与 IPC：邮箱/验证码/两次密码、状态与切换、倒计时、键盘、清除
  凭据、可信窗口限制；模块清单验证。验证：view 与 modules focused tests。
  文件：device-login-view.mjs、device.html、device.css、device-preload.cjs、
  device-main.mjs。清单独立修改 device-package.mjs。依赖：生命周期。
- [x] 本地验收：扩展现有 Electron 夹具，完成成功/失败、取消、四种宽度、
  axe、凭据隔离、扫码登录回归；完整 `npm test` 与 `git diff --check`。
  文件：device-registration-electron.mjs、device-electron.mjs、README.md、
  account-registration-spec.md。依赖：表单。
