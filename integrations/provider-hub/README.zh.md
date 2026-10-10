# BharatCode Provider Hub

[English](README.md) | 中文

为 BharatCode Harness UI 提供英文提供方设置。Providers 设置分区挂载订阅 fork 自身的 `subscriptions` 设置 slot，因此账号登录、配额刷新、设备码、错误和账号管理使用真实适配器实现。

将此本地包和 `@arzvaak/bharatcode-subscriptions` 安装到同一个 web 或 desktop profile。组合包的自激活 patch 挂载宿主入口；`lib/client.js` 注册原生 Harness 模块 loader 工厂。安装后重启 profile。

BharatCode 端点预设和自定义 OpenAI 兼容路由使用宿主的设置、凭据存储、模型发现及 LLM（大语言模型）适配器。密钥与 profile 配置分开保存。模型发现是目录证据；它不能证明提供方会接受推理（inference）请求。

使用 `npm run build` 构建。先运行 `npm test`，再运行 `DSH_SOURCE=<built-host> npm run test:composition`，通过真实 Loader、profile patch、凭据存储、模型发现和流式推理验证本地 HTTP fixture（测试前置数据）。运行 `DSH_SOURCE=<built-host> SUBSCRIPTIONS_SOURCE=<subscriptions-fork> npm run test:compatibility`，检查全部五个提供方的模拟登录、连接状态、配额刷新及错误处理。这些测试绝不登录真实账号。

原始 MIT 许可证保留在 LICENSE 中。

引导流程中的提供方设置是可选步骤。BharatCode 是默认端点/模型预设；Codex 和 Google 订阅按钮打开其原生订阅适配器，OpenCode 和 Mistral 使用各自的 API 密钥预设。用户可以继续而不配置提供方，之后通过 Settings → Providers 返回。

Muse 订阅会话通过官方 `@muse-code/sdk` MSP 连接到已安装的 `muse serve` CLI（命令行界面）。宿主仅在用户明确操作后启动 CLI，将工作区限制为已注册目录，并支持流式条目、审批决定、用户问题、后续请求及取消。Muse 自行管理订阅登录；BharatCode 不导入其凭据。当前此会话在 Muse 设置面板中运行，而非标准聊天模型选择器。已使用真实安装的 CLI 及其离线 echo 提供方完成检查；订阅推理仍需要用户账号。
