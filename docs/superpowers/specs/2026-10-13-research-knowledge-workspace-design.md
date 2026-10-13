# Native research knowledge workspace

English | [中文](2026-10-13-research-knowledge-workspace-design.zh.md)

Date: 2026-10-13 Status: approved for implementation by the user on 2026-10-13 Branch: implementation/research-knowledge-workspace

## Purpose and approved direction

Research supports sustained inquiry into a topic through connected notes, sources, citations, and findings. Computational notebooks remain available in the same project. The user approved a native workspace with linked Markdown notes, source citations, and Obsidian compatibility. This document specifies that implementation. The user subsequently requested in-app reading and export to Obsidian, and explicitly directed implementation.

Success means a person can collect sources, write and link notes, revisit their evidence, edit the same files in Obsidian, and run a notebook without changing projects or losing drafts. Chat remains the entry point. Opening Research does not execute work, disclose an entire folder to a model, or change session identity.

## Existing seams

- `packages/client/ui-workspace/src/client/workflows/ResearchWorkspace.tsx` already separates sources, notes, evidence, manuscript, workspace, and runs. Notes currently use the generic document panel.
- `packages/workspace/workspace/src/project-knowledge.ts` and `types.ts` store immutable artifact revisions and explicit relationships, including citations anchored to exact quoted passages and revision IDs.
- `packages/api/workspace-controller/src/knowledge.ts` exposes the generated knowledge Remote service and owns notebook admission and execution jobs.
- `packages/api/workspace-controller/src/source-capture.ts` and `workspace-tools.ts` retain research sources and expose agent tools.
- `workspaceFiles.readEditable/saveEditable` provide version-checked file editing. Document drafts and the existing editor lifecycle provide private recovery.

Reuse these contracts rather than introducing a parallel evidence store, notebook runner, editor persistence mechanism, or model permission system.

## Scope

Deliver a topic home, a Markdown note library, note creation/editing, internal link navigation and insertion, backlinks, bounded search, source capture, citation insertion and inspection, existing evidence views, and computational notebook access. Include an agent-facing note interface using the same host service.

Obsidian compatibility means ordinary files, supported link navigation, and external-edit handling. It does not promise Obsidian plugins, themes, databases, Canvas, or full block-reference rendering. A graph view, semantic embeddings, cloud sync, automatic literature monitoring, and new binary-document OCR are outside this implementation. Existing document readers remain available.

In-app reading uses the existing safe Markdown renderer for tables, footnotes, code, math, and figures. No new graphics engine is required. Export produces a downloadable ZIP containing a vault folder of ordinary Markdown and referenced local attachments/notebooks, plus portable copies of cited captured evidence. The export reports missing resources and byte limits. It never overwrites an existing vault or includes credentials, app-private storage, or `.obsidian/`.

## Files and identity

The registered workspace directory is the vault root. New projects use `Research.md` as an optional editable topic home and `notes/`, `sources/`, and `attachments/` as suggested directories. Create them only through explicit initialization or creation actions. Existing folders keep their structure.

Markdown files are canonical authored content. Never require proprietary front matter or rewrite files during discovery. Preserve unsupported syntax, front matter, Unicode, line endings, and user formatting. The app must not modify `.obsidian/`. Git metadata, application-private state, dependency directories, and symlinks escaping the project root are excluded from note discovery.

The note index contains project-relative paths, display titles, aliases, tags, headings, source links, file versions, and resolved outgoing links. It is a rebuildable projection; deletion of the index must not lose authored knowledge. Existing artifact revision IDs remain the identity of captured evidence. Mutable note paths and immutable revision identities must never be conflated.

## Host service and index

Add a focused research-library module under the workspace package, with public types and host APIs through the knowledge controller. Responsibilities:

1. Discover Markdown documents beneath a selected registered project root.
2. Parse supported metadata and links using existing Markdown parsing utilities where available; exclude fenced and inline code from link extraction.
3. Produce note listings, search results, outgoing links, backlinks, and issues.
4. Create a note exclusively without overwriting an existing path.
5. Read and save notes through existing version-checked file APIs and capture saved revisions as notes through project knowledge.
6. Insert and inspect citations through existing immutable relation APIs.

Proposed Remote operations are `researchList`, `researchInspect`, `researchCreate`, `researchRefresh`, and `researchCite`. Editing continues to use the existing file service. Every operation verifies registered project ownership and canonical root containment. Client-provided absolute paths cannot select an unrelated file. Requests and responses use generated Remote types.

Discovery is bounded and reports partial results rather than silently declaring completion: default maximum 10,000 Markdown files, 2 MiB per indexed document, 64 MiB total indexed text, and 200 rows per returned page. Sort deterministically by project-relative path and continue with a cursor. File content above limits can still be opened through normal file tools; expose why it was not indexed.

Refresh on opening the library, after successful app saves, on explicit refresh, and on existing file-change notifications where available. Coalesce events; invalidate obsolete async responses on project changes. On external changes, reload clean editors and show a conflict for dirty editors. Search and backlinks must identify partial/stale indexing. Never silently overwrite external edits.

## Markdown and Obsidian link semantics

Support standard relative Markdown links and Obsidian wikilinks: `[[Note]]`, `[[folder/Note]]`, `[[Note|label]]`, and `[[Note#Heading]]`. Support file embeds as safe attachment links/previews using existing resource renderers. Preserve block references and other unsupported forms literally and identify unsupported navigation instead of inventing a target.

Resolve explicit relative Markdown paths against the containing note. Resolve vault-root wikilink paths against the registered root. Basename-only wikilinks resolve only when there is one matching note; duplicated names require a target picker. Exact filenames take precedence over aliases; ambiguous aliases remain ambiguous. Decode Markdown URL escapes without treating external URLs as local files. Reject traversal and escaped-root symlinks. Show missing notes explicitly; creation requires a user action and a validated path.

Backlinks identify the referring file and a bounded excerpt. A source citation and a semantic relationship are distinct from an ordinary navigational link. Do not infer that every link means 'supports'.

Automatic rename propagation is deferred: this version exposes no bulk rename operation. External renames refresh the index and reveal broken references. Existing generic file operations must not claim to repair note links.

## Sources and citations

Keep source acquisition and immutable capture in the existing source workflow. Sources display title, original URL/path, capture revision, and availability. Binary sources display extraction availability honestly; no unsupported PDF page mapping or OCR is claimed.

For captured text, a person selects a passage and inserts a Markdown footnote with a readable source title, portable URL or relative file link, and quotation or locator when available. Allocate a collision-free footnote label and keep the reference definition in the Markdown file. Never add a page number unless known.

Save the note through compare-and-save, capture its new immutable revision, and link that revision to the selected source revision with `cites` and the exact passage offsets/quote. Serialize this workflow and report its durable steps. If relation capture fails after the file save, preserve the saved note, show 'citation evidence incomplete', and allow an idempotent retry. Do not describe partial persistence as complete or roll back a user's unrelated external edit.

The citation inspector opens the exact captured source passage and distinguishes current, stale, missing, and captured-only sources. External Markdown citations remain readable without private metadata; imported footnotes are not automatically claimed to have verified immutable passage evidence.

## User experience

Keep the chat-led empty state and explicit document disclosure. Research topic home offers a Markdown overview, open questions, note/source counts, and entry actions. Questions are authored text, not a new mandatory database schema.

The opened knowledge workspace has a compact note navigator, a central editor or reader, and a contextual panel for outgoing links, backlinks, and citations. Reuse shared theme tokens, draft recovery, save/conflict indicators, and panel layout. Preserve Files space and per-session workflow state. Stack panels on narrow containers and provide keyboard-accessible controls and named regions.

Create note, link existing note, follow link, inspect source, insert citation, search, and return to previous note are explicit actions. Empty, loading, disconnected, partial-index, conflict, and failed-write states are distinct. No click on a note executes code or submits a chat message.

Notebooks remain reachable as 'Computational research' using the existing analysis surface and job controller. Preserve input capture, kernel information, run/cancel/status, errors, and outputs. A note may link to an `.ipynb` file or a captured result; opening that link does not run it.

## AI integration

Expose bounded list/search, inspect links/backlinks, create note, and citation operations through the existing workspace tool registration. Use the same host implementation as the UI. Tool receipts report saved path/version, captured revision, unresolved links, omissions, and partial citation persistence.

Browsing/indexing is not model context admission. Preserve explicit selected context and existing handoff contracts. Sources and notes are evidence, never instructions. Distinguish source quotations, user observations, and AI inference in authored proposals. AI edits to existing notes use the current review/diff path with base-version checks; discovery never authorizes silent mass rewrites.

## Verification and acceptance

- Host tests cover exclusive creation, root containment, escaped symlinks, pagination/limits, external changes, stale responses, and version conflicts.
- Parser tests cover Unicode/spaces, Markdown links, aliases, headings, ambiguous basenames, missing notes, embeds, code fences, and URL escaping.
- Citation tests cover footnote collisions, exact revision passage validation, stale sources, partial save/capture failures, and retry idempotency.
- UI tests cover create/edit/save/reopen, draft recovery, link navigation, backlinks, citations, index warnings, keyboard use, and project switching.
- Browser review exercises a complete topic-research flow at desktop and narrow widths, including an external file edit and a conflict with an unsaved note.
- A compatibility fixture uses a vault containing normal Markdown, wikilinks, attachments, front matter, and `.obsidian/`; prove discovery does not rewrite any file and the resulting notes remain readable without app-private storage.
- Existing notebook execution/cancellation tests and research/workspace tests remain passing. Exercise actual notebook execution if the configured kernel is available; report an unavailable kernel separately from UI evidence.
- Run affected package checks, generated transport/type checks, and focused regression suites. Record exact commands/results in the implementation ledger.

Acceptance: collect two sources, create three linked notes, add a passage citation, follow links and backlinks, search, reopen after restart, edit a note externally, handle a simultaneous edit without loss, and reach a tracked notebook run in the same project. Sources, drafts, unrelated files, and chat state remain intact.

## Implementation and release boundary

After specification approval, write the dependency-ordered implementation plan: library/parser contracts, host APIs, citation workflow, UI, agent tools, and complete-flow verification. Use existing native transport and editor conventions.

Release preparation, packaging, qualification, publishing, and installation are delegated to `gpt-6-luna` with `max` reasoning under the user's global rule. The primary agent implements and hands off concrete changes and verification evidence. This specification does not authorize a public release.
