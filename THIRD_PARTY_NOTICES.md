# 第三方致谢与引用 / Third-party acknowledgements

感谢以下研究和开源项目。本页记录相关技术来源、上游声明及引用入口，不代表获得其团队的背书，
也不是完整的依赖清单或已完成的许可证审计。具体组件是否随某发行包分发，以该产物为准。

**集成或引用不改变第三方授权。** 下列及其他第三方代码、模型权重、数据、工具和素材分别适用其项目与具体资源的原许可证或使用条款；本项目的 Apache-2.0 仅覆盖有权以该许可提供的原创源码，不能代替上游 LICENSE/NOTICE，也不自动授予模型或素材的再分发权。

## LAM

- 项目：[aigc3d/LAM](https://github.com/aigc3d/LAM)
- 项目页：[Large Avatar Model](https://aigc3d.github.io/projects/LAM/)
- 作用：单图生成可动画高斯头部的研究及相关数字人技术背景；不代表桌面端在本地运行完整形象生成训练/推理系统。
- 代码许可：[Apache-2.0](https://github.com/aigc3d/LAM/blob/master/LICENSE)。权重有[单独许可](https://github.com/aigc3d/LAM/blob/master/LICENSE_WEIGHT)，请分别核对具体下载内容。

论文引用（来自上游 README）：

```bibtex
@inproceedings{he2025lam,
  title={LAM: Large Avatar Model for One-shot Animatable Gaussian Head},
  author={He, Yisheng and Gu, Xiaodong and Ye, Xiaodan and Xu, Chao and Zhao, Zhengyi and Dong, Yuan and Yuan, Weihao and Dong, Zilong and Bo, Liefeng},
  booktitle={Proceedings of the Special Interest Group on Computer Graphics and Interactive Techniques Conference Conference Papers},
  pages={1--13},
  year={2025}
}
```

## LAM Audio2Expression / LAM-A2E

- 项目：[aigc3d/LAM_Audio2Expression](https://github.com/aigc3d/LAM_Audio2Expression)
- 作用：由语音生成 ARKit 表情系数；本项目的本机音频驱动口型链路以其相关模型与技术为基础，再接入桌面后处理及播放时钟。
- 上游代码许可：[Apache-2.0](https://github.com/aigc3d/LAM_Audio2Expression/blob/main/LICENSE)。模型、附带数据及预训练组件仍须核对各自许可。
- 本项目 Windows 使用原 PyTorch 路线，Mac 使用相应 Core ML 路线；转换形式不改变上游原有权利，也不授予新的权重使用权。

## KeyframeFace

- 项目：[wjc12345123/KeyframeFace](https://github.com/wjc12345123/KeyframeFace)
- 论文：[KeyframeFace](https://arxiv.org/abs/2512.11321)
- 作用：语言驱动的表情语义关键帧研究与格式参考。桌面代码包含命名通道、关键帧库读取及播放逻辑；这不等于默认运行上游的生成模型或训练流程。
- 上游公开代码：[MIT](https://github.com/wjc12345123/KeyframeFace/blob/main/LICENSE)，版权声明为 `Copyright (c) 2026 KeyframeFace Authors`。实际复用上游代码时须保留其版权和许可文本。
- 本项目的 `AIBANLVKeyframeFace.json` 是动作素材，不能仅凭名称认定是上游 MIT 代码、模型或数据集，也不能以本项目 Apache-2.0 声明推导其再分发许可。见[素材边界](docs/LICENSING.md)。

论文引用（来自上游 README）：

```bibtex
@misc{wu2026keyframeface,
  title         = {KeyframeFace: Language-Driven Facial Animation via Semantic Keyframes},
  author        = {Jingchao Wu and Zejian Kang and Haibo Liu and Yuanchen Fei and Xiangru Huang},
  year          = {2026},
  eprint        = {2512.11321},
  archivePrefix = {arXiv},
  primaryClass  = {cs.CV},
  doi           = {10.48550/arXiv.2512.11321}
}
```

## 其他依赖 / Other dependencies

Electron、Three.js、Gaussian Splat 渲染器、Java/Python 运行时、DeepSeek Harness 相关依赖、邮件库以及其他直接和间接依赖
保留各自权利和许可。依赖版本由各目录 `package.json` 与锁文件确定；发布者应以实际安装和分发的版本收集 LICENSE/NOTICE，
不能用本项目 Apache-2.0 文件替代全部上游声明。

本页为致谢和核对入口；仅列出研究来源不证明获得了任意模型、形象、数据集或品牌的商业授权。
桌面源码许可与 AIBanlv 保留资产分别见 [LICENSE](LICENSE) 和[许可说明](docs/LICENSING.md)。

English: LAM, LAM Audio2Expression and KeyframeFace retain their upstream licenses and attribution requirements.
Code, weights, datasets and avatar/motion assets may have different terms. Citation does not grant additional rights or imply endorsement.
