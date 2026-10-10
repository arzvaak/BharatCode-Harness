# dsh-zotero-plugin

[English](README.md) | 中文

搜索 Zotero 参考资料、查看笔记和附件并导出 BibTeX。

面向 BharatCode 和 DeepSeek Harness 0.2.0-rc.2 的本地英文 fork。通过宿主插件清单安装生成的 tarball；组合包 patch 会注册插件。客户端包复用现有宿主 UI 和 ModuleLoader。

需要运行中的 Zotero 桌面本地 API 或已配置的 Zotero Web API 文献库。未访问个人文献库。

上游： https://github.com/evanliu3594/dsh-zotero-plugin

固定的上游修订： `25016b08c83d4600044da5548167a95461412423`. 原始许可证： MIT; 参见 LICENSE 及随附的第三方声明。规范源代码保存在 integrations/workflows/upstream checkout 中。

验证：包含 10 个规范工具；已通过本地 HTTP fixture（测试前置数据）和真实 ToolRuntime 检查。

使用匹配的 harness 包，通过 package.json 中的脚本构建。验证未使用真实项目、GitHub 或 Zotero 数据。
