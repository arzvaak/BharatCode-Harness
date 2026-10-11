# Workflow implementation

Source chat: codex://threads/01a128fe-42df-7560-bc2d-30d8ead06ff1
Branch: implementation/workflow-completion
Baseline: 091701ca5a621697bf357a7eb654d699468c6200

## Connected workflows

Coding uses a lazy Monaco editor, scoped workers, saved-revision language diagnostics,
code action and rename previews, and explicit acceptance into the current draft.
Git captures complete tracked and untracked changes with the base commit; attaching
verification requires the captured diff to still match before and after collecting
project evidence and the owning session transcript. The evidence form records an
outcome; requesting browser verification goes through that same primary session.
Language actions need the LSP Actions extension and a configured language server.
Multi-file proposals are shown; each open file is accepted and saved explicitly.

Writing and Research use Lexical for Markdown that round-trips exactly, with source
fallback for unsupported syntax. Source selection provides exact UTF-16 anchors for
proposals and comments. Selecting formatted prose switches to source for exact
selection. Proposals require the complete original source to match at acceptance.
Comments, outlines, and before/current comparisons sit beside the document.

Research relates immutable sources, findings, and manuscript claims using explicit
supports/conflicts/cites relations and optional exact passage anchors. The reader
opens the captured passage and reports whether the live source changed. Existing
handoffs carry artifact IDs, constraints, and unresolved questions through the
primary session inbox.

Writing project structure persists briefs, style, outline, source revision notes,
and general/novel/drama/game/recap specializations. Established canon remains
separate from tentative ideas, characters, chronology, and scene objectives. Scoped
consultations are suggestions queued to the primary writer; the brief exports as
Markdown.

Analysis captures notebook/code and project inputs before execution. It executes
captured UTF-8 inputs and scalar parameters in a fresh directory with a Python
Jupyter kernel. Durable Runs retain identity, real runner/kernel environment,
outputs and generated-by provenance, failure/cancellation, and restart interruption.
Cancellation during output capture retains the captured revision on the cancelled Run.
Starting the final outcome commit is the completion boundary; later cancellation
does not rewrite an outcome already being committed.
Download the executed notebook to inspect tables/charts with its originating run.
Configure `ProjectKnowledgeController.notebookPython` to a Python environment with
`nbclient`, `nbformat`, and a Python kernel; `notebookCellTimeoutSeconds` defaults to
120. Verification here used an isolated environment at
`/home/sushi/.local/share/bharatcode/workflow-python/bin/python`.

## Optional capabilities and apps

Extension discovery exposes actual Ready/Needs setup/Disabled/Failed states,
qualification/dependency/credential requirements, and specialist schema loading.
Core tools stay available. Loaded schemas report measured serialized bytes; request
comparisons report schema/request bytes. These are overhead measurements, not token,
latency, cost, or quality improvement claims.

MCP Apps advertise UI support, discover session-scoped `ui://` HTML resources, and
lazily open an opaque-origin frame pair using the official bridge. A trusted outer relay denies
app self-navigation as well as subresource requests. Self-contained HTML
may execute scripts; network, external frames, links, forms, and automatic model
messages remain unavailable. Every allowed app tool call uses ordinary policy,
including app-only tools hidden from model and generated SDK schemas. App inputs
are saved explicitly for reopening. Call audits store identities, outcomes, bytes,
and digests, without raw arguments/results. Views close their transports on disposal. Resource reads and calls are bound to the
connection generation, with permission/URI rechecks around asynchronous persistence.
This is a deliberately restricted host: external-resource permissions, arbitrary
widget state, model-context updates, sampling, and full desktop qualification are
not represented as supported.

Existing Zotero, Reference Checker, MarkItDown, Oh Story, Datalayer, Context7,
Playwright, and DevTools candidates retain their setup and exact platform/artifact
qualification gates. Native workflows do not falsely qualify an upstream connector.
Reference existence and bibliographic metadata do not establish claim support.
MarkItDown is an intake converter; document layout belongs to its authoring tool.

## Internal evaluation and evidence boundaries

The keyless `scripts/workflow-request-review.ts` audit command and internal APIs reconstruct settled requests from the actual Session fold, including
tool declaration history, and compare messages, tools, settings, and serialized
sizes. Replay requires the explicit `paid-replay` consent string, uses the configured
provider, retains output evidence, and does not execute proposed tool calls. Removing
tools filters their historical definitions while preserving declaration update identities. No paid replay was run.
A single replay measures sensitivity and is not causal proof.

The separate project journal uses revision-checked writes and validates project,
session, source, passage and generated-output ownership. It does not change released
Session types. Exact artifact SHA, source commit, platform, and static/install/
lifecycle/workflow evidence remain the extension qualification identities.

Validation logs are local and ignored; executable browser fixtures and the
recorded-session acceptance live with the change. Builds and component browser
checks do not establish a deployed desktop release or Windows provider qualification.

## Concurrent work to preserve

The user also referenced the active chat
`codex://threads/01a129de-d3be-70c2-923b-c6420524efca`. It works in
`/home/sushi/bharatcode-extension-store` on incomplete tool-argument continuation
and Visuals 0.1.3 reading/math layout, with installed local preview updates. This
branch does not touch that checkout or installed preview. Combine its final source
changes before building a combined release; in particular retain `llm-pi-ai` stream
continuation, the associated agent/provider regressions, and the native Markdown
math rendering path used by Visuals. Do not replace its current installation from
this baseline branch alone.

## Verified acceptance

- Host build (including the desktop bundle), Client build, and Web build passed.
- Final targeted suite: 15 files, 333 tests passed, including the three real Python
  notebook integration tests with `BC_NOTEBOOK_TEST_PYTHON` configured.
- Extension-store suite: 69 tests passed. Request reconstruction/freeze: 36 passed.
- Keyless shipped-Web workflow acceptance: 4 tests passed in refresh, then 4 in
  replay. The owning recorded Session remains in the fixture, and the Writing
  structure reload proves briefs/canon/tentative ideas persist separately.
- Real browser fixture: Monaco edits/save/worker, Lexical mount/edit, MCP Apps
  negotiation/tool bridge, foreign-tool rejection, opaque origin, and blocked
  self-navigation passed without page errors. Run the fixture with
  `pnpm exec vite --config .workspace/workflow-completion/browser/vite.config.ts`
  and then `node .workspace/workflow-completion/browser/probe.mjs`.
- Changed-source Oxlint passed. LSP Actions typecheck passed. Persistence history
  check matched 64 roots and 10 history records; released Session formats v0-v4
  and generated format catalog passed. `git diff --check` passed.
- Independent verification used GPT-6 Luna with max reasoning. It found and
  helped validate cancellation, stale-frame, reconnect, and permission/read races;
  the added lifecycle regressions pass and the final fix review has no actionable
  findings. Its notebook-only invocation skipped integration tests without the
  Python environment; the final root suite ran them with the isolated environment.

The repository-wide unknown-cast checker has existing failures on assertions outside this patch. This change adds no `as unknown` assertions. No full-repository green
claim is made from the targeted checks. Local validation logs are ignored by Git.
