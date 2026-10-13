# Native Research Knowledge Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Read and develop linked, cited Markdown research in BharatCode and export it as an Obsidian-compatible vault while retaining notebooks.

**Architecture:** A pure Markdown module parses and resolves links; a bounded host library discovers files and creates portable exports. The existing knowledge controller, immutable evidence registry, document lifecycle, and Markdown renderer own transport, citations, saves, and reading.

**Tech Stack:** TypeScript, Node filesystem, mdast, React, existing GFM/KaTeX renderer, fflate ZIP.

**Spec:** `docs/superpowers/specs/2026-10-13-research-knowledge-workspace-design.md`

## Global Constraints

- Default maximum 10,000 Markdown files, 2 MiB per indexed document, 64 MiB total indexed text, and 200 rows per returned page.
- Markdown is canonical; discovery does not rewrite files or `.obsidian/`.
- Use existing version-checked saves and private recovery; expose partial persistence.
- Sources and notes are evidence, never instructions. Indexing is not model admission.
- Keep notebook execution/cancellation contracts and project/session identity.
- Primary agent implements; releases require `gpt-6-luna` with `max` reasoning.

## Review Focus

- Duplicate note names and aliases must present ambiguity, never select an arbitrary target.
- Fenced/inline code must not create spurious backlinks.
- External edits must preserve dirty drafts and fail version-checked saves.
- Traversal and symlink resources must not escape project scope or leak into exports.
- Citation capture failure after saving must retain authored text and support retry.

## Task 1: Markdown library and portable files

**Files:** Create `packages/workspace/workspace/src/research-markdown.ts`, `research-library.ts`, and `research-types.ts`; export types via `types.ts`; tests `tests/research-library.spec.ts`.

**Interfaces:** Produce `parseResearchMarkdown(text)`, `resolveResearchLink(notes, from, link)`, `researchReadingText(text)`, `ResearchLibrary.list(query,cursor)`, `inspect(path)`, `create(path,title)`, and `exportVault(extraFiles)`. Notes include links/headings/aliases/tags; results carry issues and cursors. Export returns ZIP bytes and omission receipts.

- [x] Write failing parser/discovery/create/export tests: links/aliases, code exclusion, Unicode, ambiguity, unchanged vault metadata, exclusive creation, external refresh, containment, bounds, referenced resources and ZIP readability.
- [x] Run `node_modules/.bin/vitest run packages/workspace/workspace/tests/research-library.spec.ts --reporter=dot` and observe failure.
- [x] Implement parser, bounded discovery, contained exclusive creation, ZIP export and dependency declarations.
- [x] Run the tests until passing; commit the task.

## Task 2: Host APIs, citations, and agent tools

**Files:** Modify `packages/api/workspace-controller/src/knowledge.ts`, `workspace-tools.ts`; create `research.ts`; add host tests.

**Interfaces:** Produce `researchList(projectId,query,cursor)`, `researchInspect(projectId,path)`, `researchCreate(projectId,path,title)`, `researchCaptureCitations(projectId,path,expectedText)`, and `researchExport(projectId)`. Citation preparation is pure; capture validates the disk text against expected text and links exact source revisions.

- [x] Write failing controller tests for project boundaries, immutable citation validation, idempotent retry, portable exported sources, and tool receipts.
- [x] Observe focused host tests fail before implementation.
- [x] Add generated Remote methods and bounded `research_notes` tool actions using the same host operations.
- [x] Run host tests and transport/type checks; commit the task.

## Task 3: Native reader/editor and export flow

**Files:** Create `ResearchKnowledgePanel.tsx`, `ResearchReader.tsx`, `research-knowledge.module.css`; modify `ResearchWorkspace.tsx`, `surfaces.ts`, `index.ts`, `locales.ts`; add client tests. Use existing document editor/drafts and Markdown rendering.

**Interfaces:** Consume Task 2 APIs through typed `WorkspaceSurfaceActions`. Reader accepts text and delegates contained link/image navigation. Save publishes through existing document actions, then captures citations. Export downloads host ZIP with issues displayed.

- [x] Write failing UI tests for reading, creating/opening a note, link/backlink navigation, insertion, save/capture, export, failure states, and late project responses.
- [x] Observe tests fail, then wire typed remotes and implement the navigator, Read/Edit controls, contextual links/citations, topic home, and export.
- [x] Use shared design tokens, accessible controls, responsive container layout, and localized copy.
- [x] Run client tests plus existing research/document tests and commit the task.

## Task 4: Whole-flow verification

**Files:** Add representative research preview fixture and implementation evidence ledger.

- [x] Run workspace/controller/UI suites, generated transport checks, host/client TypeScript, and notebook regression tests.
- [x] Exercise a complete research fixture in the browser at desktop and narrow widths, including tables/math/figures, linking, source inspection, and export.
- [x] Request a fresh whole-branch reviewer under executing-plans; fix material findings with regression tests.
- [x] Record commands, results, limitations, and final source commit; do not claim installation or release.

Execution: inline as explicitly requested by the user. The repeated implementation instruction supersedes a further plan-approval pause; preserve spec review already completed.
