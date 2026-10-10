# @perrylink/dsh-github

[English](README.md) | 中文

审查 GitHub 仓库、issue、Pull Request、检查和差异。

面向 BharatCode 和 DeepSeek Harness 0.2.0-rc.2 的本地英文 fork。通过宿主插件清单安装生成的 tarball；组合包 patch 会注册插件。客户端包复用现有宿主 UI 和 ModuleLoader。



上游： https://github.com/PerryLink/dsh-github

固定的上游修订： `5bd360b3615c02f45c79c0a9709cd413930d1031`. 原始许可证： Apache-2.0; 参见 LICENSE 及随附的第三方声明。规范源代码保存在 integrations/workflows/upstream checkout 中。

验证：通过了 185 项测试；跳过了 3 项外部 E2E 测试。

使用匹配的 harness 包，通过 package.json 中的脚本构建。验证未使用真实项目、GitHub 或 Zotero 数据。
