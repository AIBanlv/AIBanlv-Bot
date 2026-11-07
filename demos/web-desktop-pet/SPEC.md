# 网页桌面宠物 Demo 规格

状态：第一版、语音表情、Control 后处理和自定义标签静音预览已实现，
并完成本地浏览器验收。

## 目标与假设

在普通网页上展示 control 数字人，呈现可拖动的桌面宠物效果。
面向当前集成效果评估，不修改正式业务入口或发布线上版本。

已确认的第一版范围：

- 使用 control 的真实数字人形象和可运行的 Web 渲染路径。
- 人物背景透明，不显示整个聊天页面或矩形背景。
- 鼠标或触摸拖动人物浮层，字幕随人物移动。
- 拖动不误触发点击，人物及字幕保持在可见窗口内。
- 提供收起、恢复、位置重置和字幕显示开关。
- 使用明确标记为演示的预设台词验证字幕布局及切换。
- 不自动开启麦克风，不创建付费会话，不声称已完成实时语音联调。

“拖动头像”暂按移动网页上的整个数字人浮层理解，不是改变模型头部姿态。
本功能只在当前网页内悬浮，不创建操作系统级桌面窗口。

## 已核实的代码

- `pages/new_ui/avatar_chat/index.vue`：H5 使用 iframe 加载数字人；
  APP-PLUS 使用原生插件，原生 AAR 不能直接作为网页组件运行。
- `utils/digitalHumanSession.js`：`buildDigitalHumanWebUrl` 构造 Web 入口，
  当前传递 `hideUI=1`。
- 参考项目 `F:/zhanlvwork/live-broadcast-vue3/src/utils/digital-human-embed.js`
  使用宿主浮层、iframe 和 postMessage；拖动代码目前被注释。
- 参考项目 `src/views/live-human/LiveHumanEmbed.vue` 有透明嵌入布局。
- `static/openavatar/` 为当前未跟踪的构建资产，不作为本次修改源码。

## 技术方向

采用独立宿主 Demo 和独立人物视图的边界；宿主管位置、收起与字幕，
人物视图复用现有 Web 渲染能力。不复制参考项目的订单、访客统计、
购物车或 PageAgent 功能。

先核实人物视图的可维护源码、透明画布和模型资源，再实现浮层。
只设置 iframe 的透明 CSS 不算透明渲染完成。
跨域 iframe 不能通过读取其 DOM 获取字幕，真实字幕后续需由源页面
发送消息；本次不得虚构现有协议已支持字幕。

## 项目结构

- 所属项目：`F:/zhanlvAndroidSdk/control`。
- `demos/web-desktop-pet/`：规格、页面、样式、宿主交互与演示台词。
- `demos/web-desktop-pet/tasks/`：独立实施计划，不覆盖根目录已有任务。
- `demos/web-desktop-pet/tests/`：Node 内置测试与浏览器验收脚本。
- 复用 `android-native/renderer/tools/ali-native-shell-ui/node_modules/`
  内现有的 `gaussian-splat-renderer-for-lam@0.0.8`，不修改其 bundle。

## 命令

工作目录均为 `F:/zhanlvAndroidSdk/control/demos/web-desktop-pet`：

```powershell
npm test
npm start
```

使用 Node HTTP 服务，只监听 127.0.0.1；端口被占用时自动换用空闲端口。
不依赖编译步骤，不修改 H5 共用源码。

## 代码风格

沿用 control 的 JavaScript、小函数和 Node assert 测试方式。
字幕通过 textContent 或框架文本绑定渲染，不将消息作为 HTML 插入。

```javascript
function clampPosition(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
```

不增加全局状态框架；新增依赖需要先确认。
若需跨窗口消息，必须校验 source、origin 和消息字段，并限定 targetOrigin。

## 测试策略与成功标准

1. 先写失败测试，再实现位置约束、点击与拖动区分和字幕状态切换。
2. 在真实浏览器检查 320、768、1024、1440 像素宽度，确认无内容溢出。
3. 截图及画布像素检查确认真实人物非空白、背景透明、动画正常。
4. 验证拖动、触摸、窗口缩放、滚动、收起恢复和键盘操作。
5. 长字幕自动换行，靠近边缘仍可见，空白区域不大面积阻挡网页操作。
6. 资源失败应显示错误和重试入口，不无限等待或静默展示替代人物。
7. 浏览器控制台、资源请求及现有相关测试通过，并记录实际执行结果。
8. 交付可访问的本地地址或可直接打开的 HTML，以及明确的演示功能边界。

## 边界

- 始终：保留用户已有修改；只修改 Demo 及必要的可维护渲染源码。
- 先确认：第一版范围、新依赖、跨项目源码变更、真实对话和计费联调。
- 禁止：修改原生计费、提交凭据或大模型、修改生成资产、自动发布。

## 模型选择

第一版不加载 ONNX，也不转换模型：

- 形象：默认读取已有 `android-framework-new/photo/benny-avatar.zip`，
  内含 `oac/skin.glb`、`animation.glb`、`offset.ply`、`vertex_order.json`。
  可用 `PET_AVATAR_ZIP` 指向另一份兼容形象 ZIP。
- 推理：`LAM_audio2exp_streaming.tar` 是 PyTorch checkpoint，
  现有 `engines/infer.py` 用 `torch.load` 和 `load_state_dict` 加载，
  并非当前浏览器渲染器可直接加载的形象包。
- 后续原始权重路线：本地或服务端 PyTorch 读取原始 TAR，输出表情系数给网页。
  这是后续独立任务，本次不安装 PyTorch、不加载 checkpoint。
- 待机动作来自形象资源与演示表情系数；字幕为演示文本，不宣称语音口型同步。

## 语音扩展（2026-10-17）

用户追加要求：开口说话，观察口型与表情。继续保持独立 Demo 边界。
本节取代上面“本次不加载 checkpoint”的第一版限制。

- 使用本机 Microsoft David 离线英文语音，配分句中文字幕翻译。
- 准备脚本用原始 TAR / PyTorch CPU 推理生成 30 fps、52 维表情，
  浏览器播放预计算结果，不使用 ONNX，不宣称实时推理或自由文本 TTS。
- 音频 currentTime 为唯一时间轴，暂停、结束、隐藏、收起时停止发声并复位口型。
- 自然 / 微笑 / 惊讶 / 专注为手动表情预设，与原始模型结果明确区分。
- 保留原先的纯字幕演示，两个播放源互斥；资源错误可重试。
- 新文件：scripts/prepare-speech.ps1、scripts/infer_speech.py、
  src/expression.mjs、src/speech.mjs；生成资源位于忽略的 assets/。
- 验收：时间轴插值与非法数据单测，实际 TAR 输出，真实浏览器音频时间推进、
  播放生命周期、口型系数变化、画布截图、移动端与无障碍回归。
- 命令：`powershell -NoProfile -File scripts/prepare-speech.ps1`、
  `npm test`、`node tests/browser.mjs`。

## Control 后处理扩展（2026-10-17）

用户要求加入 control 表情后处理。复用默认 `ios-v1` 播放侧链路，
不叠加已被该链路绕过的 legacy `LamExpressionSmoother` / JNI。

- 直接编译、调用现有纯 Java `AudioClockExpressionTimeline` 和共享
  `IosExpressionProcessor`、`MouthMotionFilter`，读取正式捕捉动作库。
  不复制或改写业务算法，不修改原始 TAR 和 Control 正式源码。
- 对已有原始语音帧按 30 fps、每批 30 帧预计算四个表情及正常结束后的收尾，
  记录原始 JSON / 动作库 / 源码 SHA-256；生成文件仍忽略。
- 浏览器默认启用“Control 后处理”，可关闭对比原始 TAR。
  播放中切换保留音频时间；暂停/停止立即静音并清除说话口型。
- 复用正式 `installThreePresentationPose`，按名字映射通道，
  避免模型顺序与渲染顺序混淆、重复眨眼和 rig 放大。
- 后处理只覆盖固定语音与正常结束收尾；待机/暂停的菜单预览保持原有 Demo。
  表情切换使用预生成轨道，不声称已接入实时语义/远程动作/麦克风反应。
- 验证：原始 Java 数值一致性、顺序/哈希校验、A/B 切换、生命周期、姿态实际
  应用、截图与画布像素、桌面/移动回归、资源失败不得静默退回 raw。
- 命令：`node scripts/prepare-control.mjs`、`npm test`、
  `node tests/control-browser.mjs`，原有语音准备命令末尾自动生成后处理。

## 自定义台词静音预览

- 新增独立台词编辑区，输入最多 160 字（含标签），生成、暂停、继续、停止。
  一次一段，标签作用于整段；同类标签重复或不支持时拒绝，不隐式忽略。
- 直接调用 Control `ExpressionBehavior` 解析规范标签；Demo 仅提供
  `[摇头]` / `[点头]` / `[微笑]` 等中文别名以及标签剥离。
- 使用已安装的 eSpeak NG 普通话同步回调获取 PCM，不访问音频输出设备，
  再经原始 TAR 和 Control 时间轴生成面部/姿态。不是正式音色效果评估。
- `POST /api/previews` 接受 `{ "text": "..." }`，返回版本化 clip、bank、behavior；
  不返回音频或路径。只允许同源 application/json，409 表示已有生成任务，
  400/413/415 为输入错误，503 为依赖错误，504 为超时。正文上限 4 KiB。
- 单并发、120 秒超时；断开请求终止子进程。临时输入与 WAV 仅在随机任务目录，
  完成/失败/取消后清理，不记录台词。进程使用固定命令参数，无 shell。
- 浏览器使用 performance 时钟，不调用任何音频播放接口；暂停/停止/收起/
  隐藏/编辑/切换播放源均复位口型，过期生成结果不得恢复播放。
- 验收：标签单测、真实中文 PCM/原始 TAR 输出、API 输入与来源校验、
  静音端到端嘴型/摇头、取消与错误状态、桌面移动端像素/截图及旧功能回归。
