<div align="center">

# dsh-engram · 记忆宫殿

[English](README.md) | 中文

<p align="center">为 BharatCode Harness 提供跨会话长期记忆：将记忆宫殿的 <b>信息架构</b>（而非神经科学隐喻）引入 agent（智能体）：<b>以位置为索引</b>（每条记忆固定在一个 <code>room#slot</code> 坐标）、<b>以固定路线为顺序</b>（游览路线仅追加）、<b>长期复用骨架</b>（同一主题始终进入同一房间和索引），以及 <b>每个标记都唯一</b>（铭牌规则：唯一 · 鲜明 · 带日期）。配合间隔重复的检索练习（只给线索，绝不给正文）与知识飞轮（捕获 → 强化 → 提炼 → 衰减）。纯 TypeScript：没有外部进程，也不依赖 Python。</p>

<p align="center">
  <a href="https://github.com/kenz1117/dsh-engram/blob/main/LICENSE"><img alt="GitHub license" src="https://img.shields.io/github/license/kenz1117/dsh-engram"></a>
  <a href="https://github.com/kenz1117/dsh-engram"><img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/kenz1117/dsh-engram"></a>
  <a href="https://www.npmjs.com/package/@kenz1117/dsh-engram"><img alt="npm version" src="https://img.shields.io/npm/v/@kenz1117/dsh-engram"></a>
  <a href="https://www.npmjs.com/package/@kenz1117/dsh-engram"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@kenz1117/dsh-engram"></a>
  <a href="https://github.com/kenz1117/dsh-engram/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/kenz1117/dsh-engram"></a>
  <a href="https://github.com/kenz1117/dsh-engram/graphs/contributors"><img alt="GitHub contributors" src="https://img.shields.io/github/contributors/kenz1117/dsh-engram"></a>
  <a href="https://awesome-dsh-plugin.com"><img alt="Awesome DSH Plugin" src="https://awesome-dsh-plugin.com/badge.svg"></a>
</p>

</div>

---

## 快速开始

```sh
dsh plugin --profile web add @kenz1117/dsh-engram
```

安装后无需配置（存储和模型缓存默认为 `~/.dsh/engram`；开启档案注入，关闭自动捕获）。

## 宫殿结构：目录就是房间，路径就是路线

记忆宫殿真正有效的是其 **信息架构**，而非生物学机制：机器可以使用前者，而 AI（人工智能）既没有后者，也不需要它。归纳起来只有四件事：

```
Grand hall · core memory   few and stable, always present      the profile injected every turn (entry cap + token budget)
  │
Corridor · route index     pick the room first, never scan the whole store   room directory + engram_search room=
  │
  ├─ Fact Hall              fact        what the user said
  ├─ Preference Pavilion    preference  tastes and preferences
  ├─ Decision Chamber       decision    decisions and agreements
  ├─ Episode Gallery        episode     experiences and timeline
  └─ Skill Workshop         skill       methods and techniques        capacity 9 per room, overflow opens "<name>-2"
  │
Placard · marker rule      unique · distinctive · dated      scored on write; low scores enter the refurb list
```

| 宫殿原则 | 插件中的实现 | 代码 |
|---|---|---|
| 以位置为索引 | 写入时分配到 `room#slot`；容量为 9（7±2），溢出时开新房间，位置永不回收 | [src/palace/slots.ts](src/palace/slots.ts) |
| 以固定路线为顺序 | `tour_routes` 仅追加；`engram_tour mode=fixed` 按位置顺序遍历整个宫殿 | [src/store/sqlite.ts](src/store/sqlite.ts) |
| 长期复用骨架 | 同一主题始终进入同一房间和索引，因此回忆是顺序提取，而非重新搜索 | [src/palace/slots.ts](src/palace/slots.ts) |
| 每个标记都唯一 | 铭牌评分为 0-1：全局唯一 +0.4 / 日期锚点 +0.3 / 房间内无 6 字符前缀冲突 +0.3 | [src/imagery/score.ts](src/imagery/score.ts) |
| 复习纪律 | SM-2 间隔重复；检索练习返回线索和铭牌，但 **绝不返回正文** | [src/review/sm2.ts](src/review/sm2.ts) |

感官和情感维度（气味、温度、情感权重）有意不参与评分：它们是对人脑先天局限的补偿，而 AI 既没有这些局限，也没有这种需要。

## 功能

- **跨会话记忆**：会话开始时注入用户记忆档案（条目上限和 token 预算均可配置；通过 `engram_profile_edit` 维护的人工整理档案优先于推导事实），让 agent 自然了解你是谁、正在构建什么；工具可以跨会话回忆事实。
- **双作用域存储**：`user.db` 全局共享；`project-<hash>.db` 按 git origin 身份隔离（无 git 时回退到工作目录编码；旧存储自动迁移）。个人偏好跟随用户，项目约定跟随仓库。
- **混合检索**：通过 RRF 融合 FTS5（unicode61 + 中文 2-gram 预分词）与本地向量（`Xenova/bge-small-zh-v1.5`，512 维，q8），再沿关系边扩展一跳，并以最近程度和证据进行乘法排序加权；嵌入模型离线运行，下载失败时降级为仅关键词检索并明确标记。
- **记忆宫殿信息架构**（v0.7.2+）：四条原则都在核心路径上实现，并非展示层装饰：**以位置为索引**（写入按类型分入房间并固定 `room#slot` 坐标；房间容量为 9，溢出时开新房间，位置永不回收）；**以固定路线为顺序**（`tour_routes` 仅追加；`engram_tour mode=fixed` 按位置顺序遍历整个宫殿）；**长期复用骨架**（同一主题始终进入同一房间、同一索引，因此回忆是顺序提取，而非重新搜索）；**每个标记都唯一**（铭牌规则评分为 0-1：全局唯一 +0.4 / 日期锚点 +0.3 / 房间内无 6 字符前缀冲突 +0.3；低分条目进入整修列表；活跃记忆少于 8 条的宫殿不扫描，避免小存储噪声）。
- **走廊路由检索**：档案包含房间目录，`engram_search` 接受 `room` 参数：先确定房间，再在其中搜索，而非始终对整个存储运行 RRF。前 5 个命中携带同房间相邻位置的 id，作为编码特异性线索。
- **检索练习循环**（间隔重复）：`engram_review_queue` 返回宫殿坐标和铭牌线索，但 **绝不返回正文**，迫使模型先回忆；`engram_review` 揭示条目，`engram_report grade`（0-5）进行自评，推进 SM-2 计划（1 → 6 → round(prev × ease) 天，失败时重置，ease 下限为 1.3）。纳入复习计划的条目 **不再参与自动衰减**，其去留由回忆决定。会话开始时的注入报告到期记忆数。
- **历史回填**（v0.7.3+）：逐轮次将 dsh 持久化的历史会话提炼进宫殿；每个会话写入与 **其自身 cwd** 匹配的项目存储（不跨项目混入），复用实时捕获的节流、脱敏和回声抑制，并以 `(session, turn)` 幂等键支持中断后恢复。回填条目永不进入今日到期队列。**由你选择导入规则**（时间窗口 / 每会话轮次数 / 总轮次预算 / 辅助模型 / 是否包含 subagent、seeded、无 cwd 会话），运行前可查看零成本估算（不调用 LLM（大语言模型））；导入在专用 **「Backfill」标签页** 准备，显示进度（包括 **跳过原因明细**）并支持暂停。辅助调用默认 **复用你当前使用的模型**（历史会话日志记录当时的提供方和模型，这里可能已不可用），也可在标签页的「Auxiliary model」下拉框中明确选择宿主注册的提供方和模型。
- **知识飞轮**：捕获/保存 → 矛盾候选（高相似度邻居在写入时建立 `contradicts` 边，由模型/用户裁决）→ 命中强化（置信度 +0.05）→ 提炼（主题簇合并为更高层规则、替代链、置信度继承）→ 衰减（重要性低且长期未访问的条目归档，可恢复）。
- **自动信念整合**（v0.7.14+，默认关闭；yml `reflect: suggest|auto`）：会话结束后，辅助 LLM 将尚未作为任何信念证据的原始记忆整合成一句话的 **观察**。与提炼不同，原始记忆全部保留；观察是 **额外的抽象层**：每个信念携带证据 id 列表和证据计数，同主题信念按向量邻近度（余弦 ≥0.9）自动合并，因此同一个信念会 **持续细化**，而非重复生成。当新证据靠近已有信念（≥0.86）时，信念变为 `stale`，下次整合将其原始证据重新交给模型进行新鲜度复核，结果有四种：`form`（新建）、`refine`、`still`（仍成立）、`refute`（保留其证据链以供审计）。`auto` 模式在会话结束后后台整合（5 秒超时，失败不影响对话）；`suggest` 模式仅将待整合任务入队，由 `engram_reflect` 工具处理并清空（任何模式下也可手动调用）。证据计数最多的前 3 个活跃信念随档案包注入；陈旧或已反驳的信念永不注入。Schema 升级为 v12（observations 表；增量迁移，无数据移动）。
- **Jev System-One 裁决**（v0.7.12+，默认关闭，yml 中的 `jev` 块）：DEFER 模糊区间的三路裁决（merge / accept / defer）和矛盾边确认可委托外部 Jev 模型；Jev 不可用时（网络失败 / 超时 / 缺少密钥）静默回退到纯规则四路行为，**绝不阻塞写入**。每次裁决留下一条附带观察（判定、Jev 是否参与、耗时、回退原因；进程内最多 50 条，重启清空），面板的「Jev」视图因此能直接回答「为什么这条被暂缓」。五个 yml 字段（开关 / API 密钥 / 端点 / 模型 / 超时）可在面板覆盖（存储在 `<dbDir>/jev-config.json`，0700 目录中的 0600 文件），保存后无需重启立即生效；「Test connection」按钮用当前输入验证端点和模型可达性（未保存值按输入测试，不写入覆盖文件）；GET 仅返回密钥掩码，明文不离开进程，也不回填输入框。三个阈值仍是仅可在 yml 配置的高级设置，以只读方式显示。
- **实体词典**（v0.7.10+）：自动捕获和 `engram_save` 的辅助 LLM 输出同时提取实体提及（人物/项目/工具/概念，可选别名），以规范化名称对照现有实体名称/别名解析；命中时复用实体并刷新「最后提及」时间，未命中时新建；记忆与实体建立多对多关联，保存在源记忆所在存储。`engram_search` 行携带命中的实体标签；实体解析失败时静默跳过关联，绝不阻塞记忆写入。面板的「Entities」视图按类型筛选、搜索名称/别名，并可打开实体查看关联的全部记忆。
- **自动捕获**（启用 `ingest` 时）：每个新轮次的第一步从会话日志中的上一轮次提取候选事实，会话结束也捕获最后一轮次（失败会留下 pending 键，由下一会话回放；按会话+轮次保证幂等），以低置信度写入；嵌入可用时，按四状态规则对邻近条目进行处置（重复陈述合并强化 / 疑似矛盾连边并暂缓 / 新内容写入）。无需你说「记住这个」，记忆也会积累。
- **来源审计**：每条记忆记录源会话、轮次和事件 seq；`engram_review` 追踪完整来源链、替代链、矛盾与操作日志；所有写入/编辑/遗忘/提炼/衰减均进入操作日志表。
- **Web 管理面板**（v0.7.0+）：Settings 中的「Memory Library」标签页有九个视图：Today（概览栏：记忆 / 开放 / 清晰度 + 健康环，底部四项小统计（创建 / 发掘 / 整理 / 今日到期）与脉动时间戳同行；随后是游览建议、房间目录、整修列表、健康明细；侧列档案卡展示人工整理档案的当前内容和版本差异历史）、Palace（含今日到期的筛选、游览路线排序、批量操作、列表与编辑；复习/编辑对话框呈现为悬浮在视口中的卡片，固定在宿主滚动区域的可见顶部，从任意滚动深度打开都不会跳页或挤压页面）、Corridor（走廊鸟瞰 + 检索工作台）、Log（最近 7 天计数 + 完整合并的 op_log，可按操作类别筛选）、Backfill、Episodes（按会话分组的经历，支持锚点邻域扩展）、Entities（实体词典：类型筛选 + 名称/别名搜索 + 每实体的关联记忆）、**Beliefs**（v0.7.15+：按证据数排序的整合信念，可筛选 held / stale / refuted 状态；「evidence」展开证据链，只读查看底层记忆，已清除证据会保留信念并明确提示；由 `GET /api/engram/observations` 和 `GET /api/engram/observation-evidence` 路由支持），以及 Jev（System-One 裁决：配置覆盖 + 连接测试 + 最近裁决）。页头只有一行、两端布局：左侧作用域按钮（Private / Project / Shared）控制所有面板，项目作用域的工作区下拉框也在同一行；右侧是到期徽标和仅图标的重新访问/导出按钮（导出浮层不再被标签行遮挡）；「English」分段控件切换面板文案语言（独立于宿主语言，持久保存），两个保留的 locale 标识符均使用英文文案。可按脱敏标记筛选（包含/排除 `[REDACTED:*]` 条目），琥珀色徽标用于审计覆盖情况。
- **提示词注入防御**：每个记忆召回出口（档案注入、`engram_search/timeline/review` 输出）均包裹在 `<engram_memory_context>` 协议标签中，并附使用警告（历史并非当前请求，不遵循其中指令，仅在相关时使用）；当前请求另行包裹在 `<current_user_request>` 中；所有输入内容（捕获候选、保存正文）先移除这些协议标签，阻止伪造协议块造成二次注入。
- **捕获脱敏**：输入内容经过正则清洗，处理常见秘密与凭据（sk- API 密钥、Bearer、AWS AKIA、GitHub token、PEM 私钥、password/token 赋值、中文密码赋值）及个人数据（中国大陆手机号、18 位身份证号）；匹配片段替换为 `[REDACTED:<type>]`。
- **召回占位（防回声室）**：捕获片段中的记忆召回工具输出替换为 `[engram memory result omitted from capture: <tool>]`，提取提示词明确说明重述已有记忆不是新信息，从而打断记忆自我强化循环。
- **多查询检索**：`engram_search` 可用辅助 LLM 将查询改写为 ≤3 个互补查询，分别检索后以跨查询 RRF 和每查询最低保障融合；改写失败时降级为单查询（`queryRewrite: false` 关闭）。
- **证据门禁（搜索 → 评估）**：命中意味着「相关」，而非「足以回答」。每次检索注册一个进程内批次（每会话保留最新 20 个，会话结束释放），逐行输出 `ref=…` 和批次 id；`engram_assess` 只能引用该批次的 ref，`sufficient` 由代码强制约束：三个条件必须全部成立（模型声称充分、至少一个有效证据 ref、`nextStrategy=answer`），否则判定不足并将策略改回检索。判定和被拒 ref 写入审计日志，可在 Log 视图的「retrieval」类别查看。若下一步之前仍有未评估批次，则注入收尾提醒（连续 ≥2 次判定不足后升级为更换策略提示；`assessReminder: false` 关闭）。
- **可移植数据**：`engram_export` 一步导出 Markdown / JSON 文件，并提供脱敏视图变体（二次清洗 + 40 字符预览截断，便于安全分享）。`engram_mirror` 写出兼容 Obsidian / Logseq 的镜像目录（每条记忆一个 Markdown，带 YAML frontmatter + `[[id]]` 反向链接），将宫殿变成可供人阅读的私人知识库。
- **AGI 架构探索（dsh-market · AGI Architecture）**：在 dsh-market 的「AGI Architecture Exploration」分类中列出，将 agent 长期记忆重新置于认知科学框架中：记忆宫殿（意象标签 + 房间铭牌）、走廊拓扑（力导向图）、闭环提问（ingest 提示词引导模型提澄清问题）、整合合并（启发式去重 + 余弦相似度）。它与 MemGPT / Letta 一同参与「agent 记忆架构」讨论。

## 工具（21 个，参数精简）

| 工具 | 用途 |
|---|---|
| `engram_save` | 保存（**四状态写入处置**：重复陈述合并到已有条目并强化（`merge`，不建新节点），疑似矛盾写入并建立待裁决的 `contradicts` 边（`defer`），新内容写入（`accept`），低熵内容丢弃（`drop`）；没有嵌入时全部为 `accept`）；`items` 数组在一次调用中保存 ≤10 条，共用清洗和批内去重，报告每项处置（`disposition`/`mergedInto`），单项失败不阻塞其余项（`count`/`items`/`failed` 概述）；`placard` 附加标记（按唯一 · 鲜明 · 带日期评分；低分给出改写提示）；`entities` 携带实体提及（随记忆解析并关联到实体词典） |
| `engram_search` | 语义 + 关键词混合检索（命中强化置信度）；`room` 通过走廊路由，只在一个房间搜索；前 5 个命中携带同房间相邻位置线索，命中行带关联实体标签；`asOf` 提供时间点回溯，仅计算当时有效的实体事实，行尾携带关联实体在该时点的事实。输出行有 `id=` 和 `ref=`，末尾有批次 id |
| `engram_facts` | 实体事实链读写。写入模式接受 `facts` 数组（≤50 项，每项为 `entity`/`entityId` + `content`）；`replaces` 替代旧事实（软失效，保留历史链）；错误条目进入 `failed`，不打断其余项。查询模式接受 `entity`（按名称；未命中不创建实体，歧义列出候选，近似命中建议替代项）或 `entityId`（精确）；`includeInvalid` 返回包含失效事实的完整链，`asOf` 筛选该时点有效的事实 |
| `engram_assess` | 证据门禁：回答前判断检索内容是否充分。提交 `batchId` + ≤8 个 `evidenceRefs`（仅该批次输出的 `ref=` 值）+ `missing` + `nextStrategy`；代码要求 `sufficient` 满足全部三个条件（声称充分、至少一个批内有效证据 ref、`nextStrategy=answer`），否则判定不足并将策略改回检索；其他批次的 ref 被拒绝并列出，判定写入审计日志 |
| `engram_timeline` | 时间线浏览：默认按创建时间降序；`order: 'tour'` 改为固定游览路线的位置顺序（输出带宫殿坐标，路线外条目排最后），让 agent 可以重新走一遍路线 |
| `engram_episode_timeline` | 经历记忆专用时间线：按日期范围和源会话浏览经历，以会话分组（最新组在前，组内按时间顺序；`sessionId` 深入单个会话；组标题携带捕获期间或会话结束时生成的一句话会话摘要）。`around` 设置为记忆 id 后切换为时间邻域扩展，列出锚点创建时间前后 ± 一个窗口（`windowMinutes`，默认 60）内的经历，回答「那时附近还发生了什么」 |
| `engram_update` | 修正条目（替代链）；也可重新附加 `placard` 标记 |
| `engram_forget` | 遗忘（软删除，可恢复） |
| `engram_report` | 报告结果（优先用于 skill（技能）类型条目）：成功 +0.05 / 失败 -0.1，长期无用的记忆自然衰减。提供 `grade`（0-5）时改为推进 SM-2 复习计划，作为检索练习的自评入口 |
| `engram_review_queue` | 今日到期队列：宫殿坐标（`room#slot`）、铭牌和逾期天数，但 **没有正文**；先回忆，再揭示，然后自评 |
| `engram_review` | 审计单条：来源链、替代链、矛盾、操作日志 |
| `engram_stats` | 全存储统计和信号比例；携带房间目录（每房间已占位置数及最新铭牌） |
| `engram_examine` | 渐进揭示：按 id 批量获取完整铭牌（建议 ≤16；先检索 id） |
| `engram_neighbors` | 走廊遍历：从一个房间沿关系边走 1-3 跳，返回邻居概述 |
| `engram_tour` | 游览路由：`mode=fixed` 按固定位置顺序遍历整个宫殿（恒定路线，顺序提取）；`mode=thematic` 围绕主题规划 3-7 个停靠点 |
| `engram_audit_forgotten` | 封闭翼区考古：列出近期关闭条目及其墓志铭，复核过去的遗忘是否合理 |
| `engram_ingest_history` | 历史回填：逐轮次将过去的 dsh 会话提炼进宫殿（按 cwd 存储；跳过已捕获轮次）。每个会话的轮次捕获完毕后，辅助 LLM 生成一句话会话摘要，用于时间线组标题（实时会话在 dispose（资源释放）时捕获最终轮次后生成相同摘要；失败静默且不阻塞）。`dryRun` 默认 true（仅估算）；传入 `dryRun=false` 执行。大批量使用 Settings 的「Backfill」标签页 |
| `engram_export` | 导出 Markdown / JSON 文件（数据可移植性）；`redactedView: true` 输出脱敏视图（二次清洗 + 40 字符预览截断，可安全分享） |
| `engram_distill` | 提炼：将同主题簇合并为更高层规则（LLM） |
| `engram_reflect` | 信念整合：将未整合原始记忆抽象为有证据支持的高层信念（form/refine/still/refute 四动作；向量近邻自动合并；原始记忆保持活跃）。也处理并清空 reflect=suggest 创建的待整合队列 |
| `engram_profile_edit` | 编辑人工整理档案块：`view` 显示当前内容和版本历史；`edit` 写新版本（通过 `expectedVersion` 乐观锁定，冲突明确报错）；`rollback` 恢复历史版本（追加为新版本，绝不改写历史）。人工整理档案先于推导档案注入；每次编辑进入操作日志，面板 Today 视图的档案卡显示版本差异 |

## 配置

可选配置（cordis.yml）：

```yaml
- id: dsh-engram
  name: '@kenz1117/dsh-engram'
  config:
    dbDir: '~/.dsh/engram'          # store and model-cache root directory
    injectProfile: true             # inject the user memory profile at session start
    profileTopN: 8                  # injection entry cap (1-64)
    injectTokenBudget: 1024         # injection token budget (128-8192; CJK text counted at 1.5 tokens/char, other text at 4 chars/token; entries that still don't fit degrade to index lines)
    injectItemBudgetStart: 160      # graduated budget: body chars for the first entry (40-2000, decayed per entry; truncate first before degrading)
    injectItemBudgetDecay: 0.9      # graduated budget: per-entry decay factor (0.5-1)
    injectItemBudgetFloor: 24       # graduated budget: per-entry body char floor (8-200, must not exceed start)
    assessReminder: true            # evidence-gate nudge: inject an engram_assess reminder before the next step when unassessed search batches exist
    modelCacheDir: '~/.dsh/engram/models'  # embedding model cache directory
    hfEndpoint: 'https://huggingface.co'   # model download endpoint; set a mirror behind restricted networks
    ingest: 'off'                   # automatic capture: off | light (user messages only, ≤2/turn) | eager (assistant messages too, ≤5/turn)
    reflect: 'off'                  # automatic belief consolidation: off | suggest (only enqueue on session end; drain via engram_reflect) | auto (consolidate in the background after the session); engram_reflect stays manually callable in every mode
    # provider and model must be given as a pair: aux-LLM route override for capture/distill (parsed from the session log by default)
    # provider: 'deepseek'
    # model: 'deepseek-v4-flash'
    decayAfterDays: 30              # decay: last access older than this many days (also the recency-boost decay window)
    decayImportanceBelow: 0.3       # decay: and importance below this → archive (restorable)
    rankRecencyWeight: 0.2          # retrieval recency boost weight (0-2, 0 disables)
    rankProofWeight: 0.1            # retrieval hit-count boost weight (0-2, 0 disables)
    queryRewrite: true              # engram_search rewrites ≤3 queries via the aux LLM and fuses them with RRF (degrades to a single query on failure)
    autoSlot: true                  # write-time auto-sloting (sort by kind into rooms, pin `room#slot`, register on the tour route)
    reviewScheduling: true          # write-time enrolment in review scheduling (first due in 1 day; off = new entries never enter the SM-2 queue)
    # History-backfill defaults (initial values for the tab and the tool; the total-turn cap is a hard ceiling you can only lower per run)
    historyBackfillDays: 7                  # default time window in days; 0 = unlimited
    historyBackfillMaxTurnsPerSession: 20   # default max turns per session
    historyBackfillMaxTotalTurns: 200       # hard cap on turns per run (1-5000)
    historyBackfillIncludeSubagents: false  # exclude subagent sessions by default
    historyBackfillIncludeSeeded: false     # exclude seeded sessions by default
    historyBackfillIncludeNoCwd: false      # exclude sessions without cwd by default (they can only go to the user store)
    # Jev System-One adjudication (off by default; enabling requires an apiKey; failures silently degrade to the pure-rule four-way behavior)
    # DEFER fuzzy-band three-way ruling: probability ≥ deferMergeAbove → same memory (merge), ≤ deferAcceptBelow → different (accept), in between stays defer;
    # before a defer lands, contradiction edges are confirmed by Jev first (an edge is created only at probability ≥ contradictMinProbability).
    jev:
      enabled: false                        # switch
      # apiKey: ''                          # Jev API key (Bearer auth)
      # baseUrl: 'https://api.typesafe.ai'  # official endpoint, POST /v1/systemone
      # model: 'jev-latest'                 # adjudication model name
      # timeoutMs: 3000                     # per-request timeout in ms (1000-60000)
      # deferMergeAbove: 0.85               # fuzzy-band probability ≥ this → same memory (merge)
      # deferAcceptBelow: 0.15              # fuzzy-band probability ≤ this → different (accept)
      # contradictMinProbability: 0.8       # contradiction confirmation probability ≥ this → create the contradicts edge
    # The five fields above (enabled/apiKey/baseUrl/model/timeoutMs) can be overridden from the panel's "Jev" tab (stored at <dbDir>/jev-config.json, field-level override, effective immediately on save); the three thresholds are configurable only here
```

## 工作原理

插件分为宿主部分（Node）和浏览器部分（React）：

```
Session agent                              Host half (Node)
  │                                          │
  ├─ every turn, first step ◀─────────────── ├─ user memory profile injection (plugin-source user snapshot)
  ├─ engram_save / search / review … ──────▶ ├─ SQLite dual stores (user.db / project-<origin hash>.db)
  │                                          ├─ FTS5 keyword track + local vector track, RRF fusion + ranking boost
  ├─ engram_distill ───────────────────────▶ ├─ aux-LLM distillation (cluster merge → supersedes chain)
  ├─ session end (reflect enabled) ────────▶ ├─ belief consolidation (unconsolidated evidence → observations: near-neighbor merge / stale review)
  │                                          └─ automatic capture: session log → candidate facts (incl. the final turn at session end; ingest on)
  └─ Settings "Memory Library" tab ◀──────── ─── loopback API /api/engram/* (writes verify loopback Origin)
```

- **双作用域存储**：`user.db` 全局共享；`project-<hash>.db` 以规范化 git origin URL 的哈希命名（`git@github.com:a/b.git` 和 `https://github.com/a/b` 共用一个存储；worktree 通过指针解析主仓库 origin）；没有 git 或 origin 时回退到工作目录编码，旧的以 cwd 命名的存储在启动时原地重命名（若两者均存在，则不移动，记录警告）。
- **宫殿结构（目录就是房间，路径就是路线）**：**大厅** 是每轮次注入的常驻核心档案（少而稳定，始终存在）；**走廊** 是档案中的房间目录与 `engram_search room` 参数（先选房间，再搜索）；**房间** 按类型排列（Fact Hall / Preference Pavilion / Decision Chamber / Episode Gallery / Skill Workshop），容量为 9，溢出进入 `<name>-2`；**铭牌** 是每条记忆的 `placard` 标记，按唯一 · 鲜明 · 带日期规则评分。现有存储首次打开时分配位置（幂等；开新房间会记录警告，让人可以为其命名）。
- **自动捕获**（开启 `ingest` 时）：每个新轮次的第一步从会话日志上一轮次中提取候选事实；会话结束（`session/disposed`）以 5 秒超时捕获最终轮次，失败/超时时在操作日志留下 pending 键，由下个会话第一步回放；已捕获的（session, turn）对保证幂等。读取真源是会话日志；辅助调用请求审计进入插件自身操作日志，绝不向会话日志追加未知事件。候选以低置信度写入，并按嵌入去重。
- **来源归属链**：每条记忆记录源会话、轮次和事件 seq，可通过 `engram_review` 完整追踪；操作日志表记录每次写入/编辑/遗忘/提炼/衰减。
- **离线嵌入**：模型只下载一次（q8，约 50MB；镜像端点可配置），之后完全离线运行；失败时插件继续工作，检索降级为仅关键词并明确标记。
- **UI 本地化**：客户端部分通过宿主 locale 服务注册 zh/en 字典，实时跟随宿主语言设置；数据层枚举（status/kind）仅在展示层映射，存储中保持英文。

## Web 管理面板（Settings →「Memory Library」标签页）

具有 webServer 的 profile（web 等）会自动在 **Settings** 中出现「Memory Library」标签页（通过 `settings.section` slot 注册；客户端部分是经宿主模块表从 `lib/client.js` 加载的 React 组件）：统计卡片、按状态/类型/内容筛选、内联详情与编辑（通过替代链）、遗忘/恢复、Markdown/JSON 导出。数据经 loopback API `/api/engram/*` 流动（写入验证 loopback Origin）。没有 webServer 的 profile（headless 等）跳过面板；其他能力不受影响。

从 v0.7.2 起，Today 视图以 **「Due today」卡片** 开始：每条到期记忆仅显示线索（`room#slot` · 铭牌 · 逾期天数），按「Reveal placard」后才显示正文，再自评为 Remembered / Hazy / Forgot（对应 SM-2 评分 5/3/1）以推进计划。复习到期时，**红色页头徽标** 显示数量并直达该卡片；回答后数量减少。Palace 列表增加 **「By tour route」** 排序开关，按固定位置顺序遍历记忆，每行显示宫殿坐标。

从 v0.7.3 起，有专用 **「Backfill」标签页**：你选择全部导入规则（时间窗口 / 每会话轮次数 / 总轮次预算 / 是否包含 subagent、seeded、无 cwd 会话），按「Re-estimate」零成本查看候选会话和待处理轮次（不调用 LLM），再启动。运行时显示进度（会话 / 轮次 / 已写入 / 已跳过 / 失败），可随时暂停；完成轮次按幂等键跳过，因此重新启动即可恢复。同一版本将面板重构为五个视图（Today / Palace / Corridor / Log / Backfill）：常显的九格管理栏折叠成 Today 顶部概览卡（三个主指标 + 最近 7 天计数 + 健康环），首页只保留待办（今日到期、整修）和参考（房间目录、游览建议）；走廊鸟瞰和检索工作台移至 Corridor；Log 成为可按 writes / capture / retrieval / organize 筛选的完整页面；五类房间在标签、房间目录和走廊节点中各用一种色调（fact 蓝 / preference 紫 / decision 青 / episode 橙 / skill 洋红）。展示列表改为紧凑行：细分隔线代替卡片，两行正文，操作按钮在悬停（或键盘聚焦）时出现，窄屏时换行到正文下方，每屏大约可显示两倍行数。整修列表不再扫描活跃记忆少于 8 条的宫殿，避免小存储噪声。

从 v0.7.4 起，面板进一步打磨：Today 改为「左侧游览建议，右侧房间目录 + 今日到期 + 整修列表」，游览建议和房间目录的行更宽松；Palace 工具栏将搜索 + 状态 + 排序排成一行，房间筛选独占可换行标签行；Log 将计数与类别筛选合并为一个工具栏，每行标记类别圆点（writes / capture / retrieval / organize）；Backfill 的规则、估算和运行块用细分隔线区分，不再使用有底色的估算框；章节间距完全来自容器 gap，消除了标题紧贴上方卡片、却远离下方卡片的不对称。

从 v0.7.5 起：两项底层修复和一项新能力。① 档案注入 token 估算识别 CJK（CJK 按每字符 1.5 token，其他文本每 token 4 字符）；旧「length / 4」算法对中文低估超过 4 倍，导致中文用户注入经常超出 `injectTokenBudget` 17%–50%；末尾 `+N more` 计数行现在也计入预算，确保注入不超出承诺。② 新增 **证据门禁** `engram_assess`（17 个工具）：命中表示「相关」，并非「足以回答」。`engram_search` 每次调用注册进程内证据批次（每会话最新 20 个，会话结束释放），逐行输出 `ref=` 和批次 id；`engram_assess` 只能引用该批次的 ref，`sufficient` 由代码强制约束：模型声明、至少一个有效证据 ref、`nextStrategy=answer` 必须全部成立，否则判定不足并将策略改回检索；其他批次的 ref 被拒绝并列出，判定进入审计日志（Log 的「retrieval」类别中可见）。③ Log 补齐操作标签和详情格式（整合 / 复习回答 / 分配位置 / 回填位置 / 开新房间），替代原始操作名与 JSON。

从 v0.7.6 起，作用域不再硬编码，项目宫殿跟随工作区。① **捕获时按候选选择宫殿**：提取现在输出 `scope`；与当前项目/仓库相关的内容（技术选择、项目约定、架构决策）进入该项目存储，跨项目材料（个人偏好、习惯、用户自身历史）进入私有存储。实时捕获（上一轮次、dispose 时最终轮次、pending 回放）与历史回填共用规则，回填将每个会话归入 **其自身 cwd 的** 存储。幂等键（`ingest-done` / `ingest-pending`）留在私有存储，与记忆落点解耦，所以实时与回填共享一套 `(session, turn)` 键，不会跨路径重复导入。② **项目宫殿跟随工作区**：`GET /api/engram/workspaces` 列出可选项目宫殿（宿主工作区注册表 → 会话头出现过的 cwd → 插件进程目录，按存储名去重，因此同一仓库的多个 worktree 共用宫殿），每个项目作用域端点接受 `?project=<dbName>`（未知选择器返回 404）；`engram_save/search` 等根据当前会话 cwd 解析项目存储。面板在三个作用域分段下增加一行，显示 **活跃工作区标签和工作区选择器**（默认「跟随当前工作区」，可固定到单个工作区），切换工作区会切换全部视图。③ 无 git 时，项目存储名从「cwd 前 12 字符」（兄弟目录会冲突）改为 **完整 cwd sha256**，旧存储启动时重命名；卸载插件现在关闭全部存储连接（Windows 不再出现锁定 `.db` 文件）。

从 v0.7.9 起进入记忆分层阶段。① **可编辑档案**：新 `engram_profile_edit` 工具（19 个工具）维护人工整理档案，即你明确认可的记忆，提供 `view`（当前内容 + 版本历史）、`edit`（乐观锁，冲突明确报错）、`rollback`（将历史版本恢复为新追加版本，绝不改写历史）；注入时人工整理文本先于推导档案，优先占用 token 预算，每次编辑进入操作日志，面板 Today 视图档案卡展示版本差异。② **专用经历时间线**：新 `engram_episode_timeline` 工具按日期范围与源会话浏览经历，`around` 设为锚点 id 时切换为时间邻域扩展（锚点时刻前后 ± 一个窗口内的经历），回答「那时附近还发生了什么」。③ **面板「Episodes」视图**：记忆库标签页新增第六个视图，按会话分组列出经历，每项有「Nearby」动作，一键展开时间邻域卡片。④ **会话摘要组标题**：历史回填在每会话轮次捕获后要求辅助 LLM 生成一句话摘要，实时会话在 dispose 时成功捕获最终轮次后也生成摘要（复用活跃路由；失败静默），写入 `session_summaries` 表；时间线组标题携带摘要（工具输出、API 和面板标题均可见），复核时间线不再需要逐项展开。

从 v0.7.10 起引入实体层（时态事实图第一批）。① **实体提取并入辅助调用**：自动捕获和 `engram_save` 的辅助 LLM 输出携带 `entities` 提及（名称必填，≤80 字符；类型 person/project/tool/concept/other；别名可选），以规范化名称（去除首尾空白 + 合并空白 + 小写）对照现有实体名称/别名解析；命中时复用实体并刷新「最后提及」时间（词典按此降序排列），未命中则创建；记忆↔实体关联幂等写入，与源记忆保存在同一存储；实体解析失败时静默跳过关联，记忆仍会写入。② **第七个面板视图「Entities」**：分页词典（最后提及降序），显示每实体活跃关联记忆数，提供类型筛选、名称/别名子串搜索，以及每实体的「View」展开（实体记录 + 近期关联记忆）；新增 `GET /api/engram/entities` 和 `GET /api/engram/entity` loopback 路由。③ **检索与导出携带实体**：`engram_search` 命中条目携带关联实体（id + 标准名称）；`engram_export` JSON 视图包含实体词典。Schema v9 → v10（entities + node_entities 表，启动自动迁移；保留现有数据）。

从 v0.7.12 起，插件集成 **Jev System-One 裁决**（默认关闭，yml 的 `jev` 块），并新增第八个面板视图 **「Jev」**：DEFER 模糊区间三路裁决和矛盾边确认可委托 Jev，Jev 不可用时（网络失败、超时、缺少密钥）静默回退到纯规则四路行为，不阻塞写入。面板覆盖五个 yml 字段（开关、API 密钥、端点、模型、超时），保存在 `<dbDir>/jev-config.json`（0700 目录内的 0600 文件），保存立即生效：裁决器在每个组装点重新读取覆盖，无需重启；三个阈值仍为仅可在 yml 设置的高级配置，面板只读显示。密钥安全：GET 响应只返回掩码（长度大于 8 时显示末 4 字符），明文不离开进程，输入框不回填。无密钥开启开关会自动降级为关闭；损坏的覆盖文件视为空覆盖，下次面板保存即可修复。Jev 标签页另有「Test connection」动作（填入密钥后即可验证端点和模型可达性；未保存输入按原样测试，不写入覆盖文件）和「Recent adjudications」卡片（进程内最近 50 次裁决：判定、Jev 是否参与、耗时、回退原因；重启清空），无需猜测「为什么这条被暂缓」。

v0.7.13 修复 DSH 0.1.7（原生会话格式 v4）每轮次失败的问题（[#5](https://github.com/kenz1117/dsh-engram/issues/5)）：v4 停用 `kind: "plugin"` 消息来源包装（仅迁移历史 v3 会话时改写为 `plugin:<package>`；携带它的原生 v4 事件会被 `assertV4MessageSources` 拒绝），两个注入位置（档案快照和评估提醒）恰好使用该停用结构；启用 engram 后，每个新轮次都因 `format v4 message requires a producer-owned source kind` 失败。现在来源由生产方拥有（`plugin:<package>`，与 DSH 自身 v3→v4 迁移产物一致；其他归属字段不变），内部辅助调用消息来源也采用相同形式。跳过自身注入快照的三个读取位置从精确相等放宽为 `plugin` 前缀匹配，因此历史 v3 与 v4 结构都能识别，插件绝不导入自身注入（自我污染）。0.1.5（v3 会话）不受影响；在 0.1.7 上升级至 0.7.13 前保持 engram 禁用。

## 开发

```sh
pnpm install            # postinstall symlinks @deepseek-ai/* peers from ../deepseek-harness (run pnpm install && pnpm run build in the harness repo first)
pnpm test               # unit + composition tests; real-embedding e2e runs when ENGRAM_E2E=1 (HF_ENDPOINT configurable) and the network allows
pnpm typecheck
pnpm bundle
```

## 模型体验

### 请求上下文与条件

#### 模型看到的内容

每轮次第一步追加插件来源的用户快照：`User memory profile (dsh-engram, cross-session) — Grand Hall (always present):`，随后是用户作用域记忆列表（默认最多 8 项、预算 1024 token；超预算条目降级为 `#id` 索引行；`injectProfile: false` 关闭），每行携带宫殿坐标（`room#slot`）；复习到期时追加一行报告到期记忆数。工具结果是纯文本行（带 `id=`、scope/kind 注释、位置坐标、矛盾候选提示和降级说明）。自动捕获与提炼各执行一次辅助 LLM 调用（独立于主对话路径计费，并记录用途归属）。

#### Token 影响

档案注入是有条件的固定成本（同时受条目上限和 token 预算约束）；工具 schema 是常驻成本（20 个参数精简的工具）。

#### KV Cache 影响

档案文本随记忆存储变化；变更仅在新会话或记忆更新后的轮次边界生效；会话内注入内容不变时前缀保持稳定；工具 schema 恒定，绝不影响前缀。

## 已知限制与暂缓工作

- **矛盾检查默认不调用 LLM**：写入按向量相似度（≥0.88）报告候选并连边；语义矛盾确认留给模型/用户裁决与提炼。可选 Jev 裁决（面板「Jev」标签页或 yml `jev` 块）将模糊区间和矛盾边交给外部裁决器，Jev 不可用时回退到默认行为。
- **嵌入器降级期间写入的记忆没有向量**：模型就绪前写入的记忆不参与语义路径；语义功能上线后执行一次 `pnpm backfill` 回填已有向量（在 `pnpm build` 预热模型缓存后；`HF_ENDPOINT` 可配置）。

## 路线图

宫殿 IA（以位置为索引 / 固定路线 / 检索练习）是索引与审计骨架；它分三个阶段演进为 AI 原生记忆分层和时态事实图。实际版本每次递增 0.0.1；阶段标签仅为规划代号：

- **阶段 1 · 飞轮闭环**（已完成，v0.7.8）：四状态写入处置（ACCEPT 新建 / MERGE 原地强化 / DROP 低熵 / DEFER 矛盾待定；`engram_save` 和捕获逐项返回）；逐级衰减注入预算（首项 160 字符，后续每项 ×0.9，下限 24，全部可配置）；脱敏扩展至中文密码、身份证号和手机号；证据门禁收尾提醒（轮次结束仍有未评估搜索批次时注入提醒）。
- **阶段 2 · 记忆分层**：可编辑档案（**已完成，v0.7.9**：`engram_profile_edit` 工具支持版本链回滚和面板差异审计，遵循 Letta 核心记忆模型）；经历记忆专用时间线索引（**已完成，v0.7.9**：`engram_episode_timeline` 工具支持日期范围、按会话分组、时间邻域扩展和专用经历索引；面板「Episodes」视图及捕获期间、实时会话摘要组标题同批推出）；自动信念整合（**已完成，v0.7.14**：observations 表（schema v12）记录证据链和证据计数；会话结束通过 `reflect: suggest|auto` 触发；近邻合并持续细化同一个信念；对陈旧内容以 form/refine/still/refute 四动作复核新鲜度；活跃信念随档案注入；手动 `engram_distill` 仍可用）；可配置房间容量和铭牌评分（默认值不变）。
- **阶段 3 · 时态事实图**：实体表和写入时提取解析（**已完成，v0.7.10**：entities + node_entities 表；捕获/保存辅助输出携带实体提及，写入时解析；`engram_search` 命中带实体标签；面板「Entities」视图 + 实体 loopback 路由）；携带 `valid_at` / `invalid_at` 窗口、冲突软失效的事实级三元组（**已完成，v0.7.11**：facts 表（实体 + 时间窗口 + `replaced_by` + 源记忆），捕获辅助输出携带事实，按规范化实体名匹配入表，`replaces` 声明软失效链，`engram_search` 新增 `asOf` 时间点回溯，`engram_facts` 工具读写事实链，面板实体页显示事实链详情）；自动创建 supports / refines / related 边；在 CI 中以 LoCoMo-zh 评估子集作为检索质量回归门禁（确定性的 Recall@k / MRR 指标）。

## 致谢

感谢让本项目变得更好的社区贡献者：

- **[@lujfsd](https://github.com/lujfsd)**：[PR #2](https://github.com/kenz1117/dsh-engram/pull/2)：适配新的 dsh `sessionPersistence` 读取句柄 API（上游移除 `load()`）、捕获时逐候选作用域（提取输出现携带 `scope`）、项目宫殿跟随活跃工作区（`GET /api/engram/workspaces` 与面板工作区选择器），以及将无 git 存储键从「cwd 前 12 字符」改为完整 cwd sha256（修复兄弟目录冲突）；附 17 个新测试和两份设计文档。
- **[@f0909172434](https://github.com/f0909172434)**：[PR #4](https://github.com/kenz1117/dsh-engram/pull/4)：治理旧数据库所有权歧义；eager 重命名现在写入 JSON 墓碑伴随文件（`<old db>.migrated-to`，以 0o600 独占创建，记录 `migratedTo` / `claimedByCwd` / `claimedAt`），之后命中同一旧名的工作区收到指出先前认领者的警告；新增 `legacyMigration` 配置（默认 `eager` 自动迁移 / `conservative` 警告并保留旧数据库不变），迁移结果细分为 `renamed` / `kept-both` / `deferred` / `already-migrated`。附测试。

## 许可证

[MIT](LICENSE) © 2026 KenZ (kenz1117)

### 旧项目数据库迁移

仅有旧文件名时，`legacyMigration: eager`（默认）保持自动重命名。私有 JSON 伴随文件 `<old filename>.migrated-to` 记录 `migratedTo`、`claimedByCwd` 和 `claimedAt`（ISO 时间戳）。之后使用相同截断旧文件名的工作区会收到指出先前认领者的警告。记录描述的是文件迁移，**并非每条记忆所有权的证明**。同 origin 的 worktree 继续共享同一个新数据库。

将 `legacyMigration: conservative` 设置在插件 `cordis.yml` 配置中，且在 **升级/打开旧数据之前** 完成，可保留旧数据库不变。Engram 发出警告，列出旧文件名和拟用文件名，并打开一个新的、初始为空的项目存储，使会话可以继续。若新旧文件共存，无论策略为何，都不会移动或合并。此模式无法撤销此前的迁移。

手动解决所有权之前，停止所有使用该目录的宿主，并备份数据库及其 SQLite 伴随文件。使用 `engram_review` / `engram_export` 复核/导出相关记忆。新存储可能已有新数据：**不要盲目把旧文件移过去覆盖它**。审计两个存储，并手动重新分配数据；不会执行自动分类、拆分、合并或删除。

指针包含本地工作区路径，应视为私有元数据。格式错误或无法读取的指针会停止迁移，以免静默丢失认领历史。将旧文件恢复到指针旁需要手动复核。重命名与指针创建是独立文件系统操作，并非事务或跨进程锁。指针写入失败会报告两个文件名；数据库已经移动，不会自动回滚。如果在两次操作之间崩溃，重试前检查两条路径。在此功能之前完成的现有迁移不会追溯补建指针。
