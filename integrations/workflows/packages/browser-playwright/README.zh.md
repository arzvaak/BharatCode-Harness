# dsh-browser-playwright

[English](README.md) | 中文

通过限定作用域的标签页、快照、截图和交互浏览并提取研究资料。

面向 BharatCode 和 BharatCode Harness 0.2.0-rc.2 的本地英文 fork。通过宿主插件清单安装生成的 tarball；组合包 patch 会注册插件。客户端包复用现有宿主 UI 和 ModuleLoader。

为已安装的 Playwright 浏览器配置 chromium 通道。模型提取需要已配置的模型。验证未访问外部网站。

上游： https://github.com/ChenyuHeee/dsh-browser-playwright

固定的上游修订： `57ebe45fb906b6977312a0c7562d407faee4b449`. 原始许可证： MIT; 参见 LICENSE 及随附的第三方声明。规范源代码保存在 integrations/workflows/upstream checkout 中。

验证：使用缓存的 Chromium 通过了 47 项本地浏览器 fixture（测试前置数据）测试；未执行真实网站测试。

使用匹配的 harness 包，通过 package.json 中的脚本构建。验证未使用真实项目、GitHub 或 Zotero 数据。
