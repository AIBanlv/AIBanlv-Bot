# standalone-runtime

目标：未扫码可显示公共形象；线上角色对话使用平台服务，本地角色使用自有模型。依赖 model-source。
命令：根目录 `npm test`；Demo 内 focused Node 测试及本地 Electron 夹具。
结构：electron/device-runtime.mjs、device-conversation.mjs、device-realtime.mjs、
device-text-conversation.mjs；公共角色目录与自有 session 模块；界面复用现有设置页。
风格：同现有 ESM；固定 schema、取消、超时及错误代码；不把密钥交给 iframe。
测试：fake provider/billing 检查自有链路零平台请求，绑定/掉线/积分矩阵与真实 Electron。
边界：本地能力不获得云账号权限；私有角色、账号、手机控制继续扫码鉴权。
公共形象：游客可用 GET /jwt/client/desktop-public/roles 查询无个人归属的公共角色，
忽略调用方身份参数，不携带设备 JWT；首次启动默认上官婉儿，不读取旧本地形象配置。
公共形象不随账号断连失效，但线上角色对话必须满足平台绑定和积分条件；公共接口沿用数据库并发/SQL 超时保护。
验收：默认上官婉儿及公共角色切换；不展示“本地伙伴”或本地编辑/导入入口，加载失败
显示原因及重试，不自动回退到二维形象。DeepSeek 可纯文字及本地
助手；自有 Realtime 直接用供应商凭据，不建立平台计费；平台模式继续用 JWT、票据
和原计费顺序。源码 Windows 验收，不构建安装包，不声称 Mac 运行验证。
供应商依据：https://help.aliyun.com/zh/model-studio/realtime 和 client-events。
自有 Realtime 使用可配置模型/音色、北京或新加坡 workspace endpoint；不复用平台私有音色。
