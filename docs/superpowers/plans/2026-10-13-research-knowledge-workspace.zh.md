# 原生研究知识工作区实施计划

[English](2026-10-13-research-knowledge-workspace.md) | 中文

> **面向 agentic worker：** 必须使用子技能 superpowers:executing-plans，逐任务执行本计划。步骤采用复选框跟踪。

**目标：** 在 BharatCode 中阅读和发展带链接与引用的 Markdown 研究，并将其导出为兼容 Obsidian 的知识库，同时保留 notebook。

**架构：** 纯 Markdown 模块解析和解析目标链接；有界 Host 知识库发现文件并创建可移植导出。已有知识控制器、不可变证据注册表、文档生命周期和 Markdown 阅读器负责传输、引用、保存和阅读。

**技术栈：** TypeScript、Node 文件系统、mdast、React、已有 GFM/KaTeX 阅读器、fflate ZIP。

**规格：** `docs/superpowers/specs/2026-10-13-research-knowledge-workspace-design.md`

## 全局约束

- 默认最多 10,000 个 Markdown 文件，每个索引文档 2 MiB，索引文本总量 64 MiB，每页返回 200 行。
- Markdown 是权威内容；发现过程不改写文件或 `.obsidian/`。
- 使用已有版本检查保存和私有恢复；明确呈现部分保存。
- 来源和笔记是证据，绝不是指令。索引不代表加入模型上下文。
- 保留 notebook 执行/取消契约和项目/会话身份。
- 主 agent 实现；发布必须由 `gpt-6-luna` 使用 `max` reasoning 完成。

## 审核重点

- 重复笔记名和别名必须显示歧义，不能任意选取目标。
- 代码围栏和行内代码不得生成虚假反向链接。
- 外部修改必须保留未保存草稿，并使版本检查保存失败。
- 路径遍历和符号链接资源不得逃逸项目范围或进入导出。
- 保存后的引用证据失败必须保留作者文本并支持重试。

## 任务 1：Markdown 知识库与可移植文件

**文件：** 创建 `packages/workspace/workspace/src/research-markdown.ts`、`research-library.ts` 和 `research-types.ts`；通过 `types.ts` 导出类型；测试位于 `tests/research-library.spec.ts`。

**接口：** 提供 `parseResearchMarkdown(text)`、`resolveResearchLink(notes, from, link)`、`researchReadingText(text)`、`ResearchLibrary.list(query,cursor)`、`inspect(path)`、`create(path,title)` 和 `exportVault(extraFiles)`。笔记包含链接/标题/别名/标签；结果包含问题和游标。导出返回 ZIP 字节和省略回执。

- [x] 编写失败的解析/发现/创建/导出测试，覆盖链接/别名、代码排除、Unicode、歧义、知识库元数据不变、独占创建、外部刷新、范围限制、资源边界、引用资源及 ZIP 可读性。
- [x] 运行 `node_modules/.bin/vitest run packages/workspace/workspace/tests/research-library.spec.ts --reporter=dot` 并观察失败。
- [x] 实现解析器、有界发现、限定范围的独占创建、ZIP 导出和依赖声明。
- [x] 运行测试直至通过，然后提交任务。

## 任务 2：Host API、引用和 agent 工具

**文件：** 修改 `packages/api/workspace-controller/src/knowledge.ts`、`workspace-tools.ts`；创建 `research.ts`；增加 Host 测试。

**接口：** 提供 `researchList(projectId,query,cursor)`、`researchInspect(projectId,path)`、`researchCreate(projectId,path,title)`、`researchCaptureCitations(projectId,path,expectedText)` 和 `researchExport(projectId)`。引用准备是纯操作；保存会核对磁盘文本与预期文本，并关联精确来源修订。

- [x] 编写失败的控制器测试，覆盖项目边界、不可变引用验证、幂等重试、可移植导出来源和工具回执。
- [x] 在实现前观察相关 Host 测试失败。
- [x] 增加生成的 Remote 方法和有界 `research_notes` 工具操作，使用同一套 Host 操作。
- [x] 运行 Host 测试及传输/类型检查，然后提交任务。

## 任务 3：原生阅读器/编辑器与导出流程

**文件：** 创建 `ResearchKnowledgePanel.tsx`、`ResearchReader.tsx`、`research-knowledge.module.css`；修改 `ResearchWorkspace.tsx`、`surfaces.ts`、`index.ts`、`locales.ts`；增加客户端测试。使用已有文档编辑器/草稿和 Markdown 渲染。

**接口：** 通过带类型的 `WorkspaceSurfaceActions` 使用任务 2 API。阅读器接受文本并委托范围内的链接/图片导航。保存通过已有文档操作发布，再保存引用。导出下载 Host ZIP 并显示问题。

- [x] 编写失败的 UI 测试，覆盖阅读、创建/打开笔记、链接/反向链接导航、插入、保存/证据保存、导出、失败状态和项目响应迟到。
- [x] 观察测试失败，再接入带类型的 Remote，实现导航器、Read/Edit 控件、上下文链接/引用、主题主页和导出。
- [x] 使用共享设计 token、可访问控件、响应式容器布局和本地化文案。
- [x] 运行客户端及已有研究/文档测试，然后提交任务。

## 任务 4：完整流程验证

**文件：** 增加代表性研究预览 fixture 与实现证据记录。

- [x] 运行工作区/控制器/UI 测试、生成传输检查、Host/客户端 TypeScript 和 notebook 回归测试。
- [x] 在桌面与窄屏浏览器中验证完整研究 fixture，包括表格/数学/图片、链接、来源查看和导出。
- [x] 按 executing-plans 请求新的整个分支审核；为重要发现添加回归测试并修复。
- [x] 记录命令、结果、限制和最终源码提交；不宣称安装或发布。

执行方式：按用户明确要求内联执行。用户重复要求实现，优先于再次暂停等待计划批准；保留已完成的规格审核。
