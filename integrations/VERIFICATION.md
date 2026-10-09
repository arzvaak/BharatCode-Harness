# BharatCode plugin qualification — 2026-10-08

The enabled inventory is `registry.json`: 17 English plugin packages, each with a SHA256-qualified local archive. SearXNG is deferred. Source forks and preserved licenses live in this checkout; existing workflow UI changes and unrelated work remain separate.

## Runtime and installation

Qualification home: `/home/sushi/.local/share/bharatcode-packed-qualification-20261008`; profile `integrations`. Archives were installed with the real compiled CLI through `integrations/scripts/install.mjs`, then loaded by the compiled CLI on loopback port3196. The profile composes dsh-base, dsh-web-app and all17 declared bundles. Native pnpm policies initially requested build approval; onnxruntime-node and protobufjs were explicitly allowed only in this isolated profile. No compatibility bypass was added.

The installer checks archive digests, backs up existing profile metadata with verified0700/0600 native permissions, passes argument arrays to the native manager, and activates the requested bundles after success. Checksum-named cached tarballs avoid stale same-path/version pnpm resolution. `artifacts/installed-archive-parity.log` verifies installed JavaScript and bundle files byte-for-byte against the qualified archives.

Combined browser proof used the native ModuleLoader and shared RPC: English Skills, Visuals, Memory Palace, Cost, Providers, Zero and Subscriptions settings; Context Insights, Task Board and Plugins management navigation; Task Board's empty authoritative revision0 board. Provider Hub embeds the actual subscriptions slot. All five statuses settled to Not logged in. No login button or real model request was submitted. Fresh Cost defaults show Today0tokens without unsolicited tours or inappropriate global DeepSeek pricing strips.

LSP Actions has a concrete local TypeScript5.9.3 / typescript-language-server5.3.0 mapping for eight TS/JS extensions in the qualification profile. The actual server passed TS and JS type-error diagnostics and formatting. Reproduce with `workflows/configure-lsp.mjs` and `workflows/verify-lsp-setup.mjs`; see `workflows/LSP-SETUP.md`.

## Verification boundaries

- Zero:41 unit checks, real Loader composition and actual AgentLoop fixture requests in Off/Safe/Lean passed. Compression measurements describe projections, not proven billed savings.
- Visuals:15 checks, real SlotRegistry/renderer lifecycle and English aliases passed.
- Tool Call Guard: real Loader+sibling LLM adapter passed malformed-call repair for legacy mixed user results and current first-class tool messages, canonical preservation and unload. This repairs history; it is not a permission policy.
- Skills Manager: complete npm test command passed; real host route registration/restart/unload/collision checks passed. Combined English settings rendered.
- Provider Hub:11 checks plus real local profile credential/model/stream composition. Subscriptions:567 checks plus11 component simulations covering all five providers. Cost Meter:11 focused checks with route-specific prices and host/client parity.
- Engram:476 checks, English/package gates, actual offline Granite migration on a synthetic copy, hostile archive containment tests and stable Workspace ID isolation. Four final focused lifecycle tests passed: delayed consolidation disposal, active session reflection, final ingestion and unresolved embedder cancellation before SQLite closure. Pending replay, summary/audit writes and backfill join the same shutdown drain. Source/package gates and rebuilt bundle passed. See `engram/VERIFICATION.md`.
- Context:1937 checks across102 files, literal100% coverage; actual rc.2 and older supported source compatibility, conservative unknown/subscription pricing. Final38 focused client/card checks passed after removing registration into an unavailable legacy plugin-card slot; Context Insights and live config transport are preserved. See `context/VERIFICATION.md`.
- Workflow tools: GitHub185, Task Board833, Library89, LSP Actions368 and Browser47 checks; Zotero, Novel Continuity and DeepRead real ToolRuntime fixtures. Optional external/account checks were skipped. See `workflows/VERIFICATION.md`.

Authenticated subscription consent and provider-backed generation, real Zotero/GitHub libraries, real DeepRead model reports, and rebuilt Electron/Windows installers remain unverified. They are distinct from successful archive installation, compiled native-host boot, UI rendering and deterministic service composition. No publication, push or merge occurred.

## Engram preview incident

The first linked preview accidentally used the original default user DB and added schema12 metadata. It was stopped and all later profiles explicitly use isolated Engram paths. A secure SQLite snapshot was retained; after confirming zero observations, only schema metadata was restored to11. All15 original node rows retained the identical deterministic digest, integrity_check passed, and the original installed schema11 store opened a secure copy. Project/shared databases were untouched. Exact evidence and secure snapshot location are in `engram/VERIFICATION.md`; private snapshots are not shipped.

Re-run installed parity with `python3 integrations/scripts/verify-installed.py --home /home/sushi/.local/share/bharatcode-packed-qualification-20261008 --profile integrations`. `artifacts/packed-profile.json` records the final preview command without authentication tokens.

The existing native Plugins management UI is now enabled in the shipped web bundle, with English dictionary aliases. Its full209-check suite passed across6 files, including lifecycle, configuration ledger and actual configuration form rendering. The combined browser inventory showed17 installed enabled packages, and LSP Actions reported1 component running.
