# @linxin666/dsh-client-ui-task-board

[English](README.md) | 中文

运行以宿主为权威的任务，支持冻结指令、验收检查和调度。

面向 BharatCode 和 DeepSeek Harness 0.2.0-rc.2 的本地英文 fork。通过宿主插件清单安装生成的 tarball；组合包 patch 会注册插件。客户端包复用现有宿主 UI 和 ModuleLoader。



上游： https://github.com/zhu1090093659/dsh-web.git

固定的上游修订： `4c9d58741eedced1265e26bfb04105c0ca343ba4`. 原始许可证： Apache-2.0; 参见 LICENSE 及随附的第三方声明。规范源代码保存在 integrations/workflows/upstream checkout 中。

验证：通过了 833 项测试；跳过了一项可选外部测试；已重建原生宿主/客户端组合包。

使用匹配的 harness 包，通过 package.json 中的脚本构建。验证未使用真实项目、GitHub 或 Zotero 数据。
