# Feature-to-tool audit

Scope: shipped model-operable workspace capabilities and bundled extension capabilities. Host owners retain validation, persistence, job execution and policy. Account login, credential entry, OS directory selection and app-only MCP callbacks remain user/interface operations.

| Feature | Model access | Persistence/execution owner |
| --- | --- | --- |
| Research Sources, excerpts, findings, notes, revision inspection, citation links, bounded evidence bundles | project_sources (search, discover, register, register_many, capture_text, read, inspect, refresh, related, capture_session, capture, link) | ProjectKnowledge |
| Automatic research retention | Successful web_search/web_fetch; source-file read/write/edit; bounded discovery after bash/pwsh and opening Sources | Same ProjectKnowledge revisions, success/error receipts, unchanged-file caching |
| Writing brief, style, outline, established/tentative canon, characters, chronology, scenes, source notes | workspace_records (list, save), existing novel continuity tools for its own ledger | Revision-checked WorkflowJournal |
| Analysis preparation and captured notebook execution | workspace_records (save, execute_notebook), existing jobs tools for observation/cancellation | ProjectKnowledgeController job runner; model cannot forge execution-owned records |
| Git change evidence and verification records | workspace_review (capture_change, record_verification) | Existing exact-diff verification owner |
| LSP review and rename preview | workspace_review (language_review), existing LSP tools | Existing saved-revision LSP owner |
| Document citations and anchored comments | workspace_review (document_evidence, comment_selection), project_sources link/related | Existing document review owner |
| Model request snapshots, diffs and sensitivity replay | workspace_review (request_snapshot, request_diff, replay_request) | Existing request review owner; replay crosses host approval |
| Context Insights | workspace_review (context_insights) | Installed session projections, own conversation only, bounded output |
| Workflow intent and evidence transfer | workspace_handoff (workflow, assign_workflow, context, prepare, read, submit) | Persisted workflow event and durable handoff inbox; dispatch crosses host approval |
| MCP Apps | workspace_apps (list, read), negotiated model-visible MCP tools | Existing MCP negotiation; app-only callbacks remain app-only |
| Project registration, rename/delete/order, session order/archive/pin | workspace_manage | Existing WorkspaceController; deletion/archive cross host approval |
| Private document recovery copies | workspace_drafts (read, save, clear) | DocumentDrafts, current owning session, revision-checked; clearing crosses host approval |
| Project files, filesystem search, publication and previews | Existing read/write/edit/read_image and search tools; document delivery tools | Existing filesystem/deliverable owners |
| Terminals and shell execution | Existing terminal and bash/pwsh tools | Existing terminal/sandbox owners |
| Jobs, goals, todos, workflows, delegation and history | Existing jobs, goal, todo_write, workflow/subagent and session query tools | Existing service owners |
| Plugins and skills | Existing plugin_manager, skill and workspace dependency tools | Existing loader/skill owners |
| Task Board and schedules | Existing task_board_list/get/create/update/manage/run/schedule/set_parent | Bundled Task Board owner |
| Engram Memory Palace | Existing engram save/search/facts/update/forget/review/report/export/distill/reflect/examine/neighbors/tour/profile tools | Bundled Engram owner |
| Zotero, deep reading and novel continuity | Existing bundled extension tool registrations | Their own extension owners |

Discovery considers only sources/ and retains complete UTF-8 files up to the configured byte limit. It reports binary/extraction requirements, per-file failures and directory/file admission limits. Web captures describe returned excerpts accurately. Captured evidence is data, never executable instructions. Source reversion creates a new immutable observation so the current head can return to old content without modifying its historical revision.

Panels receive durable commit invalidations through the supervised Remote stream. Research reader operations use a different lifetime from search refreshes. Writing preserves unsaved edits and offers load-latest plus restoration of the local draft before saving against the newer revision. Analysis rejects out-of-order reload results.
