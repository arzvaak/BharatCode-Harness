# BharatCode 英文工作流集成

[English](README.md) | 中文

八个固定修订的插件 fork 为现有 UI 添加写作连贯性、细读、本地资料库、引用检索、GitHub 审查、语言服务器操作、浏览器研究和任务板。`registry.json` 记录每项源修订、包、tarball、校验和、组合包 patch、用途、测试结果和限制。规范源代码及原始许可证保存在 `upstream/`；可编辑的 fork 位于 `packages/`。

使用原生宿主插件清单安装 tarball，并组合其声明的组合包 patch。GitHub 和 Task Board 提供 ModuleLoader 浏览器工厂。GitHub 使用原生 `settings.section` slot；Task Board 添加其现有导航和执行界面。其他六项提供宿主工具，并复用现有工作区、阅读器和写作 UI。

小说包明确是 dsh-novel-writer 规范项目/章节/设定/连贯性引擎的有界 fork。DeepRead 明确是原有提取、分片综合分析、JSON 重试、报告、PDF、预算、缓存和校准引擎的有界 fork。省略了它们重复的工作台及无关模式。这些范围列于包 README 文件和注册表条目中。作者维护的描述、提示词、失败消息、配置帮助、续写分隔符及 UI 字典均为英文。输入识别器仍可识别多语言源文本，用户编写的源内容保持完整。

验证使用隔离的临时项目目录、mock GitHub/Zotero/模型服务、本地浏览器 fixture（测试前置数据）及现有缓存 Chromium。Task Board 通过 833 项检查（跳过一项可选测试），Library 89 项，LSP Actions 368 项（跳过九项），GitHub 185 项（跳过三项外部检查），Browser 47 项本地 fixture 检查。Zotero、Novel Continuity 和 DeepRead 各自通过真实 ToolRuntime 冒烟测试，包括注册和资源释放。不声称已验证真实认证服务或真实模型报告。

GitHub 的认证操作需要凭据。Zotero 需要其本地桌面 API 或已配置的 Web API 文献库。Browser 模型提取和 DeepRead 报告需要模型。LSP Actions 需要服务器映射或官方 LSP seam；默认空映射会报告英文不可用失败。此注册表旁可提供经过单独审查的 TS/JS 服务器辅助工具。原生应用验证由上层集成任务执行。
