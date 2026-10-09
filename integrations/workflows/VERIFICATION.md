# Workflow verification

The final `registry.json` links all eight tarballs and their exact SHA-256 checksums, canonical upstream revision, source fork, patch, workflow purpose, test status and known limits. Zotero and Browser upstream repository URLs are explicitly recorded.

| Package | Qualification |
| --- | --- |
| dsh-zotero-plugin | Real ToolRuntime and local HTTP fixture: 10 registered tools, reference search, notes, BibTeX export, English invalid-key failure and disposal passed. |
| @perrylink/dsh-github | 185 upstream checks passed; three authenticated E2E checks skipped. Rebuilt ModuleLoader factory. Native settings.section activation, disposal and reactivation passed using the real SlotRegistry with primitive rendering stubbed. Parent performs actual native UI qualification. |
| @linxin666/dsh-client-ui-task-board | 833 checks passed; one optional external check skipped. Canonical monorepo package 0.4.5 was reconciled rather than stale 0.4.4 English payload. Declaration, host and browser builds passed. English continuation delimiters, locale dictionaries and native factory preserved. |
| dsh-library | 89 checks passed, including actual profile composition, reference quality, retrieval and lifecycle. English reference failure reasons and few-shot prompts rebuilt. |
| dsh-lsp-actions | 368 checks passed; nine environment-dependent checks skipped. Actual composition passed. No server is activated by its empty default mapping. |
| dsh-browser-playwright | 47 local browser fixture checks passed on cached Chromium. Current rc.2 source/message/JsonValue ABI compiled. Tabs, refs, interaction, snapshots, screenshots, extraction with mock model, and ownership/lifecycle qualified. No public navigation smoke was run. |
| @bharatcode/dsh-novel-continuity | Real ToolRuntime test passed: isolated project, phase gating, lore entry, versioned chapter, previous-chapter context, stats, audit and disposal. Canonical upstream data semantics preserved, including character-count chapter targets. |
| dsh-deepread | Real ToolRuntime test passed: registration, model-free estimate, local text file, quick report, book synthesis, English authored model prompts/output, unsupported-mode validation and disposal. Model stream was a deterministic fixture. |

Tests and build evidence are retained in package test sources and `*-tests.log` / `*-build.log`. Upstream licenses accompany every tarball. Language checks distinguish authored output from multilingual input recognition and user-authored document content.

Scoped adaptations are explicit: Novel Continuity exports the original project/chapter/lore core without the duplicate writing workbench; DeepRead exports the original reading/report engine in quick, deep and book modes without its duplicate shell, maps, Feynman mode, batch/background jobs or automatic exports. These omitted features are not claimed to work.

No personal Zotero library, authenticated GitHub account, real language-server workspace, project manuscripts, or production model service was accessed. Real authentication/model output remains a configuration-dependent follow-up, separate from successful package and local runtime qualification.

## Native plugin configuration page

The shipped web-app composition now enables the existing `@deepseek-ai/dsh-client-ui-plugin-manager` row. Its original sidebar page declares and renders `plugins.item`, `plugins.bundle.config`, `plugins.row.config` and detail/activation contributions. No substitute slot bridge or replacement design was added. Its dictionary copy is English for every locale; user-authored localized metadata still resolves through the original metadata seam. Existing real lifecycle/config-ledger checks and configuration-page component cases prove declaration, teardown/reactivation, and visible official/bundle/row forms. The package was rebuilt with TypeScript and the canonical ModuleLoader bundler. Parent qualification checks this page in the native compiled CLI profile.
