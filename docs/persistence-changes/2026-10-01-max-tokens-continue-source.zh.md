---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-01-max-tokens-continue-source

[English](2026-10-01-max-tokens-continue-source.md) | 中文

## 概述

为 max-tokens-continue 组合包在用户消息被提供方输出 token 上限截断时写入的续写引导，新增一个带限定的 max-tokens-continue 归因来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-01-max-tokens-continue-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "c15c88539b089a79076d743b9999f5391e1fcb403473855d2a618a48ec1f981e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "514cb3ee1f035e2f3e907060b38437ae9dc30bd1d0bf24853462648a6c4781d1"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "9a2ca06253b2245ffa716a8f5c240a97f46cd86db90d0c64c38468ab6bb12853"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "c5ff8bfce168bdc45530f1a4541ff1afd5ac4baf0782a17a86ae6e150b571b95"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有日志不含该来源，仍然有效。新来源是普通用户消息上的限定归因：没有该组合包的读取方会原样保留该消息并从其内容派生历史，只有展示层读取该 kind 将该行标记为通知。生产者只在仍开启的轮内引导，因此没有任何持久事件类型、会话头或无关消息形状发生变化。

<a id="verification"></a>
## 验证

pnpm run typecheck 通过。持久化 schema、变更、纪元与文档相关测试套件在门禁配方下通过 334 项测试。变更分类器在 agent/inbox/spliced、developer/message、session/title-llm-request 与 user/message 上报告且仅报告四处 attribution-kind-added 变更，全部判定为 same-version；随之重新生成的目录产物已随本记录一并提交。

<a id="dev-note"></a>
## 开发备注

无。
