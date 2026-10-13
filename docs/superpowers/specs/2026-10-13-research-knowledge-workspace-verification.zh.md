# 研究知识工作区验证

[English](2026-10-13-research-knowledge-workspace-verification.md) | 中文

日期：2026-10-13 分支：`implementation/research-knowledge-workspace` 实现源码：[维护中的分支](https://github.com/arzvaak/BharatCode-Harness/tree/implementation/research-knowledge-workspace)

## 交付行为

Research 现在提供原生知识库，包括主题主页、有界 Markdown 发现/搜索、笔记创建、应用内阅读/编辑、wikilink 和 Markdown 链接、反向链接、标题层级、来源阅读、精确片段引用、外部文件协调及可移植 Obsidian 知识库 ZIP。阅读使用已有安全 GFM/KaTeX 渲染，支持表格、公式、代码、脚注和图片。没有引入独立图形引擎。计算研究继续使用已有 notebook 任务、输入、取消和输出契约。

文件仍是普通 Markdown。发现不改写 front matter 或 `.obsidian/`。可移植引用脚注在导出中保留精确已保存来源副本。内部引用定位符仅在阅读模式隐藏。源码编辑保留元数据、wikilink、不支持语法和恢复草稿。模型工具可以查看知识库、创建笔记、提出来源支持的引用而不发布修改，并针对精确保存文本捕获引用。

模型保存后续改进增加了 `research_notes.store`：创建完整新 Markdown 笔记，可选已验证精确来源引用、独占文件创建、证据登记和重新读取回执。专门的模型 prompt 要求研究任务保存实质发现及关联主题概览、保留证据并查看已保存内容，而不只在聊天中留下知识。[工具指南](../../research-knowledge-tools.zh.md) 记录此流程。store 与已有笔记引用提案都会规范 Windows 路径，再生成可移植相对引用链接。

后续验证：相关测试通过 712 项，同样跳过三项可选 notebook 测试；Host/客户端完整 TypeScript 和暂存 lint 通过。最终修正已有笔记 Windows 提案后，工具及研究 Host 测试通过 26 项。模型 runtime 测试验证工具/prompt 组装、通过 UI 使用服务读取非空保存内容、精确引用、独占创建、无效/跨项目来源、超过限制的 UTF-8 内容、证据保存失败回执及 Windows 路径。本次后续改进没有提交真实模型请求或更新已安装应用。

## 自动化证据

在实现 checkout 中执行的命令：

```sh
node_modules/.bin/vitest run packages/api/workspace-controller/tests packages/workspace/workspace/tests packages/client/ui-workspace/tests scripts/client-bundle-purity.spec.ts --reporter=dot
node_modules/.bin/tsc -b tsconfig.host.json tsconfig.client.json --pretty false
BC_NOTEBOOK_TEST_PYTHON=/mnt/slow-stuff/deepseek/sidebar-fix-20261013/workflow-python/bin/python node_modules/.bin/vitest run packages/api/workspace-controller/tests/notebook-runner.host.spec.ts --reporter=dot
```

- 主要相关测试：46 个文件通过，一个可选 notebook 文件跳过；708 项测试通过，三项受环境条件限制的 notebook 测试跳过。
- 随后使用已有隔离 Python 环境运行三项 notebook 测试：全部通过，覆盖真实执行、单元格失败证据、环境身份和取消。
- 生成的 Remote 绑定重建后，完整 Host 和客户端 TypeScript 检查通过。纯 Markdown helper 被明确允许进入浏览器 bundle；Host 文件系统操作仍仅在 Host。
- 传输/浏览器纯净性/知识 UI 检查：增加精确源码编辑器验收案例前通过 61 项；上述完整相关测试已包含该案例。
- commit hook 运行了暂存 lint、空白及相关 manifest/notice 检查。

## 独立审核

新的审核者复现了引用标题混淆、嵌套链接重叠、重复根目录文件名、百分号编码文件名中的井号、第二引用位置及单个定位符导出失败。各项均修复并有回归覆盖。后续审核发现引用尾部换行和关联图片标签问题；这些也已修复和测试。代码字面内容不会变为反向链接或隐藏引用定位符。引用证据保存失败会保留已保存 Markdown，并返回可重试的不完整证据回执。

## 实际应用验证

独立预览仅使用合成电池研究项目和私有预览状态。它没有提交模型请求或修改已安装应用数据。

浏览器流程验证了：

1. 打开主题主页，并在应用内阅读关联笔记、表格、渲染公式和本地图表。
2. 创建 `notes/Findings.md`，插入 wikilink，阅读已保存来源并插入两个不同来源片段。两个脚注引用均渲染；保存报告文件及证据已保存。
3. 跟随反向链接，并通过脚注打开精确已保存修订。来源新鲜度与不可变内容分开显示。
4. 通过 Export to Obsidian 下载知识库。ZIP 完整性检查通过：九个文件，包括关联笔记、两个引用、已保存来源副本、图表和 notebook。不包含应用私有或 `.obsidian/` 元数据。
5. 外部修改已打开的干净文件：原生阅读器自动更新。存在未保存草稿时再次修改磁盘：草稿仍可阅读，保存被禁用，冲突要求比较磁盘内容。私有恢复也在开发预览重新加载后保留。
6. 查看桌面、720px 和 480px 布局。720px 时文档宽为 720px，阅读器滚动宽度等于客户端宽度；480px 时文档宽为 480px，阅读器为 382px 且无水平溢出。本地图片报告加载像素。临时 viewport 设置已重置。

## 本地工件与限制

截图和示例知识库保存在 `.artifacts/research-knowledge-workspace/`：`reader-desktop.png`、`reader-figures.png`、`reader-narrow.png`、`reader-compact.png`、`draft-conflict.png` 和 `research-vault-example.zip`。

示例知识库 SHA-256 为 `42e298c4b4a6e9ddb8a883210d631806b269c4dd8fffc6799d9d4a2f7267ae58`。兼容性 fixture 和 ZIP 在未启动 Obsidian 本身的情况下验证。这是实现和开发预览证据，不是安装包、已安装应用、跨平台发布或公开发布资格验证。Graph/Canvas、Obsidian 插件、云同步和新的二进制文档提取不在本实现范围。已有二进制资源预览继续可用。

按用户全局规则，发布准备、打包、资格验证、发布和安装必须委托给使用 `max` reasoning 的 `gpt-6-luna`。
