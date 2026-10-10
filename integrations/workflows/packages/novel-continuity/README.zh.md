# @bharatcode/dsh-novel-continuity

[English](README.md) | 中文

保存带版本的写作项目、章节上下文、设定集、变量和连贯性审查。

面向 BharatCode 和 DeepSeek Harness 0.2.0-rc.2 的本地英文 fork。通过宿主插件清单安装生成的 tarball；组合包 patch 会注册插件。客户端包复用现有宿主 UI 和 ModuleLoader。

这是上游核心及规范工具的限定范围 fork。省略了原有写作工作台、预设、角色包和重复 UI。章节目标保留上游的字符计数语义。通过配置 dataDir 隔离项目。

上游： https://github.com/akira399/dsh-novel-writer.git

固定的上游修订： `b9e49227aa70f7e42d8a348fc104180d2fe497e7`. 原始许可证： MIT; 参见 LICENSE 及随附的第三方声明。规范源代码保存在 integrations/workflows/upstream checkout 中。

验证：已通过真实 ToolRuntime 的项目、设定、章节、上下文、统计、审查和资源释放测试。

使用匹配的 harness 包，通过 package.json 中的脚本构建。验证未使用真实项目、GitHub 或 Zotero 数据。
