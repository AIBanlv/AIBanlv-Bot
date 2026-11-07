# 代码许可与资源边界 / Licensing and assets

## 原创代码：Apache-2.0

本仓库由 AIBanlv 项目权利人有权授权的原创桌面源码，以及随之提供且无独立声明的原创文档，
采用 **Apache License, Version 2.0（SPDX：`Apache-2.0`）**。完整英文许可见根目录 [LICENSE](../LICENSE)，
其原文不作附加修改。现有第三方代码、依赖和独立素材的原许可不因此改变。

Apache-2.0 允许使用、修改、再分发、商业使用以及出售副本；不存在本项目额外附加的“禁止商业售卖”条件。
分发时须附带许可、保留适用声明、标注修改，并按要求保留 NOTICE 中的归属声明（如有）；本段是摘要，
不能替代完整许可，也不构成对具体发行方案的法律合规结论。

官方依据：[Apache License 2.0 原文](https://www.apache.org/licenses/LICENSE-2.0)。
只有本项目权利人拥有授权权利的材料才可由本项目按 Apache-2.0 提供，不能重授第三方原本未授予的权利。

## 不包含 Logo、商标及形象资产授权

除非某项材料另有明确许可，以下 AIBanlv 材料**不属于上述 Apache-2.0 代码授权范围**：

- AIBanlv 的名称标识、Logo、商标、品牌图形及应用图标，包括 `static/`、安装器与应用中的相关图像。
- 人物形象及照片、GLB/PLY/贴图、形象 ZIP、定制人物、音色与录音、宣传图、社群二维码和演示影音。
- AIBanlv 有独立权利的表情/动作素材，包括 `android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json` 中有独立权利的捕捉动作数据；同名解析、播放代码与动作数据不是同一种材料。
- 用户、合作方或第三方提供的私有素材、设备身份及账号数据。

可在官方程序中正常使用某资源、能从 CDN 下载或能在仓库中看到它，并不授予复制、再分发、
提取素材或商业售卖这些资产的许可。相关使用须按该资源已有授权或另行取得权利人许可。
Apache-2.0 代码允许商业分发，不等于获准捆绑销售上述保留资产或将衍生项目冒充 AIBanlv 官方产品。
Fork/再打包时请核对每项素材的授权，必要时更换为自行拥有或有权分发的品牌与形象资源。

本声明不撤销第三方已经通过 MIT、Apache-2.0 等许可授予的权利；不能仅因文件名包含
LAM、KeyframeFace 或与 AIBanlv 一同分发，就认定其版权、许可或素材来源。

## 第三方与模型

**集成、调用或引用第三方项目，不会把该项目的代码或资源重新授权为本项目的 Apache-2.0。** 各项材料按其实际来源、具体版本和文件适用相应的上游许可或使用条款：

| 材料 | 应核对的授权 |
| --- | --- |
| 第三方源码、库、工具及运行时 | 对应项目及版本的 LICENSE、版权声明和 NOTICE；按要求保留署名、附带声明或提供源码 |
| 模型权重、预训练组件、数据集 | 具体权重/数据的许可、模型卡和下载条款；不能只依据代码仓库的许可证判断 |
| 第三方形象、声音、图片、动作等素材 | 素材权利人的单独许可，及其对复制、修改、再分发和商业使用的限制 |
| 外部 API 与在线服务 | 服务提供方的使用条款、账号及计费规则；API Key 不等于代码或资源再分发授权 |

特别是 LAM 的代码与权重分别声明，不能用代码仓库的 Apache-2.0 标识代替权重授权。上游项目与许可入口参见[第三方致谢](../THIRD_PARTY_NOTICES.md)。同时分发本项目与第三方组件时，还须核对许可兼容性及实际分发义务；本声明本身不构成合规保证。

开源桌面源码不代表 AIBanlv 后端、手机 App、线上积分、云端资源或服务协议被一并授权；个人模型 Key 也不授予这些服务权限。

## 发布前核对

本次添加许可和致谢不等于完成全仓库版权审计、安全扫描或二进制合规认证。公开发布前，应至少：

1. 确认贡献者与所复用源码的授权链，保留上游声明。
2. 检查 Git 当前文件与历史，清理凭据、设备身份、私人数据和未授权素材；不要只依靠 `.gitignore`。
3. 为实际分发的依赖、权重、运行时及资产核对许可，随产物提供要求的声明与对应源码。
4. 不把第三方服务认证信息或商业资源的访问权当作开源许可的一部分。

## English summary

Original source and original documentation that the project has the right to license are provided under **Apache-2.0**, unless separately stated.
Apache-2.0 permits commercial use and selling copies; retain the license and applicable notices, identify modified files, and preserve NOTICE attributions where required.
The unmodified English [LICENSE](../LICENSE) is authoritative.

AIBanlv logos, trademarks, icons, avatars, audiovisual materials and separately owned motion assets are **not** licensed by the source-code Apache-2.0 grant.
Public availability is not redistribution or resale permission. Obtain authorization for those assets and do not imply official endorsement.
Third-party code and assets retain their existing rights; this notice cannot override MIT, Apache-2.0 or other upstream grants.
Integrated or referenced third-party code, dependencies, weights, datasets, media and services remain subject to the terms for their respective projects, versions and specific resources. A code repository license does not automatically license model weights or datasets. Check upstream LICENSE/NOTICE files, model cards and service terms before redistribution, including license compatibility and attribution obligations.
This documentation is not a completed repository-wide license or security audit.
