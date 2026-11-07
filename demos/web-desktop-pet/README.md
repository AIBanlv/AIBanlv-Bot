# Control 网页桌面宠物 Demo

## Electron 设备端

桌面允许未登录用户显示公共形象；线上角色对话沿用平台积分。设备绑定页提供扫码与 Key 配置分页，后续本地角色使用自有额度且记录不上传平台。
扫码后可同步线上角色会话、使用手机功能，并按平台规则进行线上角色对话。私有云接口继续鉴权。
独立使用、费用来源和历史迁移见[独立运行说明](../../docs/standalone-desktop-guide.md)。

新增截图/文件手机直传与远程指令截图回执，需后端与手机同步更新；旧绑定需在手机解绑后
重新扫码以获取安全配对凭据。双方保持在线、单文件最多 8 MiB，不使用服务器中转。
详见[协议、安全边界与插件评估](../../docs/direct-transfer-and-plugins-spec.md)。

当前产品名称为 **AIBanlv**，内部标题为“桌面伴侣”，使用 Control 的彩色 AI Logo。
设置页已移除“文字与动作”调试区，保留正常聊天、Harness 等插件和窗口设置。
Harness 已内置，已支持的电脑操作启动后默认授权，无需逐次弹窗确认；
目标校验、只读邮箱、取消任务及绑定身份校验仍保留。当前绑定手机的任务与本机文字/语音
统一经 Harness 调度，提醒和触碰不能使用工具。具体能力与限制见根目录 README。
启动完成绑定后，本地口型引擎与形象加载并行预热，人物就绪后预连接对话服务；
首条消息复用连接和引擎，提前发送时等待同一次初始化；
隐藏、解绑或切换角色时取消旧连接，断线后有限重试。预连接不会自动发送消息或录音。
设置页不再展示形象同步成功提示和完整线上音色 ID。
只有用户明确要求构建时才生成 EXE 或安装包，日常验证使用源码测试。
打包输出 `AIBanlv.exe`，安装快捷方式也使用 AIBanlv；旧设备数据目录继续复用。

设备入口保留独立控制框和透明桌宠窗口。启动后在控制框显示正式服务
下发的扫码绑定二维码。协议身份仍是设备，不会以本地标记绕过绑定。
原网页、语音桌面版、文字便携版保持原入口，不会被替换。

```powershell
cd F:\zhanlvAndroidSdk\control\demos\web-desktop-pet
npm run device
```

首次安装使用 `npm ci --ignore-scripts`，再执行
`node node_modules/electron/install.js` 安装锁定版本的 Electron。
这是源码启动方式，依赖本工作区已有的渲染器、图标和骨骼适配器。
发给同事请使用下文的设备端安装包，不需要复制工作区。

### Windows 设备端安装包

面向 Windows 10/11 x64 的内部测试包：
`dist/ControlDevice-0.1.2-win-x64-Setup.exe`。安装后从桌面或开始菜单
打开 **Control Device**。控制框显示绑定二维码，使用 Control App 扫码并选择形象。
安装包自带 Electron、Python、原始 LAM 模型和 Java/Control 后处理，
同事不需要安装 Node、Python、Java 或准备模型。

```powershell
npm run device:package
npm run device:installer
```

打包仍需要本工作区现有的模型、Python 依赖及 JDK；工具脚本校验固定版本
的可再分发 Python、Temurin JRE 和 NSIS 下载。可用 `DEVICE_PYTHON_STAGE`、
`DEVICE_JAVA_HOME`、`MAKENSIS` 指定已准备好的打包资源。
包内保留第三方许可证，不包含本机设备标识、会话凭证或私有形象缓存。

按当前用户安装，不要求管理员，不修改 PATH 或注册系统服务。安装默认写入当前用户
开机自启动（HKCU Run），完成页默认勾选立即打开；卸载会删除自启动项。
这是未签名测试包；请核对同目录 `.sha256` 校验文件并遵守单位安装政策。
卸载保留 `%APPDATA%\Control Device` 中的设备标识。回退可卸载此版后
重新使用原入口，不涉及服务端迁移。联网对话可能计费，请使用获准的测试账号。
同事使用说明随包安装为 `Readme.txt`；构建及验证约定见
`electron/DISTRIBUTION-SPEC.md`。

2026-10-19 的 0.1.1 内测包已完成真实安装、安装版 Electron/LAM 和卸载验收，
包大小 677.9 MiB，安装文件约 1.33 GiB。校验文件与安装包同目录。
自动化使用本地云服务夹具；真实手机扫码、线上音色和账号计费仍需实测。

0.1.2 为透明桌宠增加任务栏入口，并在重新显示时恢复最小化窗口。
OBS 的“窗口捕获”应选择 **Control - 桌面数字人**，不是“Control - 设备控制台”。
捕获期间保持桌宠显示且不最小化；可以把控制框隐藏到托盘。
仍是原来的透明桌宠窗口，没有新增重复人物或修改人物下方的聊天布局。
测试检查 Windows 窗口可见性、捕获筛选条件及任务栏注册；
OBS 实际捕获画面和透明通道效果仍需在目标机器验证。

0.1.1 修复设备端表情与连续对话：原始回复交给手机端同一套
`ExpressionBehavior` 后处理，气泡仍隐藏标签；连续回复保留动作时间线，
说话和空闲之间平滑交接头部姿态，不再主动回到固定的初始帧。
回退可退出新版并运行保留的 0.1.0 程序；设备标识位置不变，无需重建绑定。

### 绑定与对话

1. 在 Control App 的设备页扫码绑定电脑上的二维码。
2. 在 App 的设备详情选择角色，桌面接收 `switch_avatar` /
   `apply_agent_config`，下载并显示对应 ZIP 形象。
3. 人物真正渲染成功后才回报 `applied`，同时应用这条消息中的 `voiceId`。
   下载或渲染失败保留原角色，支持重试。
4. 控制框会直接查询当前绑定账号、租户的线上形象，支持选择自己的私有形象、
   租户共享形象及公共形象，无需手机先下发；列表旁可刷新。
   手机下发仍兼容，最近成功接收的最多 12 个配置也可切换。
   查询错误、空列表和加载状态会明确显示；不允许选择其他用户的私有形象。
5. App 解绑后清除形象、角色和临时资源，恢复扫码界面。重连及重启后的绑定
   状态以服务端为准；同一安装保留设备 ID，不需要每次重新绑定。

控制框提供线上形象、音量、停止回复、助手及窗口设置。
数字人使用无边框透明窗口，支持鼠标及方向键拖动。
关闭控制框会隐藏到托盘，从桌宠输入卡片或托盘可重新打开；“退出”关闭整个程序。
鼠标穿透只影响人物区域，底部输入卡片保持可点击。

**数字人下方的输入卡片已接入 Control 现有 Realtime 会话。**
卡片默认常驻，原独立工具栏已取消且不能收起；拖拽把手、设置（齿轮）、
隐藏按钮与显示尺寸滑块（300-440 px，默认 360）在左下角依次排列，麦克风与发送按钮在右下角。
输入卡片只保留一行输入框（整卡 92 px 高），四个角都是圆角；人物区域整体加宽，
画布宽高比从 2.41 降到 1.82，人物左右不再被挤到裁掉。
卡片不再显示角色名称，实时信息记录中的回复标签使用该角色的昵称。人物贴住输入卡片显示，
实时信息状态条浮在人物下部，不再单独占用一行；原独立气泡与字幕框已取消。
支持 Enter 提交、Shift+Enter 换行，中文输入法确认候选词不会误发。
绑定并加载形象后才可输入。用户文字、语音识别文字与流式回复显示在人物下方、输入框上方的实时信息中，
长回复可滚动；生成时发送按钮变为停止按钮。失败会提示原因并保留未发送草稿。
数字人可见回复会过滤 `[]` 及括号内文本，包含嵌套和流式未闭合标签；
例如 `[微笑]你好` 只显示“你好”。用户消息、原始回复及音频保持不变。
切换角色或解绑会清空对话与草稿，文本不落盘。空闲会话结束时保留未发送草稿。
输入卡片是透明灰白浮层：文字、占位提示、状态与图标使用灰白配色并带轻阴影，
不再遮挡人物与下方粒子。人物画布覆盖整个桌宠窗口，卡片上沿不会裁剪人物下缘。
双方对话与插件进度共用科幻半透明记录区，数字人的标签使用角色昵称，我的标签为“我”。
最新一句在实时信息状态条中显示；鼠标悬浮或键盘聚焦时展开完整记录，平时不挡人物与粒子。
控制框的“文字与动作”仍是本地动作预览，不是对话回复。

**没有对话时，数字人会根据本机鼠标与窗口事件自己做表情。**
这套空闲行为完全在本地判断，不调用任何大模型，也不联网：维护好奇、烦躁、
困倦和亲密度四个内部变量，鼠标移到人物上、来回抚摸、轻点、连续点击、拖动划过、
窗口失焦或长时间无人操作都会改变它们，情绪再自动匹配现有的动作标签库
（头部、表情、视线、景深）播放一段动作。连续三次快速点击会让它烦躁地摇头，
长时间无人理会会慢慢犯困并把视线放低，抚摸会提升亲密度并给出更温暖的回应，
鼠标停在人物偏左或偏右时，它会朝那一侧轻轻看一眼。普通空闲动作之间随机间隔 5-11 秒。
**鼠标长时间不动也会自己换表情**：光标停住 8 秒后就不再盯着那个方向，视线改为每隔几秒
随机飘向别处（左看、右看、抬头、歪头、点头、放空），动作间隔随之缩短到约 1.4-4 秒，
实测大约每 5-6 秒换一个表情，加上呼吸微动和眨眼，脸不会定住。
**犯困只在整台机器没人用时才会累积**：鼠标停着但你在打字、用别的软件，它保持清醒；
只有系统空闲超过 15 秒且光标不动，困倦才开始上涨，之后动作放慢、视线放低，你一动立刻清醒。
动作不再一格一格地跳：一个常驻的驱动循环持续拥有表情，所有权重和姿态都是缓动过去的
（约 30 fps 写入、0.14 s 时间常数），动作开始、结束、鼠标跟随接管都只是目标值变化，
不会突然回到中性帧，也不会在动作之间被渲染器自己的待机动画顶掉；空闲时还有极缓的呼吸
微动和自然眨眼，所以脸不会僵住。
**表情用的是本地真实表情库**：`android-native/.../AIBANLVKeyframeFace.json`
里的 78 段（13 种情绪 × 6 段、30 fps、61 通道）截取片段现在会接到桌宠上——
启动时缩成一份约 850 KB、20 fps、52 通道的表情库，动作按情绪挑一段真实片段播放，
每次随机从片段中间开始，所以同一个情绪不会每次都是同一帧；语气层面的头部、视线、
景深仍由原来的动作标签层负责。没有库文件、库读不出来或还没下载完时，自动退回
原来那套程序化合成的表情，功能不受影响。
**跟随覆盖整个屏幕**：主进程每 50 ms 采样一次系统光标，只把方向、距离和系统空闲
时间推给桌宠（不传绝对坐标），所以鼠标在人物区域外、甚至开启鼠标穿透时，数字人
也会用眼睛和头部跟着你；靠近到 320 px 以内会"注意到你"抬头看一眼，走远到 760 px
以外不再反应。系统空闲按 15 s / 60 s / 5 min 分档，越久越困，你一回来立刻清醒。
回复语音、控制框动作预览、正在抚摸、鼠标穿透、隐藏或形象未加载时完全让位，
不会和对话口型抢表情。

点击卡片右下角的麦克风可切换直接语音对话，再次点击关闭；回复期间暂停收音，
已有文字草稿保留。开启后文本框位置改为随音频能量跳动的本地波形：
36 根 2px 细条、3px 间距、最高不超过 18px 并居中显示，颜色随能量由深绿渐变到浅绿；
波形只做电平显示，不保存或上传额外音频。麦克风默认关闭，隐藏人物、
切换角色及解绑会释放音轨，恢复后需重新点击开启。

主进程通过 `/jwt/client/desktop/metered-realtime/sessions`，携带设备 JWT 和完整设备 ID 的 SHA-256
申请绑定设备的中继会话，选择 `qwen-realtime` 和当前角色的 `voiceId`。
游客使用 `/jwt/client/desktop-public/guest/sessions`；两种会话均只返回短期中继票据，不下发供应商 Key。
绑定且形象渲染成功后即预先建立并保持这条会话连接，发送消息直接复用，
不必每次重新申请；只有语音回复仍按每次发声准备本机 LAM。
切换角色、解绑、离线或会话到期会关闭连接，并在恢复后按最长 30 秒的退避重连；
空闲不再自动断开。**是否在线用输入卡片左下角的一个圆点表示**：绿点＝会话已连接且形象可用，
红点＝未绑定、正在连接、断开重连或形象未就绪；鼠标悬停或读屏会听到“在线 / 离线”，
旁边的状态行只在出问题时才出现文字，不会再一直挂着“对话已连接”。
状态的判断不会开始或打断任何回复。
主进程使用中继票据连接服务端 Realtime 中继，用量由服务端接收并结算。
服务返回的 24 kHz PCM 由桌宠实际播放，控制框可调音量或停止回复。
**无论文字还是语音消息，回复都会朗读出声并驱动口型**：文字回合同样请求
`['text','audio']`，只是输入方式不同，不再出现"只有文字没有声音"。
切换角色、解绑、隐藏桌宠及网络/计费连接异常会停止旧回复。
原动作预览与线上语音互斥，不会争用人物表情。

音色沿用 Control 的双模型配对规则。App 下发 CosyVoice 或数据库 ID 时，
主进程只读查询绑定租户及公共音色目录，按同一租户、同名且唯一的配对
找到 Realtime 版本，再用对应 ID 创建会话；控制框和角色配置保留原始 ID。
原生 `qwen-audio-3.0-realtime-flash` 音色直接使用。没有唯一配对时提示在
App 检查双模型音色配置；查询失败可重试，不会偷偷换成系统音色。
这是选择已有配对音色，不是自动克隆或把 CosyVoice ID 前缀改成 Realtime。
所有允许的目录读取后才判断配对；ID 重复或同名配对不唯一时不会自动选取。
会话凭证只在主进程内存中使用，不落盘，不下发到页面，不读取其他工程密钥。
用户发送的文字会交由现有线上服务处理，可能按原有账号规则计费；
不要发送不希望交由线上服务处理的敏感内容。麦克风默认关闭，
仅在你点击按钮后采集并提交，临时音频只存在内存中。

计费事件按顺序等待 ACK，provider token 用量按 response ID 去重。
ACK 是协议接收确认，不是扣费收据。断线会停止会话，不自动重发用户消息
或恢复收费会话；进程崩溃/断网后的未确认事件没有新增持久化补偿机制。
当前本地后端源码仅对匿名会话做余额前置校验，绑定设备会话没有同等检查；
正式上线前应在后端补充权威余额校验。本次未改后端规则，也未验证生产部署。
只读音色查询的既有后端还需补充调用者归属鉴权；本版限制查询范围为绑定
租户与已知公共租户，但客户端检查不能替代服务端授权。
设备端嘴型现已使用原始 LAM TAR 推理，不再按音量控制张嘴。
以下旧 Demo 的离线发声说明不适用于设备端。

### 实时 LAM 嘴型

```text
Realtime 原始 24 kHz PCM
  -> 本机常驻 PyTorch / 原始 LAM_audio2exp_streaming.tar
  -> Control AudioClockExpressionTimeline / 嘴型滤波与姿态
  -> 原始声音 + 52 通道表情按 Web Audio 播放时钟同步
```

每秒音频推理一块，并保留前文窗口；不足一秒的末块只在推理时补零，
播放内容和时长不增加。使用已有 TorchAudio 带限重采样到 16 kHz，
LAM 输入 34133 采样点、identity 0，保留最后 30 帧。Control 后处理
跨块保留状态，正常结束播放原有收尾。音量只影响声音，不影响嘴型。

首次文字对话先准备模型，再创建线上会话；本机实测约 4.4-5.2 秒，
预热后每秒音频的推理加后处理约 134-210 毫秒。另有最多约一秒的
分块等待，不是无延迟推理。正常对话间复用模型；停止、切换形象、
解绑或退出会终止旧工作进程，下次对话重新加载，避免串用旧音频。
模型或依赖不可用时明确报错，不会偷偷退回振幅嘴型。缓存模型进程
已经退出时，下次对话会在提交线上请求前报错；再次发送会重新加载。

源码启动时优先读取项目根目录的 `runtime.local.json`（与 `package.json` 同级，
已被 `.gitignore` 的 `*.local.*` 覆盖）；文件中未设置的键才使用环境变量或默认值。
入口位于 `electron/`，所以配置按包根目录解析，而不是 Electron 的入口目录。
该文件只用于开发，安装版直接使用内置运行环境，不会读取下列开发路径
或在运行时调用编译器：

- `PET_PYTHON`：默认工作区 `.venv-lam-coreml/Scripts/python.exe`，
  含 PyTorch、TorchAudio、NumPy、Transformers 与现有 LAM 依赖。
- `PET_LAM_SOURCE`：默认工作区
  `LAM_Audio2Expression-main/LAM_Audio2Expression-main`，须含原始 TAR。
- `JAVA`、`JAVAC`、`GSON_JAR`：同下文 Control 后处理工具链。
  Java 适配器编译到忽略目录 `artifacts/device-lam-java/`。
- Python / Java 以隐藏后台进程运行，音频、表情通过有界管道传输，
  不写入临时 WAV、不向页面暴露模型或本地路径。

真实模型检查：`node tests/device-lam-inference.mjs`。
独立 Python 检查：`node tests/device-lam-python.mjs`。
`npm run device:test` 使用本地 Realtime 服务夹具，但 LAM 推理、
Control 后处理、声音播放和人物渲染都是真实执行的。

配置及边界：

- `PET_CONTROL_WS_URL`：默认 `wss://scrm.ieasysell.com/ws/control`；
  远程必须使用 WSS，仅回环测试服务可使用 WS。
- `PET_DEVICE_USER_DATA`：可选独立设备配置目录；默认
  `%APPDATA%\Control Device`。只持久化随机设备 ID，绑定码不写磁盘。
- 形象只接受 `qn.ieasysell.com`、`zhanlvgpt.ieasysell.com`、
  `scrm.ieasysell.com` 的 HTTPS 下载；拒绝重定向和本机路径。
  ZIP 最大 64 MiB，展开上限 512 MiB / 256 个条目，不解压到文件系统。
- WebSocket 和文件操作在主进程，页面启用 sandbox / context isolation。
  内部 HTTP 仅监听回环地址，需要进程级令牌，不是可直接访问的网页入口。
- 本版不主动发起对话或自动更新；麦克风需手动开启，默认关闭且不记忆状态。
- Realtime 和计费地址固定沿用正式服务；`PET_CONTROL_WS_URL` 只覆盖
  绑定通道，不改变会话地址。自动化在隔离进程内替换网络，不提供发布版测试后门。

验证：`npm test`、`npm run device:test`。
后者需要下文已有的 Playwright / axe，以及安装在临时目录的 QR 解码工具：

```powershell
npm install --prefix F:/zhanlvAndroidSdk/.codex_tmp/device-qa --no-save --package-lock=false --ignore-scripts jsqr@1.4.0 pngjs@7.0.0
node tests/device-handshake.mjs
```

握手检查会向正式服务申请临时未绑定二维码，但不扫码、不创建账号；
二维码内容不输出到日志。Electron 自动化使用本机 WebSocket 夹具和真实
Benny 形象资源，验证 QR 解码、绑定、切换、音色 ID、失败保留、解绑、
320/768/1024/1440 控制框布局、300/360/440 桌宠尺寸、动画像素和无障碍。
另验证输入框位置、输入法、草稿保留、原文字动作、窗口设置、隐藏恢复、
双窗口退出和跨窗口 IPC 门禁，以及 Realtime 引导、计费、流式气泡、真实
PCM 播放时钟、音量、停止和角色音色切换。自动化不创建收费会话、不消耗账号额度。
A/B 使用同一真实模型的两个角色配置；这些测试不能替代不同客户模型、
手机实扫、正式会话路由部署及账号线上发声联调。
截图及报告位于忽略目录 `artifacts/device-electron/`。

## 独立文字动作桌面版

新增不含语音及嘴型推理的 Windows x64 便携版，Electron、人物、渲染器、
图标和动作模块全部内置。完整复制程序文件夹后双击 `ControlTextPet.exe`；
运行时不需要安装 Node、Python、Java，不读取 TAR/ONNX 或本机模型目录。
实际验收的程序目录记录在 `dist/text-portable.json`，使用说明位于程序目录内。

输入 `[点头][微笑]好的，我记住了。`，点击“显示文字并执行”。
支持摇头、点头、微笑、惊讶、思考、抬头/低头、左右看和自然表情，
以及暂停、继续、停止、字幕、拖动、置顶、隐藏、尺寸和鼠标穿透。
标签作用于整段，同类限一个；无标签仅有有限关键词规则，没有大模型理解。
这版使用本地程序动画和现有骨骼接口，不依赖 Java 后处理或音频时间轴。

构建：`node electron/text-package.mjs`。
验收：`node tests/text-electron.mjs`、`npm test`。
测试会将程序复制到新路径、禁用外部环境路径，再验证真实人物与动作。
加载形象仍有启动耗时，运行时仍有 GPU 和图形内存开销。
此前的网页及语音桌面版保留，以下章节继续描述原版。

独立实验目录，不接入 Control 正式页面、不调用对话或计费接口。
当前默认展示工作区已有的 Benny 三维形象，支持透明悬浮、鼠标/触摸拖动、
尺寸调整、收起恢复、字幕开关、语音口型播放和手动表情预设。

**自定义台词入口是顶部“台词与动作”**。可以输入
`[摇头][微笑]你好，很高兴见到你。`，点击“静音预览”。
这会重新生成当前台词的真实口型和 Control 动作，不播放声音。

点击“开口说话”播放约 13 秒的离线英文男声，字幕为中文翻译。
表情菜单可切换自然、微笑、惊讶、专注。纯字幕台词仍可独立编辑，
底部“演示台词 / 纯字幕”不会生成口型。
“Control 后处理”默认开启；播放中可切换，对比同一音频的原始与处理后效果。

## 启动

在此目录运行，要求 Node.js 18+：

```powershell
cd F:\zhanlvAndroidSdk\control\demos\web-desktop-pet
npm start
```

默认地址为 `http://127.0.0.1:5178/`。端口被占用时自动使用空闲端口，
以控制台打印的地址为准。使用 `Ctrl+C` 停止自行启动的服务。

页面不需要构建步骤。本机无需安装新依赖，复用以下现有本地依赖；
自定义预览还需要下文的 Python 和 Java 环境：

- `control/android-native/renderer/tools/ali-native-shell-ui/node_modules/`
  中的 `gaussian-splat-renderer-for-lam@0.0.8`，内部使用 Three.js。
- `control/node_modules/@dcloudio/uni-ui/` 中的图标字体。
- 默认形象：`android-framework-new/photo/benny-avatar.zip`，约 8.5 MiB。

若依赖未安装，请在对应项目目录按其 lockfile 执行 `npm ci`。
启动时会检查上述文件。缺失时明确报错，不自动下载人物或使用替代图片。

## 自定义台词静音预览

一次输入一段台词，最多 160 字（含标签）。点击“静音预览”生成后自动播放；
再次点击可暂停/继续，停止按钮也可以取消生成。文本未修改时重播复用
当前页面内的结果；编辑后重新生成。没有浏览器 TTS、音频播放器或麦克风参与。

可直接输入 Control 原有格式，或使用 Demo 的中文别名：

| 输入 | Control 行为 |
| --- | --- |
| `[摇头]` / `[摇摇头]` / `[H:shake]` / `[head-shake]` | 摇头 |
| `[点头]` / `[点点头]` / `[H:nod]` | 点头 |
| `[微笑]` / `[开心]` / `[E:happy]` | 开心表情 |
| `[惊讶]` / `[E:surprised]` | 惊讶表情 |
| `[抬头]` / `[低头]` | look_up / look_down |
| `[向左看]` / `[向右看]` | look_left / look_right |
| `[G:left]` / `[eye-left]` | 视线向左 |
| `[depth:forward]` / `[depth:back]` | 前靠 / 后退 |
| `[H:none]` | 不指定头部动作 |

支持 `【H：shake】` 等全角形式。规范标签由现有
`ExpressionBehavior.fromText()` / `inferMissing()` 解释；
Demo 只负责中文别名、验证和剥离。没有标签时保留 Control 自身的语义推断。

**第一版标签作用于整段，而不是文字出现处的逐词时间点。**
同类标签只能出现一次，未知、未闭合、重复标签及没有正文的输入会报错。
标签不进入中间语音和字幕。动作仍可能叠加 Control 的自然待机微动，
`[H:none]` 不等同于冻结整个模型。

```text
输入文本 -> Control 标签解析 -> 去标签的普通话台词
         -> eSpeak NG 同步 PCM 回调（无扬声器输出）
         -> 原始 TAR / PyTorch CPU -> Control Java 后处理
         -> 面部 + 头颈姿态 + 字幕 -> 网页 performance 时间轴
```

内部必须有语音信号驱动音频转口型模型，因此会生成临时 WAV；
**不播放、不返回给网页、不提供 WAV 下载地址**。
请求完成、失败或取消后删除任务目录。服务被强制终止或机器断电时，
可能残留 `artifacts/preview-jobs/` 下的中间文件；不应在 demo 中输入敏感台词。
浏览器内的台词/结果仅保留到刷新。当前只监听本机，不开放局域网。

普通话来自现有 `espeakng_loader` 中的 eSpeak NG `cmn`，音质和韵律较机械，
只适合口型/动作预演，不代表未来真人音色或生产 TTS 的口型节奏。
字幕按最多 32 字的合成分块同步，不是逐字高亮。
原始 TAR 权重不转换为 ONNX，也不发送给浏览器。

本机依赖与可选环境变量：

- `PET_TTS_PYTHON`：默认 `F:/Miniconda/python.exe`，已安装
  `espeakng_loader`、NumPy、SciPy；eSpeak NG DLL 和语言数据原地复用。
- `PET_PYTHON`：默认工作区 `.venv-lam-coreml/Scripts/python.exe`。
- `PET_LAM_SOURCE`：默认工作区 `LAM_Audio2Expression-main/LAM_Audio2Expression-main`，
  内含可信的原始 `pretrained_models/LAM_audio2exp_streaming.tar`。
- JDK、Gson、`JAVA` / `JAVAC` / `GSON_JAR` 同下文后处理准备步骤。
  服务首次生成时编译原有 Java 源码，之后复用，修改算法后重启服务。

本机实测短句“你好，很高兴见到你。”生成 3.08 秒动画；
首次端到端约 10 秒，包含 Java 编译、模型加载和推理，不是实时承诺。
固定语音的“Control 后处理”开关和预设只属于试听；自定义预览始终使用
Control 标签后处理。切换到试听或纯字幕会停止当前静音预览。

### 本地 API

`POST /api/previews`，请求 `Content-Type: application/json` 和与访问地址
一致的 `Origin`，正文只有 `{"text":"[H:shake]你好。"}`。
成功返回 `{version:1, clip, bank, behavior}`；clip 为原始口型、字幕、模型指纹，
bank 只有 `natural` 一条已应用标签的后处理轨道及收尾，不含音频或本地路径。
错误统一为 `{error:{code,message}}`。

400 为输入/标签错误，403 为来源错误，408 为正文超时，413 为超过 4 KiB，
415 为内容类型错误，409 为已有生成任务，503 为本地依赖或生成失败，
504 为超过 120 秒。仅支持一个任务；连接断开会终止当前子进程。
不自动重试、不提供持久化任务或幂等键，重试会重新计算，但没有计费或外部副作用。
子进程固定参数、无 shell；输入不作为命令、路径或 HTML 执行。

## 准备语音

本机已生成 `assets/speech.wav` 和 `assets/speech.json`。换机器或重建时运行：

```powershell
powershell -NoProfile -File scripts/prepare-speech.ps1
```

脚本使用 Windows `System.Speech` 的 `Microsoft David Desktop` 音色，
按 `scripts/speech-lines.json` 分句合成 16 kHz 单声道 WAV，
再调用原始 PyTorch 模型。中文是对应翻译，按分句时间同步，并非逐字对齐。
Windows System.Speech 未安装中文音色；此固定试听流程不调用在线 TTS、
不读取 API Key。自定义预览另用上述 eSpeak NG 普通话。

当前复用的 Python 环境为工作区 `.venv-lam-coreml/Scripts/python.exe`
（torch 2.2.0+cpu、transformers 4.36.2、numpy 及原始 LAM 源码依赖）。
脚本名所在环境虽包含 Core ML 工具，本 Demo 不执行转换。
源码默认来自工作区 `LAM_Audio2Expression-main/LAM_Audio2Expression-main`，
权重为其 `pretrained_models/LAM_audio2exp_streaming.tar`。
可用 `-Python` 和 `-Source` 显式指定其他兼容的本地路径。
只加载受信任的原始源码与 checkpoint；使用 `weights_only=True` 和严格权重匹配。

本机记录：13.25 秒音频，398 帧，30 fps，52 维系数，CPU 推理约 3.8 秒。
这是离线预计算耗时，不是实时对话延迟保证。生成文件均被 Git 忽略。
无语音资源时形象仍可展示，点击播放会提示缺少资源，可生成后重试。

## Control 后处理

接入 Control 默认 `ios-v1` 播放链路，直接编译调用现有源码：

- `android-native/digitalhuman-core/.../playback/AudioClockExpressionTimeline.java`
- `android-native/lam-expression-common/src/main/java/com/zhanlv/lam/expression/`
- 动作库 `android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json`

保留弱口型增益、口部去尖峰/平滑/幅度校准、捕捉表情、眨眼、
头颈姿态和正常结束后的收尾。没有再叠加 legacy JNI 后处理。
没有重写 Java 算法，也没有修改正式工程源码。

已有 `assets/speech.json` 时，只生成后处理，不需要重新跑 TAR：

```powershell
node scripts/prepare-control.mjs
```

需要 JDK 11+（本机 JDK 21）及已安装的 Gson 2.11.0。
脚本优先读取 `GSON_JAR`，否则从 `GRADLE_USER_HOME` 或用户 Gradle 缓存查找；
可用 `JAVA`、`JAVAC` 指定可执行文件，不会下载依赖。
完整 `prepare-speech.ps1` 已在 TAR 推理后自动调用此步骤。
编译输出在忽略目录 `artifacts/control-java/`。

结果为 `assets/speech-control.json`，包含四个表情轨道及每条一秒收尾。
原始 TAR 帧不会被覆盖。记录输入 JSON、动作库与源码的 SHA-256；
浏览器校验输入 JSON 指纹，拒绝过期、不匹配、无效或缺失的后处理数据。
原始 WAV 同样有 SHA-256 校验。更新算法、动作库或语音后应重新生成。

网页复用正式 `installThreePresentationPose`，只映射明确的三个源码文件，
不开放源码目录；按通道名传值，避免不同数组顺序错位。
处理后画面由 Control 接管眨眼、头颈姿态与表情，避免再加 Demo 眨眼、
rig 嘴型放大或重复后处理。原有 rig 的口部缩小系数仍只应用一次。

范围说明：

- 四种语音表情分别对应 natural / happy / surprised / thoughtful。
  预计算固定随机种子 20261017、30 帧批次；A/B 使用同一音频时钟。
- 暂停、停止、隐藏和收起会立即清除说话口型；正常播完额外播放 Control 收尾。
- 待机/暂停的表情菜单仍是第一版预览；未接入麦克风、实时情绪识别、
  远程动作和动态对话。中途切换的是预生成轨道，不等同于完整原生会话重演。
- 首次关闭后处理播放后再开启，若尚未加载处理数据，会短暂停在当前音频位置，
  数据准备好再继续；已有数据时不暂停、不重置时间。

## TAR 与 ONNX

这两个选项不能与人物形象资源混为一谈：

| 文件 | 作用 | 当前实现 |
| --- | --- | --- |
| 形象 ZIP，含 GLB/PLY/JSON | 人物外观、骨骼、形变与待机动画 | 直接使用已有资源，不做转换 |
| `LAM_audio2exp_streaming.tar` | PyTorch 音频转表情原始 checkpoint | 准备脚本直接加载 |
| `lam_audio2exp_streaming.onnx` | 导出的音频转表情推理模型 | 不加载 |

本地 LAM-A2E 源码的 `engines/infer.py` 使用 `torch.load` 和
`model.load_state_dict` 加载 TAR 权重，浏览器不能把它当作 WebGL 形象直接打开。
网页只加载形象、WAV 和表情 JSON，不传输约 390 MiB 的 TAR 权重。

当前保留原始权重的路线：

```text
音频 -> 本地/服务端 PyTorch + 原始 TAR -> 表情系数 + 时间戳
     -> 网页人物渲染器
```

模型采用 34133 采样点窗口，每次保留末尾 30 帧，身份索引为 0。
浏览器以音频 `currentTime` 采样表情并更新字幕，暂停、收起、页面隐藏、
播放结束会关闭说话口型。WAV 的 SHA-256 必须与 JSON 中记录一致。

基础口型来自真实 TAR 推理；启用后处理时再经过上述 Control 链路。
捕捉动画和手动选择的情绪不代表模型识别了情绪。
固定试听不是自由文本 TTS；新增静音预览支持自定义台词，但不是实时对话。

## 更换形象

将环境变量指向受信任、兼容当前渲染器的原始形象 ZIP，然后重启服务：

```powershell
$env:PET_AVATAR_ZIP = 'F:\your-assets\avatar.zip'
npm start
```

当前验证过的包结构：

```text
oac/
  animation.glb
  skin.glb
  offset.ply
  vertex_order.json
```

保留单一顶层目录及目录记录。不同导出版本可能还有额外文件，应保留原包。
仅改扩展名不能把 TAR、ONNX 或任意 ZIP 变成兼容形象。
新人物可能需要在 `src/avatar.mjs` 的 `resize` 中调整镜头缩放；
目前镜头是按 Benny 包验收的，不声称适配任意形象。

服务只将指定 ZIP 映射为 `/assets/avatar.zip`，不复制、修改或提交大资源。
`assets/` 和 `artifacts/` 已忽略，勿将权重或凭据加入版本控制。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `server.mjs` | 仅本机监听、文件白名单、权限策略、端口回退 |
| `index.html` / `src/style.css` | 宿主页面及浮层布局 |
| `src/host.mjs` | 拖动、窗口约束、收起恢复、字幕播放 |
| `src/state.mjs` | 可单测的位置、拖动阈值、字幕分段与时钟 |
| `src/expression.mjs` | 52 维系数校验、音频时间插值、分句字幕及表情预设 |
| `src/speech.mjs` | 音频加载校验、播放生命周期和表情消息 |
| `src/preview.mjs` | 自定义台词生成、静音时钟、暂停/取消与动作播放 |
| `scripts/preview-service.mjs` | 同源 API、子进程、并发/超时、私有临时目录 |
| `scripts/ControlPreview.java` / `silent_tts.py` | 规范标签边界、普通话 PCM 回调 |
| `src/control.mjs` | 后处理数据校验、按音频时间采样面部与姿态 |
| `scripts/` | 离线语音合成及原始 TAR 预计算 |
| `scripts/ControlPostprocess.java` / `prepare-control.mjs` | 直接调用现有 Control 后处理，生成可对比轨道 |
| `avatar.html` / `src/avatar.mjs` | 独立 iframe、原始形象、透明画布、首帧检查 |
| `tests/` | 单元测试与真实浏览器验收 |
| `SPEC.md` / `tasks/` | 范围、决策和验收记录 |

人物和宿主通过同源 postMessage 通信，校验 `source`、`origin` 和频道。
iframe 隔离渲染库的共享画布，重试通过重载 iframe 释放旧实例。
拖动热区为人物附近的椭圆，浮层空白区域及字幕不拦截页面操作；
热区不是逐像素命中测试，人物轮廓附近少量透明区域仍可拖动。

方向键移动已聚焦的数字人，Shift 加速；Enter/Space 切换演示台词。
每段字幕显示 4.5 秒，长文本按 32 个 Unicode 字符分段；可暂停和循环。
窄屏人物最大宽度为 220px，横屏高度不足时自动缩小人物取景区。
便笺和演示台词仅保留在当前页面，刷新即恢复默认值。

## 验证

```powershell
npm test
node --check src/host.mjs
node --check src/avatar.mjs
node --check src/speech.mjs
F:/zhanlvAndroidSdk/.venv-lam-coreml/Scripts/python.exe -m unittest discover -s tests -p test_infer_speech.py
F:/Miniconda/python.exe -m unittest discover -s tests -p test_silent_tts.py
```

浏览器验收使用 Playwright + Edge，以及 axe-core。测试工具安装在工作区
临时目录，不增加主项目依赖：

```powershell
npm install --prefix F:/zhanlvAndroidSdk/.codex_tmp/web-pet-qa --no-save --package-lock=false playwright@1.56.1 @axe-core/playwright@4.10.2
node tests/browser.mjs
node tests/speech-browser.mjs
node tests/control-browser.mjs
node tests/preview-browser.mjs
node tests/preview-inference.mjs
```

先启动 Demo；若端口不是 5178，设置 `$env:DEMO_URL`。
可用 `PLAYWRIGHT_MODULE` / `AXE_MODULE` 指向其他已安装的对应包目录。
截图及 JSON 验收报告写入 `artifacts/`，不提交。

浏览器测试覆盖实际画布的非空白/透明像素、动画变化、鼠标/触摸拖动、
键盘、收起恢复、长文本、防 HTML 注入、字幕播放、失败重试、
音频播放/暂停/停止/结束/重播、实际口型系数变化及复位、预设切换、
加载中停止、音频/表情不匹配与缺失资源重试、
320/768/1024/1440 宽度及横屏布局。正常路径要求零控制台错误和外部请求；
故意返回 404 的错误分支单独记录预期错误。

后处理数值验证：`node scripts/prepare-control.mjs --test`，90 帧 x 52 通道
及姿态逐值对照直接调用 Control，确保原始输入不变；也运行规范标签、
中文别名、剥离、非法/重复标签测试。
静音浏览器验收实际提交两段中文台词，对比不同 TAR 帧和中间语音指纹，
检查零播放调用、零 WAV 请求、实际头颈姿态、口型变化、关闭/恢复字幕、
暂停/取消/修改时的过期结果隔离，以及四种宽度的画布像素和截图。
`preview-inference.mjs` 还检查真实长句分块、原始 TAR 输出，
以及完成、标签失败、真实子进程取消后的临时文件清理。
渲染器适配器原有测试：
`node --test test/presentation-pose.test.js test/native-presentation.test.js`，
工作目录为 `control/android-native/renderer/tools/ali-native-shell-ui`。

Control 根目录的 `npm test` 已执行，但 Windows 上的既有
`jevExpressionDirector.test.cjs` 需要 `xcode-select`，无法完成该项；
其前置测试通过，后续七个 JS 测试已单独执行通过。未修改或跳过原测试。
