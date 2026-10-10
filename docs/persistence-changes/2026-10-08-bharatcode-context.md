---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-08-bharatcode-context

English | [中文](2026-10-08-bharatcode-context.zh.md)

## Summary

Adds durable workflow assignment and explicit project handoff admission facts.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Historical session generations and headers remain unchanged. These additive log-only events do not enter model history. Handoff text enters through the existing identified user message and durable inbox. Captured revisions are immutable in private project storage; source edits never rewrite an earlier prompt.

<a id="verification"></a>
## Verification

Focused project/workspace/UI and agent-loop suites passed 996 tests before the final bounded-search addition. The production JSONL restart and stable prompt identity scenario passed with retained queued input, alongside lifecycle tests. Final verification is tracked in the implementation ledger.

<a id="dev-note"></a>
## Dev Note

None.
