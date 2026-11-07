# Windows 待机表情轮换

## 目标与范围

参考 `control/android-native/lam-expression-common/.../AmbientMotion.java`
的 `choose/ambient/compose`，复用本仓库已有 `AIBANLVKeyframeFace.json`。
只移植待机面部轮换；头颈继续使用现有渲染、鼠标跟随和抚摸逻辑。
不增加模型、依赖、在线请求、设置开关或调试文字。

默认随机选择 neutral/warm/thinking/curious 且至少 60 帧的素材，
neutral/warm 权重 2，其余 1。记住最近最多 5 段，池较小时至少保留
一个候选，避免立即重复。随机裁取 2.8–5.2 秒，不足用完整片段，
按素材 fps 和经过时间插值。眉眼、脸颊、嘴角使用 0.44 倍力度，
保留素材眨眼，视线收敛；发音通道关闭。

跨片及退出说话/抚摸时，从实际已显示的表情用 550ms 平滑交接，
发音口型用 240ms 收尾。说话/抚摸优先且不改写它们的系数；鼠标跟随
只接管视线和头姿，待机面部仍轮换。隐藏暂停时钟，显示不追赶隐藏时间。
角色切换/解绑由 iframe 销毁清理；素材加载失败退回原眨眼表现。

## 实现与风格

`src/device-idle.mjs` 为纯播放器，`src/avatar.mjs` 仅在设备形象启用。
私有 HTTP 路由提供已有素材，清单包含播放器与素材；不执行打包。
ES modules、两空格、无分号，例：`const dt = Math.max(0, now - last)`。

## 验证和边界

在 `demos/web-desktop-pet`：
`node --test tests/device-idle.test.mjs`；根目录 `npm test`；
`$env:DEVICE_IDLE_ONLY='1'; npm run device:test`，并运行完整源码 Electron 回归。
测试选片、时间、过渡、口型关闭、交互优先级、资源白名单及真实渲染帧。
始终保留已有用户改动，不修改旧 control、vendor 或生成文件；
新增依赖/在线能力属于额外范围。用户明确要求构建前禁止构建 EXE/安装包。
