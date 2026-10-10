# BharatCode Subscriptions

[English](README.md) | 中文

`dsh-plugin-subscriptions` 0.9.7 的本地英文 fork。通过原始提供方适配器支持 Codex（ChatGPT）、Claude、Grok（X Premium）、GitHub Copilot 和 Google Antigravity。OAuth、设备授权、token 刷新、账号池、模型发现和用量 RPC 仍由适配器负责。

将 `@arzvaak/bharatcode-subscriptions` 与 Provider Hub 安装到同一个 profile。宿主路由 ID 仍为 `codex`、`claude`、`grok`、`copilot` 和 `antigravity`；UI slot 仍为 `subscriptions`。重命名后的浏览器 loader 工厂与此 fork 的包标识匹配。英文字符串注册在两个现有语言 ID 下。

Provider Hub 复用本包的设置组件和真实 `subscriptions-auth` RPC 注入。Copilot 设备授权在打开验证网站前显示用户代码。每位用户都需要自行完成提供方授权。 Google Antigravity 登录和令牌刷新还要求通过 `antigravity.clientId`/`clientSecret` 或 `ANTIGRAVITY_CLIENT_ID`/`ANTIGRAVITY_CLIENT_SECRET` 显式配置 OAuth 客户端，且该注册须获提供方授权。软件不内置第三方应用客户端密钥，也尚未实现 Google CLI 凭据导入。显式配置客户端不代表账号具备使用资格，亦不代表实时登录已验证。可用性取决于其套餐、提供方账号及当前上游服务限制。

`npm run build` 编译宿主和原生浏览器产物。`npm test` 执行模拟适配器、授权、刷新、翻译、路由、用量及客户端测试。本地验证使用隔离 fixture（测试前置数据）home 和假凭据；未验证真实账号登录或真实提供方推理。

此 fork 在本地打包；未发布任何内容。原始 MIT 许可证保留在 LICENSE 中。

订阅授权现在使用宿主原生凭据服务（`dsh-plugin-subscriptions/accounts`，schema 版本 1）。全部五个提供方路由和账号设置页使用同一序列化记录。首次账号操作时，若原生记录不存在，则从现有 subscriptions 认证文件或更早的 router 位置一次性导入。旧文件保持不变，作为可恢复备份；运行时不再向其写入 token。空原生记录表示退出登录，并防止旧账号重新出现。不受支持的原生 schema 和凭据服务失败会直接报告，不回退到文件。独立的显式文件辅助函数仍供维护工具使用。
