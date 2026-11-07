# Contributing · 贡献指南

欢迎帮助改进 AIBanlv Bot 的桌面交互、智能体工具、跨平台兼容、测试和四语文档。较大的功能、依赖或权限变更，请先通过 Issue 说明需求与边界。

## 开始开发

先阅读 [README](README.md)、[AGENTS.md](AGENTS.md)、相关 demo 规格和 [开发指南](docs/DEVELOPMENT.md)。主项目位于 `demos/web-desktop-pet`；Windows 与 macOS 共用源码，`android-native` 只是桌面复用的源码子集。

需要 Node.js 24+、npm 和 Git，依赖按锁文件安装：

```sh
npm ci
npm run setup
npm start
```

初始化可能下载较大的推理资源，详见 [安装说明](docs/INSTALL_FOR_AGENTS.md)。Mac 推理与发行修改还需阅读 [跨平台约定](CROSS-PLATFORM-SPEC.md)。不要为普通文档修改运行初始化或构建安装包。

## 提交前检查

- 保持 PR 聚焦，保留已有改动；修复应带回归测试，UI 变更附截图和复现步骤。
- 在仓库根目录运行 `npm test`。涉及 UI/运行时，还应运行相关 Electron 本地夹具；报告实际通过项和失败项，不把模拟验证描述为真实上线验证。
- Java 改动在 `demos/web-desktop-pet` 运行 `node scripts/prepare-control.mjs --test` 和 `node tests/device-lam-control.mjs`。
- 使用本地 HTTP/WS、模型和邮箱夹具。自动化测试不得创建付费线上会话、上传私人资料、发送真实邮件或操作用户真实文件。
- 新依赖须说明必要性、许可、体积和跨平台影响，并在所属清单与锁文件固定版本。安装包仅在明确需要时构建，不提交到 Git。
- 提交说明使用 `<type>: <简体中文摘要>` 或 `<type>(<scope>): <简体中文摘要>`，PR 中写明动机、范围、验证和已知限制。AI 辅助生成的修改也需自行审查。

## 权限与资源边界

不得绕过扫码绑定、在线积分校验、任务取消、工具授权或系统安全策略。工具进度应来自真实结果，不展示隐藏推理，不将“已提交”描述成“已完成”。详见 [权限与数据说明](docs/CLIENT_SECURITY.md)。

不要提交密钥、设备身份、本地配置、私人形象、邮件/对话日志、模型权重或安装包。需要复现资料时使用脱敏的最小夹具。源码采用 [Apache-2.0](LICENSE)；Logo、商标与形象资产单独授权，第三方资源分别遵循各自条款，参见 [许可说明](docs/LICENSING.md)。提交内容应有合法贡献权限。

请遵守 [Code of conduct](CODE_OF_CONDUCT.md)。一般协作可联系 [frank750166@gmail.com](mailto:frank750166@gmail.com)；漏洞请按 [Security](SECURITY.md) 私下报告，不发公开 Issue。
