# 桌面数字人麦克风输入

状态：用户已确认直接语音对话，已实现并完成本地验收（2026-10-19）。
2026-10-22 增补：全双工。下方"回复时暂停收音、不增加抢话打断"已被取代，
见文末《全双工打断修订》。

## 目标与假设

在设备版悬浮人物的透明文字输入框旁增加麦克风图标按钮，与文字输入及发送按钮同时显示。建议采用直接语音对话：点击开启，用户说完后数字人自动回复；再次点击关闭。

用户已选择直接语音对话；识别出的文字进入对话气泡，不写入或覆盖文字输入框。

## 验收标准（建议的直接语音对话）

- 默认关闭，不记忆开启状态，不在启动、重启或恢复绑定时自动打开麦克风。
- 麦克风按钮与文字框、发送按钮共同存在，保留透明背景，不改变人物尺寸及粒子布局。
- 使用真实麦克风图标；通过图标形态、颜色、按钮提示及文字状态共同区分关闭、授权/连接中、正在收音、检测到说话、回复期间暂停收音、错误。按钮具有动态名称、`aria-pressed`、键盘操作和焦点样式，不能仅靠颜色表达状态。
- 点击开启后才请求录音权限；权限和设备准备就绪才显示“正在收音”。授权拒绝、无可用设备、设备拔出、网络/会话错误均显示明确提示并可重试，失败后停止占用麦克风。
- 使用本机说话/停顿检测判断一句话结束，然后通过现有 Realtime 手动提交协议自动触发回复；仅上传完整的一句语音，不连续上传空闲环境声音。单句最长 20 秒，过短声音不提交。识别出的用户文字进入“我”的气泡。语音不得覆盖或清空用户已有文字草稿。
- 数字人回复时暂停向服务端发送麦克风音频，回复播放结束后恢复，避免将扬声器回复当作用户输入。（2026-10-22 起改为全双工，见文末）
- 文字与语音共用当前角色、音色、会话及计费链路；文字发送与语音提交互斥，发送文字时清理未提交的语音片段，保留连续对话上下文。
- 再次点击立即停止采集并释放音轨。隐藏人物、切换形象、解绑、离线、页面关闭、用户停止或语音链路错误时清理缓冲和过期回调，状态准确回到关闭；恢复后需要用户重新打开。
- 只允许当前设备人物主页面申请音频权限，不开放摄像头、控制台、人物 iframe 或其他来源的权限。
- 录音与临时音频缓冲仅存在内存，不写入日志或文件；服务端凭据仍由主进程持有。数据帧、速率、队列、单次发言及空闲时长均设上限。

## 已核实的实现与技术方向

- `electron/device-realtime.mjs` 目前只发送文本，`turn_detection` 为 `null`；需扩展音频输入与用户转写事件，不能只放一个无实际功能的按钮。
- `electron/device-main.mjs` 当前拒绝全部媒体权限，`electron/text-server.mjs` 也通过 Permissions-Policy 禁止麦克风；需仅对设备人物主页面精确开放音频权限。
- 参考原 Control 的 `QwenRealtimeClient.java` / `QwenRealtimeProtocol.java` 中音频追加、输入转写及会话配置，采用明确源码参考，不修改旧仓库。
- 官方协议支持通过 `input_audio_buffer.append` 发送 16 kHz 单声道 PCM16 音频，再手动 `commit` / `response.create`。桌面沿用现有单回合模式，本机检测停顿自动提交，避免为了常驻录音重写已验证的单回合/计费状态机。来源：<https://www.alibabacloud.com/help/zh/model-studio/realtime>。
- 沿用 Electron 44.9.0、ES modules、Web Audio、现有 Realtime / LAM / billing，不新增云服务、认证方式或依赖。具体录音节点及 PCM 格式在实现前核对当前官方规范。

## 相关目录与代码风格

- `demos/web-desktop-pet/electron/device-pet.html`、`device.css`：麦克风按钮及视觉状态。
- 同目录新增录音模块；`device-chat.mjs` / `device-pet.mjs`：录音、回复播放及人物生命周期协调。
- `device-preload.cjs`、`device-main.mjs`、`device-realtime.mjs`：窄 IPC、权限校验、音频传输和会话事件。
- `text-server.mjs`、`device-package.mjs`：限定页面媒体策略及打包资源。
- `tests/`：Node 行为测试与本地 Electron 夹具。

使用单引号、camelCase、小函数和明确的状态转换，沿用现有主进程授权边界。

```javascript
button.setAttribute('aria-pressed', String(enabled))
button.setAttribute('aria-label', enabled ? '关闭麦克风' : '开启麦克风')
```

## 测试策略与命令

先写失败测试，覆盖音频格式/边界、权限来源、重复点击、授权期间取消、设备断开、识别关联、语音与文字互斥、回复期间暂停、停止后的迟到事件及释放音轨。

完整 Node 回归，从 `F:/zhanlvAndroidSdk/control-windows` 执行：

```powershell
npm test
```

真实 Electron 验收，从 `F:/zhanlvAndroidSdk/control-windows/demos/web-desktop-pet` 执行：

```powershell
npm run device:test
```

自动化使用合成麦克风音频和本地协议夹具，不监听用户真实环境、不创建收费生产会话。验证图标及文字状态、实际 PCM 输入、自动回合、文本草稿保留、暂停恢复、权限拒绝、窗口/角色清理、240/300/380 人物尺寸和 WCAG AA；明确区分夹具通过与实际硬件/云端测试。

## 实施顺序与边界

1. 定义并测试音频输入和单回合状态机，再接入现有受控会话。
2. 增加受限麦克风权限、录音生命周期及按钮，保持原输入布局。
3. 扩展本地夹具并完成 Node、Electron、透明背景与人物尺寸回归。

- 始终：保留当前粒子功能及已有修改，使用现有音色、计费和凭据边界。
- 已确认：直接语音对话及此规格；新增依赖或外部服务需要重新说明。
- 禁止：修改旧 Control、放开全部媒体权限、自动开启麦克风、记录原始音频或凭据、运行收费生产自动测试。

## 验证记录

- 根目录 `npm test`：143 项全部通过，包括原有粒子、文本对话、实时计费和口型回归，以及新增麦克风权限、语音回合、草稿保留、短噪声过滤、20 秒上限、取消/迟到回调、录音暂停和识别失败提示。
- Demo 目录 `node --test tests/device-microphone.test.mjs tests/device-media-policy.test.mjs`：7 项通过。
- Demo 目录 `node --test tests/device-realtime.test.mjs`：12 项通过。
- Demo 目录 `npm run device:test`：通过。真实 Electron 使用 Chromium 模拟麦克风与本地 WAV、AudioWorklet 及本地 provider/billing 夹具，验证实际 PCM 采集及上传、停顿自动提交、识别文字气泡、回复期间暂停与结束后恢复、草稿保留、显式开关及隐藏关闭、页面媒体策略与越权 IPC 拒绝；原有三档人物尺寸、四档控制台宽度、键鼠操作、透明输入和粒子、WCAG AA 回归通过，无控制台错误/警告或外部 HTTP 请求。
- `git -c core.safecrlf=false diff --check`：通过。
- 截图：`demos/web-desktop-pet/artifacts/device-electron/microphone-on.png`；报告：同目录 `results.json`。均为忽略的本地验收产物。
- 未使用真实环境麦克风或正式云端会话，因此未声称完成真实硬件/线上识别准确率验收。未构建安装包，未新增依赖。

## 输入卡片改版补充记录（2026-10-20）

- 用户确认取消原工具栏和对话框开关：输入卡片默认常驻且不能收起；角色名称在卡片左下角，麦克风与发送按钮在右下角。
- 麦克风开启时，文本框位置改为随采集帧 RMS 跳动的本地能量波形；波形只做电平显示，不新增录制、上传或持久化，关闭麦克风、隐藏人物、切换角色和解绑时清空电平。
- 布局由“人物 + 56px 工具栏 + 气泡 + 112px 输入”改为“人物 + 气泡 + 112px 输入”，`devicePetSize` 与命中区域同步使用新的底部边界。
- 安装包默认注册当前用户开机自启动（HKCU Run），完成页默认勾选立即打开，卸载删除该值。之前“对话框开关”记录作废。

## 全双工打断修订（2026-10-22）

用户要求语音可以打断数字人，不再半双工。改动如下：

- 数字人说话期间麦克风继续收音；只有提交这一句时短暂静音，提交成功立刻恢复。
- 打断的门槛高于静默时的开门门槛：说话期间要求瞬时能量达到静默阈值的三倍
  （0.015 → 0.045），且累计有效发声满 0.5 秒（静默时 0.25 秒）才成句。
  这样扬声器里数字人自己的声音，以及回声消除残留，不会把自己打断。
- 成句即打断：本地先停播（`DeviceAudio.stop()`），再经 `device:chat-interrupt`
  让主进程 `DeviceRealtime.interrupt()` 发送 `response.cancel` 并计一次
  `interrupted`；会话连接保留，下一句直接复用，不重新建链、不重复计费握手。
- 服务端还没产生输出就打断时不计 `interrupted`；已经产生输出的按
  `interrupted` 收尾，与 `output_completed` 互斥，避免重复计费。
  打断后迟到的音频与文字不再投递；LAM 收到 `interrupted` 与 `stopped`
  同样释放推理。
- 文字发送仍是"停止回复"，不打断。
- 触摸也触发打断（2026-10-22 修订）：`installTouchInteraction` 新增 `onEngage`，
  在 `start()` 首帧先调用 `chat.interrupt()`，再走原本的触碰提交；人物区域的
  `canInteract` 不再因"正在回复"而失效。手放上去和开口说话同级，都高于角色正在说的话。
- 打断只取消服务端仍在生成的回复：`response.done` 之后再发 `response.cancel`
  会被服务端报错，所以 `interrupt()` 仅在 `turn.requested && !turn.done` 时发送。
- 打断带来的服务端取消回执不会误伤会话：`accept()` 里 `error` 只在存在当前回合且
  `response_id` 与之匹配（或无 id）时才判失败，否则忽略。这是"打断后提示连接失败、
  对话断开"的直接原因——取消回执被当成了致命错误，把还在用的连接拆了。
- 会话复用键包含绑定身份：`syncConversation()` 的键由 `agentId:renderId` 改为
  `agentId:renderId:owner:tenantId`。记忆归属"租户 + 角色"，换绑到另一个账号时
  必须重建会话，不能继续沿用上一个租户的上下文。
