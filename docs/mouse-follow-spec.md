# 全桌面鼠标视线跟随

> **已被合并取代（2026-10-21）**：本文记录的实现在 master 合并时并入了
> `electron/device-mood.mjs`。两个控制器同时写 `pose.owned` 帧会互相抢
> 眼睛和头，正是这次改版要消除的顿挫来源；且 `pet:cursor` 传绝对屏幕坐标，
> 超出渲染器所需。现役实现走 `pet:pointer`（归一化方向 + 像素距离 + 系统空闲时间），
> 由 `device-mood.mjs` 统一缓动，`tests/device-mood.test.mjs` 会拦住绝对坐标回流。
> `device-gaze.mjs`、`pet:cursor`、`desktopPet.onCursor` 及其测试已删除；
> 下文的速度-能量映射与调参经验保留作参考。

## 目标与已确认方案

用户确认覆盖整个桌面：慢速移动轻微转动，快速移动反应更明显，停下后回正。
默认启用，只驱动本地头部和眼神，不产生触碰、对话、音频或收费请求。
停下保持 1500ms，再用约 1000ms 淡出；眼神先动，首次唤起时头部延迟 200ms。
过滤 3 个逻辑像素以内的抖动，慢速的累计位移仍能唤起跟随。
转角有界，不随桌面距离无限放大；第一帧鼠标位置只作为基线，不主动转头。

## 结构与契约（历史设计）

- `electron/device-windows.mjs` 复用现有 50ms 全局鼠标采样。
- `pet:cursor` 只从主进程发送给可见且形象就绪的数字人。
- `desktopPet.onCursor(callback)` 返回取消订阅函数，不暴露 Electron 事件对象。
- 事件为 `{ screenX, screenY, x, y, width, height, dragging }`：
  坐标均为 Electron DIP，`x/y` 相对数字人窗口，`height` 为人物区域高度。
  支持负屏幕坐标和多显示器；速度基于屏幕坐标，而非窗口相对位移。
- `electron/device-gaze.mjs`（已删除）校验事件，以渲染器的单调时钟计算速度、
  保持和回正，沿用 `neutralExpression()` 与 presentation pose 协议。
- 只在注意力有效或回正期间运行动画，保留自然眨眼，不添加微笑或嘴型。
- 抚摸（包括松开回正）、对话、动作预览和窗口拖动优先。
  隐藏、形象未就绪、切换角色、页面卸载时清理状态；
  优先行为结束后等待新的鼠标移动，不补播旧目标。
- 鼠标穿透、失焦不禁用全桌面跟随，也不改变热区、窗口尺寸或焦点。

## 风格与边界

沿用 ES modules、单引号和 camelCase：

```javascript
gaze = installMouseFollow({
  canFollow: () => visible && avatarReady && !chat.busy && !previewActive,
  onExpression: value => tellAvatar({ type: 'expression', ...value }),
})
```

Always：保留用户改动，验证有限输入与转角、资源清理及优先级。
Ask first：新增依赖、扩展为云端交互或新增配置页面。
Never：修改旧 `control`、共享渲染器、模型或正式服务；记录/上传鼠标轨迹。

## 计划与测试

1. 先用 Node 测试固定坐标映射、快慢强度、眼先头后、累计慢移、抖动、
   保持/回正、异常输入及取消，再实现独立控制器。
2. 接入主进程/预加载/数字人，更新私有 HTTP 路由与打包清单；
   验证订阅、优先级、取消和原抚摸回归。
3. 用现有 Electron 本地夹具和真实形象验收窗口外全局跟随、
   骨骼变化、画面像素、鼠标穿透、动作/抚摸优先及隐藏/角色切换清理。

命令：

- Demo 目录：`node --test tests/device-mood.test.mjs tests/device-touch.test.mjs tests/device-package.test.mjs`
- 仓库根目录：`npm test`
- Demo 目录：`$env:DEVICE_TOUCH_ONLY='1'; npm run device:test`
- 启动：仓库根目录 `npm start`

自动验收只用本地 provider/billing 夹具，不创建正式收费会话。

## 验证记录（2026-10-20）

- 专项 Node 测试 16 项通过；仓库根目录 `npm test` 173 项通过，无跳过。
- Demo 目录 `$env:DEVICE_GAZE_ONLY='1'; npm run device:test` 通过：
  真实全局鼠标采样从数字人窗口外送达，确定性 DIP 夹具继续覆盖快慢、
  保持/回正、实际头颈骨骼变化、穿透、抚摸/动作优先、隐藏/换角清理。
  同一目标的慢速 yaw 约 0.085，快速约 0.313；真实画面 42119 个可见像素，
  左右画面 hash 不同，240/380 宽度截图均非空，可访问性检查无违规。
- Demo 目录 `$env:DEVICE_TOUCH_ONLY='1'; npm run device:test` 通过：
  抚摸/鼻尖轻点保留各自提示、语音、LAM 口型、计费完成、草稿、
  键盘/名称拖动和取消；播放回复时移动鼠标不会接管表情。
- 查看 `artifacts/device-electron/gaze-{left,right,neutral}.png`，
  人物与现有界面正常；运行期间页面错误、警告和外部页面请求均为空。
- `git diff --check` 通过。未改共享渲染器、版本号或用户已有的 IDE 文件，
  未构建安装包、未验证正式服务和不同 DPI 的真实多屏硬件。

首次专项调试修正的是验收时序和工具兼容：移动夹具等待 50ms 采样真实送达，
可访问性检查沿用 Electron legacy mode；抚摸专项收起按钮先悬停 100ms，
等待原生鼠标穿透热区更新，再点击并确认已收起，避免漏掉首次点击。
这些修正不改变生产采样频率或现有热区行为。
