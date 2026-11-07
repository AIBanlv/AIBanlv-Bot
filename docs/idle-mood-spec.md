# 空闲情绪与鼠标事件表情

## 背景

桌宠在没有对话时是静止的中性表情。希望在没有交互的情况下，数字人也能根据本机
鼠标和窗口事件做出更丰富的表情，并且自动匹配项目现有的动作标签库触发动作，
不引入任何大模型调用或联网行为。

参考项目：

- **Mochi**（`mochi-llm-pet`）：已经实现鼠标来回抚摸、点击、拖拽等行为识别，
  并把交互结果反馈到宠物的情绪和亲密度。本项目只借鉴它的**本地手势判断逻辑**，
  不引入它的大模型部分。
- **Glitch**：内部情绪状态机，含好奇、烦躁、困倦等情绪变量，连续点击会改变情绪
  状态，行为系统与 AI 模型解耦。本项目借鉴这套**变量加阈值的状态机**。

## 目标与已确认范围

- 空闲行为完全本地判断：不调用大模型、不发起云端请求、不新增依赖。
- 复用 `src/text-motion.mjs` 已有的动作标签库（头部、表情、视线、景深），
  不另写一套 blendshape。
- 回复语音、控制框动作预览、正在抚摸、鼠标穿透、隐藏、形象未加载时一律让位。

## 情绪变量（Glitch 风格）

| 变量 | 含义 | 主要来源 |
| --- | --- | --- |
| `curiosity` | 好奇 | 轻点、双击、划动、鼠标进入、窗口获得焦点 |
| `irritation` | 烦躁 | 连续快速点击（1.4s 内第三次起额外加压）、划动 |
| `drowsiness` | 困倦 | 长时间无事件、窗口失焦；按秒缓慢累积 |
| `intimacy` | 亲密度 | 抚摸、长按；衰减极慢 |

情绪由阈值与优先级决定：`annoyed`（烦躁 ≥ .45）→ `sleepy`（困倦 ≥ .55）→
`affectionate`（亲密度 ≥ .55）→ `curious`（好奇 ≥ .5）→ `calm`。
每秒按 `moodDrift` 回落，长时间沉默最终会进入 `sleepy`。

## 本地手势判断（Mochi 风格）

- **按下时的手势**沿用 `device-touch-policy.mjs` 的 `classifyTouch`：
  TAP / DOUBLE_TAP / LONG_PRESS / 方向滑动 / GENTLE_STROKE。
  `device-touch.mjs` 通过新的 `onGesture` 回传，**不受 4 秒回复节流影响**。
- **未按下时**由 `classifyHover` 判断：路径 ≥ 56px、方向反转 ≥ 2 次、速度 ≤ 900px/s
  记为抚摸（来回抚摸）；快速单向划过记为 FLICK；更小的移动只是悬停。
  识别到抚摸后重置窗口，持续抚摸可持续获得反馈。
- 鼠标停在人物偏左或偏右时，空闲动作优先选择 `look_left` / `look_right`。

## 全屏鼠标跟随（窗口外同样生效）

桌宠窗口只有 300×547 左右，鼠标绝大多数时间在它外面，渲染进程收不到 DOM 事件，
因此由**主进程采样系统光标**：

- 复用已有的 50 ms 鼠标穿透定时器（`updateMouse()`），不新增定时器。
- 新增 `publishPointer()`：把光标换算成相对窗口中心的**归一化方向**（±1）、
  **像素距离**、是否在窗口内、以及 `powerMonitor.getSystemIdleTime()`，
  通过 `pet:pointer` 发给桌宠。**只传方向与距离，不传绝对屏幕坐标。**
- preload 暴露 `desktopPet.onPointer`，`device-pet.mjs` 转给 `mood.point()`。
- 渲染端用阻尼跟随（每帧向目标插值 0.22），输出头部 pitch/yaw 与眼球偏移；
  目标静止后**不再写帧**，不做无谓的持续刷新。
- 距离阈值：从 ≥320 px 进入 320 px 以内记一次 `approach`（抬头看你），
  从 ≤760 px 越过 760 px 记一次 `retreat`（不再反应）。
- 系统空闲按 15 s / 60 s / 5 min 分成三档（`idleLevel`），升高记 `idle`、
  回落记 `focus`，长时间离开会真的困，回来立刻清醒。
- 手势优先：一旦播放动作就停止跟随，动作结束再恢复。

## 动作匹配
`moodActions` 与 `reactionActions` 全部使用现有标签书写，例如
`{ head: 'shake', emotion: 'angry', gaze: 'none', depth: 'back' }`；
`isValidMoodAction()` 用 `motionTags` 校验，确保空闲动作不会用到库外标签。
`moodMotion()` 生成 `sampleTextAction()` 可直接消费的动作对象，
时长 2.2-3.4s（犯困时更长），播完回到 `neutralExpression()`。

## 结构与代码约定

- `electron/device-mood-policy.mjs`：纯逻辑，无 DOM，便于 Node 测试。
- `electron/device-mood.mjs`：DOM 导演，负责事件、节拍与播放。
- 沿用 ES modules、单引号、camelCase，以及现有 `neutralExpression()` 协议。
- 新模块同时登记到 `device-main.mjs` 的 `/device/` 路由与
  `device-package.mjs` 的打包清单。

## 优先级

`canPlay()` 为真才播放：窗口可见、形象已加载、未鼠标穿透、不在回复
（`chat.busy`）、不在动作预览（`previewActive`）、触控未激活（`touch.active()`）。
被抢占时动作立即停止并回到中性，待触发的手势记录下来，恢复后再播。

## 验证

- `tests/device-mood.test.mjs`：变量边界与漂移、连续点击升级、抚摸与亲密度、
  困倦与唤醒、预设标签全部落在标签库内、手势分类、全屏距离阈值与空闲分档、
  动作可被采样器消费、桌宠接线、带 DOM 桩的播放/让位/跟随集成测试。
- `tests/device-modules.test.mjs`：新模块必须被私有站点与安装包收录。
- 真实 Electron + CDP 抽查：输入卡片为透明灰白渐变，气泡区
  `scrollbar-color: rgba(255,255,255,.3) transparent`，`drag-surface` 上出现
  `data-mood`，页面无控制台错误；移动真实光标到窗口上方 620 px 时
  `data-gaze` 为 `-0.00,-1.00`（抬头），到窗口左侧 700 px 时 `-1.00,0.00`
  （向左看），移到窗口上则让位给"注意到你"的反应动作。

未验证：正式服务语音链路与安装包构建（本机缺少形象压缩包与 LAM 运行环境）。
