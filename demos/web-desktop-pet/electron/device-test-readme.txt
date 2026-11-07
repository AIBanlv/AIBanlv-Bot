AIBanlv 桌面伴侣 · 内部测试版（Windows 10/11 x64）

打开 AIBanlv.exe，或安装后从桌面、开始菜单打开 AIBanlv。
在 Control App 扫码绑定设备，选择形象和配对音色；数字人加载后可在下方输入文字对话。
每次启动并确认绑定后自动加载公共 waner；旧状态回放不覆盖默认形象。
在桌面形象列表或手机主动选择的角色优先，默认形象加载失败可在设置页重试。
聊天气泡在数字人下方，底部是常驻输入卡片（左侧拖动、设置、隐藏与尺寸滑杆，右下角麦克风/发送，不能收起）。
[] 标签不在回复气泡显示。
设置页保留线上形象、音量、停止回复、助手及窗口设置，已移除文字与动作调试区。关闭设置页会隐藏到托盘；
从托盘或控制框选择“退出”才会退出整个程序。
任务栏可选择“AIBanlv - 桌面伴侣”窗口。OBS 添加“窗口捕获”时选择这个窗口，
不要选择“AIBanlv - 桌面伴侣设置”。捕获期间不要隐藏或最小化桌面伴侣。
窗口自身保持透明；OBS 的实际捕获及透明通道效果需在本机验证。

已内置 Electron、Python、原始 LAM 模型及 Java/Control 后处理，不需另外安装 Node、Python 或 Java。
需要联网访问 Control 和语音服务，以及支持 WebGL2 的显卡驱动。建议至少 8 GB 内存。
模型在绑定后与形象并行预热，人物就绪后预连接对话；文字和语音回复均播放声音和口型。
线上对话可能按账号规则计费，请使用获准的测试账号。
麦克风默认关闭，点击右下角按钮后才采集并提交；可以对数字人说话打断它的回复
（说话期间要求更大音量并持续约 0.5 秒，避免它自己的声音误触发），隐藏人物会释放音轨，
开启时文本框位置显示随音频能量跳动的本地波形。
在 Control App 里发的消息会在桌面端读出并显示；桌面端的文字、语音与触摸对话也会回传到 App，
连接恢复后自动补发尚未确认保存的最后一句。服务端下发的提醒由当前角色用当前音色播报，
不切换形象。解绑、换绑或切换角色会丢弃桌面端缓存的对话。

电脑助手已内置官方 DeepSeek Harness 核心，无需另装 Harness 或选择安装目录。
在控制台填写 DeepSeek API Key，点击“保存并启用”，即可通过文字或语音请求
打开文件夹、公开 HTTPS 网页、搜索资料或总结指定 UTF-8 文本。具体本机操作逐次确认。
Key 默认仅保存在本次运行内；可选在本机加密记住，重启后仍需点击“保存并启用”。
清除 Key 即停用助手。DeepSeek 推理和搜索使用你自己的 Key，单独计费。

这是未签名的内部测试包，尚未做生产发布。Windows 可能显示发布者无法验证的提示；
请核对交付方提供的 SHA-256，遵循单位的软件安装政策，不要关闭系统安全防护。
尚需在同事的真实硬件、手机账号及网络上验证扫码、线上音色和发声效果。

只在当前用户下安装，默认注册当前用户开机自启动，完成页默认勾选立即打开，不修改 PATH，
不安装系统级 Python/Java。卸载会删除自启动项，但不会删除设备标识。
为兼容已有绑定，设备标识仍保存在 %APPDATA%\Control Device；卸载不会删除该标识。
如需解绑，请先在 Control App 解绑。包内不含打包者的设备标识、会话凭证或私有形象缓存。

第三方组件的许可证随文件保留：
- Electron: 根目录 LICENSE、LICENSES.chromium.html。
- Python 与 Python 扩展: resources\app\runtime\python 下的许可和各包 dist-info。
- Microsoft C++ 运行库: resources\app\runtime\python\MSVC-LICENSE.docx。
- LAM 源码和模型: resources\app\runtime\model 下的许可。
- Eclipse Temurin OpenJDK: resources\app\runtime\java\legal。
- Gson: resources\app\runtime\control\gson.jar 内的 META-INF。
- Harness、QR/ZIP 等 Node 包与人物渲染库: resources\app 下对应 node_modules 的 LICENSE。

遇到问题请记录 Windows 版本、硬件、复现步骤和错误提示；不要发送账号密码或临时会话凭证。
