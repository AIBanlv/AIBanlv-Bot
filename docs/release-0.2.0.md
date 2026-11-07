# AIBanlv 0.2.0 Windows x64 流程验收包

新增默认 HTTPS 版本检查、下载/取消、完整性校验、用户触发退出安装；
有可信本地基线时通过 blockmap 和 HTTP Range 差分下载，缺少基线或差分失败时完整下载。
修正开发入口将 Electron 版本误显示为应用版本的问题。

沿用原 NSIS 安装标记、注册表身份和用户资料目录。公开发布文件只有版本化 EXE、
对应 EXE.blockmap 和 latest.json，上传至 `/desktop-updates/windows/x64/`，最后替换清单。
首次手动安装不建立差分基线；第一次应用内更新完整下载并保存基线后，后续可差分。

本包用于用户自行验证线上发布流程，沿用现有未签名内部安装器。
已有依赖审计告警未在本轮批量升级处理；本次构建不代表生产安全审计或线上验收通过。
不自动上传服务器，不替换正常已安装应用，不创建 Git 提交或标签。

## 发布文件

已生成在 `demos/web-desktop-pet/dist/releases/0.2.0/`，该目录仅包含三个公开文件：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| AIBanlv-0.2.0-win-x64-Setup.exe | 737894605 | 5f392a66bdb1588fc806429953ae62d5290d469766c81ffadde6a5ce7f04186c |
| AIBanlv-0.2.0-win-x64-Setup.exe.blockmap | 771402 | f6ea3f569aa40fc7a0b2dd45eb8fc1c4c4beab8e21e13440e78657678cc666e8 |
| latest.json | 以生成文件为准 | 内含上述文件的大小和哈希 |

清单固定指向 `https://zhanlvgpt.ieasysell.com/desktop-updates/windows/x64/`。
先上传 EXE 和 blockmap，确认完成后再原子替换 latest.json；不要上传 device-installer.json。
完整安装文件约 1.54 GB，另需安装器和更新缓存空间。

## 构建输入与验证

- 根清单、demo 清单及其锁文件统一为 0.2.0，未创建提交或 Git 标签。
- Node.js 24.22.1：根 `npm test` 590 项通过。
- `node tests/device-update-electron.mjs`：0.2.0 真实应用版本、差分/完整下载、
  取消、校验、窄 IPC、键盘、响应式和 axe 通过。
- 首次构建遇到外部运行时下载超时。复用本仓库旧构建的独立 Python/模型运行时，
  复制到本仓库忽略的 artifacts 后验证；未修改旧 control 项目。
  原始 TAR 哈希仍为 `38084d471966381f2e52d9f59e5654c9b8cde6fa36d4c6f18fc02cbaf593d157`。
- Java、NSIS 和解压工具从本机已有缓存读取并按构建脚本中的固定哈希验证；
  Java/NSIS 解压到本仓库的工具缓存中，未更换运行时版本。
- `node tests/device-python-package.mjs artifacts/release-0.2.0-runtime`：
  31 项 Python 依赖、运行时隔离、带空格路径重定位、禁止联网和真实原始模型推理通过；
  三次推理约 112～114 ms，同输入输出一致，不同输入输出不同。
  缺失的两份本地 phrase WAV 测试输入从已有旧 checkout 的测试资产恢复到忽略目录，
  不进入分发包。
- `node electron/device-package.mjs --platform=win32 --arch=x64`：应用目录构建成功。
  使用已验证的 `DEVICE_PYTHON_STAGE`，Java 编译保留已有弃用 API 提示。
- `node electron/device-installer.mjs`：NSIS、blockmap 和 latest.json 生成成功。
- `node tests/device-update-packaged.mjs`：实际 AIBanlv.exe 以打包模式启动，
  版本 0.2.0，更新检查、下载、校验通过；未安装的目录正确拒绝覆盖安装。
  全程使用隔离资料目录和本地服务夹具，未执行真实覆盖安装或计费会话。
- `node tests/device-installer-safety.mjs`：独立安装标识的 NSIS 夹具通过，
  包含文件锁、维护信息保留、重试卸载、自启动删除和无关文件保留。
- 发布校验脚本重新计算实际文件大小/哈希、解析 blockmap，验证清单地址，
  从打包树加载差分依赖；检查 18,865 个应用文件未发现禁止的本机资料文件名。
- `git diff --check` 通过。

## 实际验收边界

旧 `DEVICE_INITIAL_ONLY=1 node tests/device-electron.mjs` 仍断言未绑定时角色 iframe 数为 0。
当前游客功能会在未绑定时加载角色，实际为 1，因此旧脚本在该断言停止。
未删除或跳过该断言，也未将旧整体验收记为通过；另有上述针对当前更新流程的
实际打包程序测试通过。正常安装目录的覆盖安装、线上 CDN Range 和目标机器体验，
仍由本次用户操作验收。

首次手动安装 0.2.0 后若服务器清单也是 0.2.0，“没有可用更新”是正常结果。
要继续验证一次应用内升级，需再发布更高应用版本；首次无基线仍完整下载，之后可差分。

构建、运行时、安装器与校验日志保存在 demo 的忽略目录 `artifacts/release-0.2.0*`。
