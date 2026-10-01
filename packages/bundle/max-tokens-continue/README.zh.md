---
description: "当响应被提供方输出 token 上限截断时自动续写，让被截断的回答在同一轮内继续，而不是停在半句。"
kind: "package-bundle"
---

# @local/max-tokens-continue

[English](README.md) | 中文

## 概述

当响应被提供方的输出 token 上限截断时，本层让对话轮保持存活：其插件监视 agent 流中的 `max-tokens` 结束原因，并把一条简短的续写提示引导回**同一轮**。随附的 `web` profile 模板已包含它；其他 profile 只需把它列为一个组合包。历史永不改写，因此会话日志始终是唯一事实来源。该行的 `config` 设置预算与提示词。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

随附的 `web` 模板已经列出本组合包，因此全新的 `web` profile——以及 Electron 外壳用同一模板初始化的 Desktop profile——无需任何额外步骤即可挂载该行。其他 profile 通过在组合包列表中命名它，或通过 `dsh plugin add` 来获得它。

### 安装到 profile

路径安装会把包链接进 profile，并把它追加到该 profile 的组合包列表：

```text
dsh plugin --profile <name> add /path/to/packages/bundle/max-tokens-continue
```

也可以把 `@local/max-tokens-continue` 加入 profile 的 `dsh.profile.bundles`；内置组合包会先从 dsh 安装目录解析，再回退到 profile 自己的 `node_modules`。若被命名的组合包在其 package.json 中未声明 `dsh.bundle`，加载时会跳过并给出警告，profile 的其余部分保持活动。

### 你会得到什么

一个 `max-tokens-continue` 行，其插件把一条简短的续写用户消息引导回被截断的轮：

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关；`false` 时不注册任何监听器。 |
| `maxContinuations` | 整数 1–64 | `9` | 每轮允许的续写次数。 |
| `requireProgress` | boolean | `true` | 当被截断的尝试完全没有输出内容时跳过续写。 |
| `prompt` | string | 内置 | 引导进该轮的续写消息。 |

截断后若某一步正常完成，该轮的结果会被恢复，因此当续写干净结束时，转录会把这轮报告为已完成；始终未完成的轮仍报告 `max-tokens`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

本组合包是一份静态补丁文档：在空的 profile 根上做一次 `insert` 行，挂载本包自身在 `src/` 中提供的插件。

### 组合机制

补丁替换目标行的整个 `config` 而不是合并它，因此后续层或用户的 profile `cordis.patch.yml` 按 id 覆盖该行，后写者胜。该行监视 `agent/assistant-stream` 帧中结束原因为 `max-tokens` 的 `finish`，随后在 `agent/turn-stopping`（串行事件，没有 `next()`）检查中止信号、流式输出进度守卫与每轮预算，再以一条普通用户消息调用 `agent.steer()`。引导会清除结束标记，因此一次截断结束最多引导一次。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 组合包本体：insert 行及其默认配置 |
| [`src/index.ts`](src/index.ts) | 插件：流跟踪、turn-stopping 钩子与 `Config` 架构 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [app-boot profile 章节](../../boot/app-boot/README.zh.md) —— profile 如何解析、分层与协调组合包。
- [组合包包地图](../README.zh.md) —— profile 组合出的各个表层。
- [生成的配置目录](../../../docs/config-catalog.zh.md#localmax-tokens-continue) —— 该行的配置键。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过本组合包挂载的插件，由它向被截断的轮引导一条续写消息。

#### KV 缓存影响

本组合包自身不增加请求前缀；每次引导都作为一条普通用户消息追加到既有历史之后到达模型。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明续写何时不再有帮助，或如何关闭它。它们是当前的包约束，不是通用对比，也不是任务积压。

- **每次截断结束引导一次，且每轮有上限** —— `maxContinuations` 限定单轮可接收的续写次数，因此反复截断的路由会在预算用尽后结束该轮，而不是无限循环。
- **`requireProgress` 跳过无内容的截断** —— 当被截断的尝试完全没有输出时，插件不会引导，因为立刻再次截断只会消耗预算而没有模型进展。
- **按 profile 关闭，而不是按请求** —— 该行是 profile 级的：需要严格截断语义的 profile 在自己的补丁层中设置 `enabled: false`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本组合包依赖的轮结果规则位于 `packages/core/agent-loop/src/agent.ts`（`local/32k-turn-recovery` 提交）：max-tokens 截断后完成的步骤会恢复该轮，空的步骤结束只清除可关闭的轮，而新的 max-tokens 步骤会重新标记它。该组合包从工作安装中原样迁入为 `@local/max-tokens-continue`，并转换为工作区包，使仓库的各道门禁能对它做类型检查与文档校验。

</details>
