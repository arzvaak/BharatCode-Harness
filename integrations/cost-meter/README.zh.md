# BharatCode Cost Meter

[English](README.md) | 中文

这是面向 BharatCode Harness UI 的 Cost Meter 1.8.12 英文 fork。对话、轮次和每日用量仍保存在原有账本及会话投影中。浏览器入口和统计分块注册此 fork 的原生 Harness loader 标识。

API 费用估算需要准确的提供方路由和模型价格。已知的直连 API 路由为 `openai`、`anthropic` 和 `deepseek`。自定义网关、BharatCode 路由、本地服务器、缺少提供方标识的路由及未知模型 ID 在用户配置实际路由费率前均不计价。模型厂商名称不能确定网关价格。确认路由费率后，通过 `prices.providers.<route>.models.<model>` 或明确的 `priceOverrides` 映射配置准确价格。

Codex、Claude、Grok、Copilot 和 Antigravity 的订阅用量归类为套餐用量。其 token 用量绝不会根据直连 API 费率表计入 API 金额。订阅配额状态来自提供方适配器，与估算 API 支出分开。未计价路由的金额账本值为零表示费用未知；轮次详情会明确显示未计价用量。

默认侧栏显示 token 用量，并以美元显示已明确计价的估算。官方提供方余额卡片、无关编码套餐及首次使用导览均关闭。由于侧栏不能确定当前提供方路由，因此省略全局计价时间条和提醒。仍尊重用户明确保存的币种选择。

默认直连提供方费率来源已于 2026 年 10 月 8 日核查。参见[计价范围](docs/bharatcode-pricing.md)。估算不包括工具、未报告用量、模态特定价格、协商折扣、税费及处理层级或地区附加费。实际价格不同时，请自行配置。DeepSeek Pro 保留其自身费率；已移除上游 fork 将 Pro 错当作 Flash 的假设。

使用 `npm run build` 构建。运行 `node --test test/bharatcode-pricing.test.mjs test/bharatcode-native.test.mjs` 检查准确路由计价、订阅分离、缓存和长上下文计费、未计价自定义路由、可配置费率、原生 loader 行为及持久化账本。原有上游测试仍位于 `test/`；其中部分断言上游的多语言和模糊计价行为，这些行为在此 fork 中已刻意改变。

原始 MIT 许可证保留在 LICENSE 中。本包是本地审查产物，尚未发布。
