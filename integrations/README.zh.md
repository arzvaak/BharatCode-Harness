# BharatCode 英文集成

[English](README.md) | 中文

本目录负责 BharatCode 工作流 UI 中经过审查的本地 fork 和原创插件。SearXNG 暂缓。项目编辑器、阅读器、上下文交接和 shell 仍由 Harness 负责；工作流插件通过其原生服务添加能力。

`registry.json` 记录已启用的包及通过验证的归档。所有交付的 UI、设置、帮助/错误消息、工具描述和指令均为英文。语言标识符、协议键、用户文档和获许可的第三方内容保持其原有身份。供应商库可以包含其他语言数据，但不会将其呈现为产品 UI。

使用 `node integrations/scripts/prepare-preview.mjs` 准备隔离的链接预览。其 home 位于宿主原生文件系统上，以保证仅所有者可访问的凭据权限有效。预览使用独立 Engram 数据库，不复制账号或会话历史。使用该 DSH_HOME，通过 `dsh --profile integrations` 启动。此轮运行的确切位置见 `artifacts/preview-profile.json`。

使用 `npm ci --ignore-scripts --prefix integrations` 安装小型辅助依赖，再通过原生 profile 管理器安装归档包：

```sh
node integrations/scripts/install.mjs --home /path/to/DSH_HOME --profile web --cli /path/to/dsh --dry-run
node integrations/scripts/install.mjs --home /path/to/DSH_HOME --profile web --cli /path/to/dsh
```

更改 profile 前，关闭目标宿主或等待其正在运行的会话结束。安装器将 profile 元数据保存到 integration-backups，并将依赖解析、加锁和兼容性验证交给 Harness，然后激活已启用的声明组合包和原生 Plugins 管理 UI。之后重启应用。通过验证的归档会复制到基于校验和的路径，以防 pnpm 在重建后复用陈旧归档。若 pnpm 要求批准原生依赖构建脚本，请检查 profile workspace 文件中的具体包；此轮运行在隔离验证 profile 中批准了 onnxruntime-node 和 protobufjs。Desktop 使用已初始化的 desktop profile；开发时可以传入编译后的 CLI bin.js。

Provider Hub 使用原生凭据和订阅适配器。模拟认证、配额、刷新和推理测试与真实用户订阅登录分开。API 计费使用经核查的提供方特定费率；自定义网关和订阅路由在提供自身费率前保持未计价。配额指示器不是现金余额。

Zero 的初始 Safe 模式保存可恢复的原文并压缩重复文本。其计数器描述投影变化，而非已证实的计费节省。Visuals 位于共享 Settings 中，卸载时保留原生回答渲染。Tool Call Guard 修复向外发送的历史工具调用中格式错误的内容，同时保留规范 transcript（文本记录）和有效块。

范围、命令、原生 profile 结果及尚未完成的账号/平台验证见 PLAN.md 和 VERIFICATION.md。

最终集合包含 17 个包。Coding 添加 GitHub 审查和 LSP Actions；Research 添加 Zotero、Library、Browser Playwright 和 DeepRead；Writing 添加 Novel Continuity；Task Board 提供任务跟踪。[LSP 设置](workflows/LSP-SETUP.md) 固定并配置本地 TypeScript/JavaScript 服务器。Zotero、需要认证的 GitHub 和模型驱动的研究仍需要用户自行配置。
