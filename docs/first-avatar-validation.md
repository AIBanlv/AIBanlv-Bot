# 首次形象修复验证（2026-10-20）

版本：0.1.3。首次绑定只确认设备身份，旧版在没有收到角色配置时一直等待。
新版等待服务端角色、请求一次 `device_online` 重放；仍无配置时读取公共目录的
唯一 waner，走原来的下载、ZIP 校验和首帧确认流程。手机下发角色优先。

## 已通过

- 根目录 `npm test`：164/164，无跳过。
- 公共目录只读查询及真实 waner ZIP 下载、结构校验：8,882,882 字节。
- `DEVICE_INITIAL_ONLY=1`、`DEVICE_AVATAR_ZIP=<真实 waner ZIP>` 下执行
  `npm run device:test`：首次绑定无重新应用、默认人物可见、手机角色覆盖、
  解绑清除、重新绑定恢复默认、退出资源清理、无自动云对话均通过。
- 同一 Electron 检查以 `DEVICE_EXECUTABLE=<0.1.3 打包程序>` 执行再次通过；
  测试禁用开发 Python/Java 等路径，使用隔离设备目录、本地 WebSocket 与目录夹具。
- `npm run package:device` 成功；打包资源复用旧工程已准备的 Python/JRE，
  桌面源文件及依赖来自 `control-windows`。没有修改旧工程。

截图和报告（忽略目录）：
`demos/web-desktop-pet/artifacts/device-electron/first-binding-waner.png`、
`initial-avatar-results.json`。截图人工检查人物完整显示、窗口透明、名称为 waner。

## 完整回归限制

不设置 `DEVICE_INITIAL_ONLY` 的完整 Electron 回归在长文本气泡布局检查
`bubbleLayout.scrollable && bubbleLayout.contained` 失败，脚本错误列表为空。
此前首次默认加载、角色切换、失败重试等流程已通过。未放宽断言，未修改气泡布局，
不声称完整 Electron 回归通过。尚未在用户另一台电脑上进行真实手机绑定验收。

默认显示仍需联网，不自动创建收费对话。回退可退出新版并安装原 0.1.2；
设备身份目录不变，无新增服务端迁移。
