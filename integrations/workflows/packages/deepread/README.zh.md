# dsh-deepread

[English](README.md) | 中文

提取本地或粘贴的资料，生成英文证据报告、书籍综合分析以及无需模型的预算估算。

面向 BharatCode 和 DeepSeek Harness 0.2.0-rc.2 的本地英文 fork。通过宿主插件清单安装生成的 tarball；组合包 patch 会注册插件。客户端包复用现有宿主 UI 和 ModuleLoader。

这是原有资料/PDF 提取、模型 JSON 重试、分片综合分析、预算、校准和 URL 缓存引擎的限定范围 fork。支持 quick/deep/book 模式，且仅使用英文。省略了重复 shell、批处理、图谱、Feynman、后台任务、随包 skill（技能）和自动磁盘导出。报告需要已配置的模型；估算不调用模型。

上游： git+https://github.com/xiehuan123/dsh-deepread.git

固定的上游修订： `9462f1e546b94a7f27e77abaf3d9ee3fedf7f746`. 原始许可证： MIT; 参见 LICENSE 及随附的第三方声明。规范源代码保存在 integrations/workflows/upstream checkout 中。

验证：已通过真实 ToolRuntime 的估算、本地文件读取、quick 和 book 报告、英文提示词/输出、schema 拒绝和资源释放检查。

使用匹配的 harness 包，通过 package.json 中的脚本构建。验证未使用真实项目、GitHub 或 Zotero 数据。
