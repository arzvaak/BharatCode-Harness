# dsh-lsp-actions

[English](README.md) | 中文

使用诊断、格式化、符号、补全、签名帮助、内嵌提示和重命名功能。

面向 BharatCode 和 DeepSeek Harness 0.2.0-rc.2 的本地英文 fork。通过宿主插件清单安装生成的 tarball；组合包 patch 会注册插件。客户端包复用现有宿主 UI 和 ModuleLoader。

配置语言服务器或官方 LSP seam。默认的空服务器映射会报告 LSP_ACTION_UNAVAILABLE；服务器安装不属于本包范围。

上游： https://github.com/PerryLink/dsh-lsp-actions

固定的上游修订： `50468c8e1f9996078298e246615516b6574fabe4`. 原始许可证： Apache-2.0; 参见 LICENSE 及随附的第三方声明。规范源代码保存在 integrations/workflows/upstream checkout 中。

验证：通过了 368 项测试；跳过了 9 项依赖特定环境的测试。

使用匹配的 harness 包，通过 package.json 中的脚本构建。验证未使用真实项目、GitHub 或 Zotero 数据。
