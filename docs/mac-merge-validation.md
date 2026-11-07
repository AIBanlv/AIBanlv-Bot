# Mac 适配合并记录（2026-10-25）

目标仓库：`/Users/taoyu/kaifa/control-windows`，基线 `f20911e`（0.1.4）。
来源：`control-windows-master` 当前链接所指的 `aibanlvcontrol/desktop`。
以目标仓库现有功能为基础按模块合并，没有覆盖新版 UI、登录、游客积分、
语音输入、记忆、Harness、Codex、WorkBuddy 或文件传输代码。
未提交、推送或生成新的安装包。旧源码和旧测试包原地保留。

## 合入内容

- Windows x64 / macOS x64、arm64 构建目标和独立发布清单；Windows
  继续使用 PyTorch/TAR、原依赖复制逻辑和 NSIS。
- 手机原 Core ML 模型、Swift worker、自动后端对照测速与缓存、CPU 回退、
  缓冲区复用及预计算重采样滤波核。
- 保留新版统一预热调度；Mac 在可见且授权有效时跨回复复用权重，停止、
  打断或切换角色清除旧状态，隐藏、失去授权或退出释放进程。
- 原生 Node 插件按目标架构校验，缺少目标可选依赖时阻止打包。
  arm64 建议在苹果芯片 Mac 安装依赖和构建。
- 仓库独立归档夹具、Windows 原生用例平台限制、双平台单元 CI。

## 验证结果

测试主机为 Intel macOS；依赖按现有锁文件安装，未升级依赖。

- 完整 `npm test`：503 项，488 通过、14 项 Windows 原生用例跳过、
  1 项失败：`embedded Harness boots with only distribution dependencies outside the source tree`。
- 失败的 Harness 启动已在未合入 Mac 的原始 HEAD 快照中复现为
  `BASELINE_HARNESS_UNAVAILABLE`，不属于本次推理适配回归；尚未修复。
- 后增的 Mac 插件架构保护及发布源文件测试 2 项通过；本机原生插件
  二进制架构校验通过。
- Swift worker 的 `x86_64-apple-macos13.0` 和 `arm64-apple-macos13.0`
  均编译成功；`file` 确认目标 Mach-O 架构。
- 修改的主进程、推理、打包和安装器 JavaScript 语法及 Git 空白检查通过。
- Mac UI 本地验收通过：双窗口、二维码、Key 设置、绑定状态、Codex
  本地夹具任务、悬浮记录、320/650/960 宽度布局以及退出关闭应用。
  页面错误和失败资源均为空，结果保存在
  `demos/web-desktop-pet/artifacts/mac-merge/electron.log`。
  测试夹具在应用构造前注入，避免调用真实 Codex app-server。

原始日志在 `demos/web-desktop-pet/artifacts/mac-merge/`，不进入 Git。
本次未重新运行真实模型完整语音回归，也未在 Windows 或苹果芯片机器
实机验收；不能沿用旧版 0.1.3 安装包的验收结果宣称 0.1.4 全部通过。
