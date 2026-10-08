---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-08-bharatcode-context

[English](2026-10-08-bharatcode-context.md) | 中文

## 概述

添加持久化工作流分配和显式项目交接接收记录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-bharatcode-context
baseline: false
changes:
  - root: "event:project/handoff"
    previous: null
    after: "79c08cc644d861871207b8438ea73f077e7bc1a648bcc010afe17ba93666c171"
    decision: same-version
  - root: "event:workflow/assignment"
    previous: null
    after: "a106efd80dac6f3d3a3e1466dcd83c7554260a85baf8334a36f751768d3520f5"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

历史会话代次和头部保持不变。新增事件仅用于日志，不进入模型历史。交接文本通过现有带标识的用户消息和持久化收件箱进入模型。捕获修订保存在项目私有存储中，源文件修改不会改写先前的提示。

<a id="verification"></a>
## 验证

在最终有界搜索修改之前，项目、工作区、界面和代理循环的定向测试共通过996项。生产JSONL重启和稳定提示标识场景在保留排队输入后通过，生命周期测试也通过。最终阶段验证记录在实施台账中。

<a id="dev-note"></a>
## 开发备注

无。
