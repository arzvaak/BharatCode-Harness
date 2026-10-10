![社交预览](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/social-preview.png)

# dsh-context

[English](README.md) | 中文

[![npm version](https://img.shields.io/npm/v/dsh-context)](https://www.npmjs.com/package/dsh-context) [![GitHub stars](https://img.shields.io/github/stars/bowenliang123/dsh-context?style=social)](https://github.com/bowenliang123/dsh-context) [![dshfind](https://dshfind.com/api/badge/bowenliang123/dsh-context)](https://dshfind.com/en/plugins/bowenliang123/dsh-context?ref=badge)

**为 agent（智能体）提供上下文洞察与管理的最佳 [DeepSeek Harness 插件](https://www.deepseek.com/harness/)。**

[`dsh-context`](https://www.npmjs.com/package/dsh-context) 提供完整的上下文生命周期管理功能。
- **Context Insights 页面**：作为一级侧栏面板（与 Plugins 和 Automation tasks 并列）提供跨会话概览：KPI 栏包含 7 天 token/成本用量图、活动热图、汇总组成环，以及可筛选并直达任意会话的会话卡片。
- **Context 标签页**：DeepSeek Harness 上下文统计、组成、趋势、事件和消息的 UI 仪表板。
- **Context 面板**：将同一个仪表板呈现为右侧栏标签页（dsh 0.1.5-rc.1+）；在侧栏引导页选择 **Context**，面板便在聊天旁打开。
- **`/context` 命令**：斜杠命令展示当前上下文组成和近期上下文演变的上下文模型。

## 安装 / 更新

### 在 DeekSeek Harness Web 或桌面版安装

在 **Add plugin** 向导的搜索框填写 `dsh-context`，点击 **Install**：

![添加插件向导](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/add-plugin-wizard.png)

### 使用 `dsh` CLI 安装

安装 [`dsh-context`](https://www.npmjs.com/package/dsh-context) 插件，使用 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)：

```sh
dsh plugin --profile web add dsh-context
```

或者更新 `dsh-context` 插件：

```sh
dsh plugin --profile web update dsh-context@latest
```

然后用 `dsh web` 启动 Web UI。无需构建步骤，也无需重启。

## 使用

四个入口，讲述同一个过程：agent 携带什么、这些内容如何进入上下文，以及它如何使用这些内容：

| 入口 | 提供的内容 |
| --- | --- |
| **Context Insights 页面** | 一览每个会话的用量、成本、缓存命中、每日活动和每会话上下文概况；可按范围、日期、分组或搜索筛选，一键进入。 |
| **Context 标签页** | 每个会话中的完整仪表板：统计、组成、逐请求趋势、事件、文件活动和 agent 网络。 |
| **`/context` 命令** | 居中弹窗，提供相同组成和上下文浏览器，无需离开聊天。 |
| **Preferences 卡片** | 每用户默认设置：视图位置、趋势粒度与模式、File Activity 排序等。 |

## 🗂️ Context Insights 页面

点击侧栏面板列表中的 **Context Insights**（与 **Plugins** 和 **Automation tasks** 同级），页面便以完整中央列面板打开：

![Context Insights 页面](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-dashboard.png)

| 区域 | 回答的问题 |
| --- | --- |
| **KPI 栏** | 用了多少：所选范围（7d / 30d / all）内的会话数、计费 token、估算成本和缓存命中率。 |
| **7 天用量图** | 何时花了多少：最近 7 天每天的计费 token 和估算成本，以一对柱展示，根据会话自身请求时间逐轮次汇总（而非会话最后活跃日期）。 |
| **活动热图** | 何时实际工作：最近 8 周每日计费 token；点击某天，筛选当天活跃的会话。 |
| **设置入口** | 热图下的一行；与 Context 标签页 Plugin Info 卡片相同，经过保护检查后跳转至本插件偏好设置。 |
| **Context Composition** | 上下文窗口用在何处：汇总所选范围内会话的组成。 |
| **会话卡片** | 每会话概况：组成环、计费 token、轮次、成本，以及工作区组 / 项目面包屑；按最近程度、token 或上下文大小排序，可搜索，按工作区分组。点击卡片打开会话。 |


## 📊 Context 标签页

打开任意会话，点击 **Context** 标签页：

![Context 面板概览](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-overview.png)

| 卡片 | 回答的问题 |
| --- | --- |
| **Context Stats** | 轮次、步骤、人工输入、实时工具调用、会话缓存命中率，以及按 models.dev 标价估算的成本（悬停 `?` 查看每百万费率；识别 DeepSeek 高峰/非高峰时段）。 |
| **Token Stats** | 计费 token 用在何处：总量与输入区下的聊天统计行相同，按组成（系统、工具、消息等）拆分，以提供方精确输出补齐组成环。 |
| **Timing Stats** | 活跃时间如何分配在模型调用、工具运行和额外开销之间。 |
| **Current Context** | 窗口 *此刻* 包含什么。 |
| **Context Trend** | 每次请求的大小及其过程。 |
| **Context Browser** | 任意请求 *实际* 由什么组成。 |
| **Context Events** | 窗口何时、为何变化。 |
| **File Activity** | agent 对文件 *做了什么*。 |
| **Agent Network** | 实时展示整个 agent 家族。 |

主要占用率和组成使用 **与聊天输入区上下文环相同的官方 token 计量投影**（`contextPressure` / `contextBreakdown`），因此数字始终与环显示的一致。

### Context Stats

#### Token Stats 和 Timing Stats
![Token_Stats_与_Timing_Stats](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/token-stats-and-timing-stats.png)

#### Context Stats
![Context_Stats](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-stats.png)


### 🧱 Current Context：上下文窗口现在包含什么

![Current Context 卡片](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/current-context.png)

相对模型完整窗口的六色堆叠条（斜线 = 可用余量）：系统提示词、工具 schema、用户消息、注入上下文、助手回复、工具结果，每项均有 ≈token 数与占比。对话开始退化时，可在这里看到 *哪一部分* 是原因。

### 📈 Context Trend：上下文如何随轮次或步骤增长和演变

![带步骤简述的 Context Trend](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-trend.png)

每次模型请求一条堆叠柱，粒度比逐消息更细，让你逐轮次观察窗口增长：

- **✨ Step brief**：图表下三行简明说明：**User** 回顾开启轮次的消息，**In** 列出新进入的内容（通常是之前的工具结果），**Response** 显示回复和/或所调用工具。点击一行，在 Context 浏览器打开该条消息。
- **✂ 标记事件**：压缩（compaction）与裁剪固定在发生时对应的柱上，下降的原因因而清晰可见。
- **按你的方式阅读**：**Step / Turn** 粒度，**Total**（累计组成）或 **Delta**（每请求带正负号的变化），并可横向滚动整个会话。Delta 模式下，增长堆叠在基线上方，压缩下降至基线下方：

![Delta 模式的 Context Trend](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/history-delta.png)

- **悬停与固定**：移动即可查看即时提示；点击固定完整明细，估算旁显示提供方报告的 **Actual Prompt / Output / Cache**。
- **实时联动**：悬停柱体时，在图表旁 Context 浏览器预览该步骤组装的上下文；离开图表恢复你自己的选择。

### 🧭 Context Browser：打开任意请求的内容

选择 **Live (next request)** 或任意保留步骤，浏览请求的组成：七个可折叠类别展开后，每个元素独占一行，显示其 token 成本；每个元素再次展开可查看 **实际内容**，即系统提示词、每工具的 JSON schema、消息文本、推理、工具参数和输出。skill（技能）内容（available-skills 目录、`/skill` 调用、`skill` 工具加载）单独归入 **Skill Injections** 类别，因此隐蔽 skill 的上下文占用无法藏在注入上下文和工具结果类别中。

- **各工具由谁提供**：每个工具 schema 行尽力显示来源标签：第一方 `tool-*` 包、`dsh-*` 能力包、`mcp:<server>` 代理，或从 `tools.register()` 实时观察到的确切插件。按 **大小 / 名称** 排序，每类别可按自身可搜索字段筛选：

![带来源标签、筛选和排序的工具 schema](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-browser-tools.png)

- **按类型筛选助手回复**：助手类别搜索框带 **Thinking / Tools / Answer** 标签，各自显示当前步骤的消息数（一条回复可含多种）；点击只保留匹配回复，再次点击清除：

![带类型筛选标签的助手回复](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-browser-assistant-kinds.png)

- **工具结果展开为完整调用**：工具名、参数和 **OK/error** 状态，结果正文、行数以及 **Raw / Markdown** 开关：

![带 Raw/Markdown 开关的展开工具结果](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-browser-tool-result.png)

- **图像载荷呈现为卡片**：缩略图包含名称、尺寸、存储大小和官方 DeepSeek 图像 token 估算（dsh 多模态流水线，例如 `read_image` 结果和图像附件）：

![呈现为缩略图卡片的图像载荷](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-browser-images.png)

- **与上一轮次比较**：每类别带正负号的变化徽标（`+N` 项、`±Nk` token）让你一眼看出轮次新增或回收了什么。早于压缩的步骤从已移除消息归档重建；步骤组成仅为近似时，卡片会说明。

### ⚡ Context Events：窗口何时、为何变化

![含压缩事件的 Context Events](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-events.png)

每次注入、压缩、裁剪、模型切换和计划模式切换均标出生产方（指令文件、插件 id、skill 名）、净 token 变化（压缩显示回收量）、轮次/步骤和时间。**Inject / Compact / Prune / Switch / Mode** 标签按类型筛选日志，各自带整个会话的事件总数。

### 📁 File Activity：agent 对文件做了什么

![File Activity](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/file-activity.png)

每个被访问文件（读取、写入或搜索）一行，汇总至你在趋势图中选择的步骤：

- **按用途计数**，页头标签兼作筛选（**Read / Written / Searched / Images**），并提供路径搜索框。
- **行数变化**：每次 `edit`/`write` 贡献估算 `+added / −removed` 占用，按文件显示并汇总。
- **所有模式均计入**：原生工具、Minimal preset 的 `str_replace_editor`、PTC `run_code` 程序中的嵌套调用都汇总为逐工具行。
- **搜索落到真实文件**：匹配文件有自身的操作行和命中数。
- **点击一行** 展开完整操作日志，每项操作都直达 Context 浏览器中的确切工具结果。
- **点击文件名** 在右 Sidebar 打开预览（dsh 0.1.5-rc.1+），行为与内置 Files 侧栏完全相同：相同查看器、每文件一个标签页。没有该列的 harness 仍像之前一样在系统中打开文件。

### 🕸 Agent Network：家族全貌

![带两个 subagent 的 Agent Network](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/agent-network.png)

当前 agent、其父级和每个 subagent，每个 agent 一个节点，用彩色边表示血缘，在一张图中展示多级委派。每个环是该会话组成，按窗口占用率缩放；悬停查看 token、请求、计费和活跃时间；点击进入该会话自己的 Context 标签页。运行中的 agent 显示绿色呼吸脉动。

## ⌨️ `/context` 命令

输入 `/context`（或在 `/` 菜单选择）并按 Enter：

![带 context 命令的斜杠菜单](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-command-entry.png)

居中对话框打开，包含 **Current Composition** 卡片和 **Context browser**，使用与标签页相同的组成条、逐步骤选择器和 `vs previous turn` 差异徽标：

![ /context 弹窗](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/context-command.png)

## ⚙️ 设置

**Context** 偏好卡片保存本插件的每用户设置：默认位置、趋势粒度（Step/Turn）、趋势模式（Total/Delta）、趋势时长曲线（默认显示）、工具和 File Activity 排序，以及侧栏洞察入口。位置取决于 dsh 版本：

- **dsh 0.1.7+**：侧栏 **Plugins** 入口 → **dsh-context** 组合包页面 → **Configuration** 区域（卡片由入口的实时 Config 表单提供）。
- **较早版本**：**Settings → Plugins → Plugin configuration** → **Context** 卡片。

图表和卡片中的开关仅属于当前视图，绝不覆盖已存偏好。

![Context 设置卡片](https://raw.githubusercontent.com/bowenliang123/dsh-context/main/docs/settings.png)

## 需要了解的事项

- **估算与实际值**：类别数字使用 dsh 自身的固定密度启发式算法（与内置 token 计量器相同）；固定的趋势详情在旁显示提供方报告的实际值，Token 卡片将 ≈ 估算的组成份额与提供方精确计费总量配对显示。
- **兼容性**：支持 `@deepseek-ai/dsh` **0.1.5-rc.1+**（`0.1.5` 系列从 rc.1 起，`0.1.7` 系列从 rc.2 起，`0.2.0` 系列从 rc.2 起），同一条按数据结构驱动的代码路径覆盖 V3（`0.1.5-alpha.x+`）和 V4（`0.1.6/0.1.7/0.2.0+`）会话日志世代。各版本矩阵及验证方式：[docs/compatibility.md](docs/compatibility.md)。
- **I18n**：两个保留的 locale 标识符都使用英文 UI。

## 喜欢吗？

如果 `dsh-context` 帮你了解 agent 携带的内容，欢迎在 [GitHub](https://github.com/bowenliang123/dsh-context) 点一颗 ⭐，也欢迎提交 issue/PR！

## 许可证

[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)

## BharatCode 工作流集成

本地集成保留上游 Apache-2.0 许可证以及 `dsh-context` 的包、schema、命名空间和 locale 标识符。两个受支持的 locale 字典均显示英文。现有偏好字段和依 locale 而定的货币选择均保留。宿主和浏览器组合包从此源码重新构建；侧栏页面、会话 Context 标签页、右侧栏、斜杠命令和 Plugins 配置卡片使用真实 Harness 服务与 slot 约定。

本地验证以工作流 checkout 作为 `DSH_REPO`，运行包含 0.2.0-rc.2 的真实源码兼容性矩阵。此集成不迁移任何用户会话日志或 profile。Context 仅显示并汇总现有上下文证据。
