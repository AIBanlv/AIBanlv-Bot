# 数字人下方粒子效果

状态：用户已于 2026-10-19 确认并补充手机参考图、保持人物尺寸及输入框透明要求；已实现并完成本地验收。

## 目标与验收标准

在 Windows 设备版透明数字人窗口中接入原 Control 数字人下半部的粒子显示方式，用户可自行开关。

- 在控制台“悬浮窗口”设置区增加“下方粒子效果”开关，支持鼠标及键盘操作。
- 开启后显示原效果的柔光粒子，由两侧向人物下方中心汇聚；采用原默认粉色配色，背景保持透明。
- 根据用户手机参考图修正：粒子从人物实际可见的底缘自然接出，向下收拢，与底部轮廓近似相切；不能隔开成独立横带，也不能覆盖脸或衣服。基于当前人物透明度采样定位底缘，粒子层放在人物层后方。
- 按用户追加要求，开启粒子不得缩小人物。粒子延伸到现有对话区域，位于工具栏、气泡后方，结束于输入区域上方；不增加窗口尺寸，不改变拖动及鼠标穿透命中区域。
- 输入框、输入区域外层和状态提示条的背景透明，保留边框、文字及发送按钮。
- 关闭立即清除粒子并停止动画；隐藏人物、未绑定、形象未就绪或页面不可见时不运行动画。
- 重新开启后恢复效果；遵循系统减少动态效果设置，避免持续动画。
- 建议默认关闭，保持独立项目现有启动显示；将用户选择保存到本机，重启恢复。
- 切换形象或重新加载人物时保持开关选择，不重复注册动画和事件监听。

## 技术栈与源码

沿用 Electron 44.9.0、原生 ES modules、Canvas 2D 和 Node 内置测试，不增加依赖。

- 参考源：`../../control/android-native/renderer/tools/ali-native-shell-ui/src/immersive-background.js`。
- 原效果依赖语音光球定位；桌面版采用人物显示区域下方中心作为汇聚锚点，不引入语音光球及原页面全屏背景。
- 以明确的源码快照方式移入本仓库，保留来源说明；运行及打包不得依赖旧 Control 仓库。
- `demos/web-desktop-pet/src/`：粒子绘制与生命周期。
- `demos/web-desktop-pet/src/avatar.mjs`：仅设备版启用粒子时，在完成实际绘制后以 96×96 像素、最多每秒四次采样底缘；仅传输归一化轮廓，不传输人物图像。
- `demos/web-desktop-pet/electron/device.html`、`device-view.mjs`：设置开关及状态同步。
- `demos/web-desktop-pet/electron/device-pet.html`、`device-pet.mjs`、`device.css`：透明效果层及人物状态联动。
- `demos/web-desktop-pet/electron/device-windows.mjs`、`device-main.mjs`：经过来源和布尔值校验的设置命令、本机偏好读写及资源路由。
- `demos/web-desktop-pet/tests/`：行为测试与现有 Electron 验收扩展。

## 代码风格

沿用单引号、camelCase、小函数及已有窄 IPC 命令；偏好文件仅包含显示设置，不保存绑定凭据或人物数据。

```javascript
if (name === 'particles' && control && typeof value === 'boolean') {
  this.state.particles = value
  this.publish()
}
```

## 验证命令与策略

从 `F:/zhanlvAndroidSdk/control-windows` 执行完整回归：

```powershell
npm test
```

从 `F:/zhanlvAndroidSdk/control-windows/demos/web-desktop-pet` 执行：

```powershell
node --test tests/device-particles.test.mjs
npm run device:test
```

先补充失败测试，再实现开关、偏好恢复及动画启停。使用现有本地网络夹具验证真实 Electron 的即时切换、像素显示、透明背景、隐藏恢复、形象切换、窗口尺寸与键盘操作。若本机验收依赖缺失，明确记录缺失项，不声称通过。

## 边界

- 始终：保留已有用户修改，只在本仓库接入效果，执行 Node 回归及可运行的 Electron 验收。
- 先确认：本规格、默认开关选择；若实现需要新增依赖或扩大到其他版本，另行说明。
- 禁止：修改旧 Control 仓库、修改第三方构建产物、创建收费生产会话、提交凭据或模型。

## 审阅事项

确认按以上范围实施，默认关闭，开关位于控制台“悬浮窗口”设置区，并记住用户选择。

## 实施清单

按依赖顺序推进，不覆盖 Demo 中保留的历史计划：

- [x] 粒子绘制及启停生命周期，先验证默认无动画、关闭清空、隐藏暂停、减少动态效果及释放资源。
- [x] 接入控制台开关、经校验的 IPC、本机偏好恢复和打包资源，验证保存与非法配置回退。
- [x] 扩展本地夹具 Electron 验收，运行完整 Node 回归，记录实际验证结果。

## 验证记录（2026-10-19）

- 根目录 `npm test`：132 项全部通过。
- Demo 目录 `node --test tests/device-particles.test.mjs`：5 项全部通过，包含不平整底缘、静态效果延迟收到轮廓、动画启停和本机偏好恢复。
- Demo 目录 `npm run device:test`：真实 Electron 本地夹具验收通过，验证底缘衔接、开启前后人物高度一致、输入区域三层背景透明、开关即时生效、隐藏/解绑清空、形象切换、减少动态效果、重启恢复、拖动与鼠标穿透、四档控制台宽度及三档人物尺寸、WCAG AA、无控制台错误/警告和无外部 HTTP 请求。
- `git -c core.safecrlf=false diff --check`：通过。
- 截图和 JSON 报告位于忽略的 `demos/web-desktop-pet/artifacts/device-electron/`；未创建收费生产会话，未构建安装包。
