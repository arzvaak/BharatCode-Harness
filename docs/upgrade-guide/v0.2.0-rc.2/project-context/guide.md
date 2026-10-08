---
kind: upgrade-guide
description: "Project evidence and workflow handoffs add immutable context captures without copying whole conversations or changing agent execution directories."
---
# Project evidence and workflow handoffs

English | [中文](guide.zh.md)

## Change

A Workspace remains the stable project identity. The Workspace API composition now mounts the core Project Knowledge service and generated `knowledge` API. Register selected UTF-8 documents, retrieve bounded excerpts, capture immutable revisions, and explicitly link evidence, conflicting decisions, or implementation artifacts. Files are read without rewriting them; indexing, captured text, relationships, and prepared handoffs live in the private `project_knowledge` storage domain.

“Send to session…” opens the shared handoff editor. Choose an existing or new destination session, objective, selected evidence, constraints, and unresolved questions. Preparation freezes the evidence and shows oversized-source omissions before admission. Queueing waits for the destination’s next turn; steering is a separate explicit action. “Using context” beside the composer shows only evidence associated with admitted prompts, including source revisions and missing/stale status. Refreshing opens a new preparation rather than replacing an earlier task’s evidence.

Explicit session captures reuse the existing bounded session-reference projection. Capture sequence, format generation, and omitted messages/bytes travel with the frozen evidence. Refreshing a session capture makes a new revision; a missing originating session is reported without losing the captured text.

Workflow assignments and handoff admission are additive, log-only session events. Exact model-visible handoff text uses the existing identified user message and durable inbox. Shutdown retains queued input, and retrying a submitted handoff resumes its existing pending message through supported agent runtimes. User cancellation still clears pending input. Core project operations do not require optional integrations.

## Migration

1. Retain the existing Harness home, project registry, session generations, credentials, and model routes. No source or profile directories move.
2. Upgrade the generated host/client APIs together. Historical logs require no rewrite. The new events use the existing session format generation; their compatibility acknowledgement is in `docs/persistence-changes/2026-10-08-bharatcode-context.md`.
3. Hosts composing the Workspace API need the existing Session Controller and session-query services to activate handoff operations. Project storage is independent of optional memory/search packages.
4. After restart, retry a queued handoff with its original identity. Do not create a second task to recover it. Alternative agent runtimes should implement the optional `resumePendingInput` capability to wake retained input without manufacturing another prompt.
5. Register supported extracted UTF-8 text rather than raw binary/PDF files at this stage. Document readers and extraction are delivered with the workflow workspaces. Existing captured evidence remains readable after its source disappears.
