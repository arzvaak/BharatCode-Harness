---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-01-max-tokens-continue-source

English | [中文](2026-10-01-max-tokens-continue-source.zh.md)

## Summary

Adds a qualified max-tokens-continue attribution source for the continuation steer that the max-tokens-continue bundle writes on a user message cut off by the provider output-token cap.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing logs contain no such source and remain valid. The new source is qualified attribution on an ordinary user message: readers without the bundle preserve the message and derive history from its content unchanged, and only presentation reads the kind to badge the row as a notice. The producer steers only within an open turn, so no durable event type, Session header, or unrelated message shape changes.

<a id="verification"></a>
## Verification

pnpm run typecheck passed. The persistence schema, change, epoch, and documentation suites passed 334 tests under the gate recipe. The change classifier reports exactly four attribution-kind-added changes across agent/inbox/spliced, developer/message, session/title-llm-request, and user/message, all classified same-version, and the regenerated catalog artifacts are committed with this record.

<a id="dev-note"></a>
## Dev Note

None.
