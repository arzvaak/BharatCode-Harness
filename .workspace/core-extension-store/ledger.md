# BC implementation and acceptance ledger

This is an engineering implementation, **not an accepted release**. Unfinished work is retained below rather than represented as qualification. Linux fixture evidence does not qualify native Windows, desktop exports, or hosted accounts. Source: `3567dec88a0da9726eed886166a158f53cddc470`; recoverable isolated baseline: `1c82d641eb`. Work occurs in `/home/sushi/bharatcode-extension-store`; the original checkout is preserved.

## Baseline and release contract

| ID | State | Evidence and remaining acceptance |
|---|---|---|
| A1 | Complete | 14,111 working-tree changes mostly executable-mode noise; actual tracked content patch: 54 files, 668 additions, 327 deletions. Source integrations retained; credentials, profiles, user databases, dependency installs and caches excluded. |
| A2 | Complete | Independent shared clone and baseline commit; original content patch retained outside repository. Version-probe fixtures intentionally named `node_modules` recovered separately as small test sources, not dependency installations. |
| A3 | Complete baseline inventory; release gate open | Baseline: 1,869 files passed, 12 failed, 19 skipped; 39,004 tests passed, 38 failed, 188 skipped, one expected failure, two errors. Baseline build/types had existing query-option, document-literal and research-promise errors. Those compile defects are corrected. Updated full-suite results must pass the release gate. |
| A4 | Inventory implemented | 17 existing adapted packages retained. 52 selected candidate records, four workflow packs and BC pipeline integration represented. Missing commits/licences are explicit and cannot qualify. Each catalog record retains source, licence and unresolved prerequisites. |
| A5 | Implemented foundation | Shared runtime validation covers descriptors, signed catalogs, installed identity, activation, compatibility and qualified artifacts. Fixtures reject bad signatures, hashes, archives, flags and activation ownership. Native persistence schema v1 exists; released-generation migrations are not yet qualified. |
| A6 | Implemented foundation | BC and extension versions independent; exact artifact/hash and BC semver range required. Preview catalog revisions increase monotonically. Release scripts refuse replacement of an existing tag/version. Artifact-preserving promotion gate is implemented; published-artifact proof pending. |

The pnpm 11.7 resolver crashed on inherited peer diamonds after integration workspaces were added. Pin 11.28.5. Explicit root Vite 8.0.16 and React/React DOM 18.3.1 retain the baseline test runtime; otherwise peer selection incorrectly supplied Vite 6 or React DOM 19. Workspace SDK dependencies avoid duplicate native service instances. No broad compatibility exemption is used.

## Standard core

`integrations/core.json` declares 14 default-on components. Linux source and independent distributable consumers boot them with no optional runtime. Graphics are local and default on. DSH Zero defaults to Safe; semantic memory and SearXNG remain off.

| ID | State | Evidence and remaining acceptance |
|---|---|---|
| B1 | Integrated; Linux composition verified | Visuals in CLI/web composition used by desktop, local engines and bundled notices. Native Windows fresh-install evidence pending. |
| B2 | Linux/Windows native factory exports verified; full acceptance open | Existing renderer tests cover malformed input and mixed content. Actual bundled factory chart/diagram SVG native downloads and exact-source clipboard pass in an owned Electron/Xvfb fixture with external requests blocked. Hosted Linux and Windows native factory exports/clipboard pass at ea71b399a2. Full application mixed-chat and installer acceptance pending. |
| B3 | Implemented; Linux/Windows native fixtures verified | Native package-local loader defers Mermaid/DOMPurify/ZenUML into a bundled module. Chart startup requests no engine module; diagram rendering loads exactly one local module. Main factory 119,188 bytes; diagram factory approximately 8.52 MB. No external downloads or availability toggle. Hosted native Linux and Windows graphics steps pass at ea71b399a2. |
| B4 | Partial integration | Provider Hub/subscriptions use native LLM services and shared native credential grant records. Legacy auth files import once without modification; persisted logout prevents reimport. 571 subscriptions tests, real native-provider concurrency/restart fixture, and authenticated Linux composition migration/logout pass. Actual account/onboarding and native Windows migration evidence remain pending. |
| B5 | Implemented; workflow acceptance partial | Skills Manager included; CRUD, scope and discovery tests retained. API and updater now require native authentication. Five BC-authored starter workflows are inspectable and individually installable in the manager; isolated fixture proves install/discovery/disable/removal through existing operations. Native authenticated API smoke passes; user-provider end-to-end drafting remains pending. |
| B6 | Integrated existing package; acceptance pending | Task Board bundled. Exhaustive native cancellation, restart recovery and scheduling reconciliation not yet demonstrated. |
| B7 | Integrated existing packages | Context and usage/cost interfaces bundled; native SDK used. Context package has current Config-form tests and source coverage checks. End-to-end projection/usage comparison pending. |
| B8 | Integrated existing packages | Safe Zero and Tool Call Guard bundled. Existing bounded-control tests retained; native Windows recovery proof pending. |
| B9 | Existing native services retained | Workspace/document/review/session/artifact services preserved; comprehensive rewind/review/artifact scenarios not yet run. |
| B10 | Integrated existing research source | DeepRead/Library and prior research workspace preserved. Provider-backed source-to-report end-to-end evidence pending. |
| B11 | Partial | Writing workspace and continuity source retained. Additional Oh Story functionality not adapted or qualified. |
| B12 | Partial | Common-document/coding interfaces and LSP adapter present. Explicit local requirement inspection is available for selected runtime candidates; converter/language-server managed setup remains pending. |
| B13 | Safe default retained; acceptance pending | Project-knowledge interfaces preserved; Engram excluded from default activation; no embedding download. Persistent recall qualification pending. |
| B14 | Linux composition passed; full acceptance open | Authenticated owned profile sees 14 enabled bundles and 57 catalog entries; zero optional runtimes. Fresh browser creates owned default workspace and navigates store without page errors. Native Windows and full workflow evidence pending. |

## Store and lifecycle

| ID | State | Evidence and remaining acceptance |
|---|---|---|
| C1 | Implemented transport | Fixed private repository, native credential reference, authenticated API, bounded downloads, approved redirects and revoked-access diagnostics. Real tester fetch/install not yet exercised. |
| C2 | Implemented | Ed25519 exact-byte verification, immutable size/hash, reverified offline cache; malformed/tampered fixture coverage. Matching public key bundled; private key outside repository. CI signing secret provisioned through supported repository secrets; publication pending. |
| C3 | Implemented UI | Extensions, Connections, Workflow Packs, Installed; search, prerequisites, compatibility, sizes and diagnostics. Browser navigation passed; real qualified installation UI scenario pending. |
| C4 | Implemented foundation | Verified archive staging delegates to native plugin manager; optional installs disabled. Failure/cancellation and archive-remnant fixtures. Actual published interrupted-install scenarios pending. |
| C5 | Implemented foundation | Separate persisted workspace activation; session/workspace runtime ownership; global native extensions labelled. Isolation fixture passes; native two-workspace connector proof pending. |
| C6 | Partial | Demand activation, pending-start sharing, call/schedule leases, persistent kernels and five-minute idle disposal. Closing ownership retained until teardown ends. Exact selected tool groups enforced in native MCP synchronization and dispatch; reconnect/list-notification fixtures pass. Native two-workspace account proof pending. |
| C7 | Local discovery implemented; managed setup pending | Native workspace dependency payload service retained. Explicit store inspection covers fixed Node/Python/Jupyter/DuckDB/Typst/Tinymist/FFmpeg probes and six candidate records. Native subprocess ownership scrubs credentials, bounds output/deadlines and joins termination. No inspection at boot, dependency installation, raw process output or tool injection. Qualified managed downloads/provenance/size/cancellation/removal remain pending. |
| C8 | Partial | Private GitHub credential connection/disconnection implemented. Owned connector token setup is implemented through native credentials and protects active runtimes. OAuth and progressive service selection remain pending. |
| C9 | Partial | Disable/remove/cache/update guards and active-work protection implemented. Unsafe downgrade refused; no candidate has qualified reversible migration. Settings backups and supported rollback implementation remain pending. |
| C10 | Catalog implemented; qualification open | All 57 entries visible; workflow packs expose components individually. No optional candidate is installable without release/platform evidence. |

Review found native-authentication and asynchronous-runtime-teardown defects. Both were reproduced/fixed and independently rechecked: forged-cookie request rejects with 401; signed native-session cookie admits; retiring runtime remains owned until disposal completes. Focused store/pipeline suite passed 30 tests before installed-state validation was added; subsequent suites passed installed-state and owned-credential fixtures. These are fixture results, not account/platform qualification.

## Optional capabilities and user pipelines

| ID | State | Evidence and remaining acceptance |
|---|---|---|
| D1 | Partial | Adapted GitHub source retained; GitLab/Linear/Atlassian discovery records present. Account, native lifecycle and Windows qualification pending. |
| D2 | Pending qualification | Google Workspace records identify OAuth/service requirements. Progressive OAuth setup implementation pending. |
| D3 | Pending qualification | Jupyter/DuckDB recorded; no notebook/kernel starts at boot. Local workflow and native Windows checks pending. |
| D4 | Pending qualification | Excel/Zotero/bibliography candidates recorded; adapted Zotero retained. Representative workbook/paper and account evidence pending. |
| D5 | Pending qualification | Typst/draw.io/FFmpeg/subtitle candidates recorded with prerequisites. Render/export/playback evidence pending. |
| D6 | Pending qualification | Browser/Sentry entries retain process/account requirements; adapted browser source retained. Ownership/cleanup/error evidence pending. |
| D7 | Pending individually | Every selected engineering/cloud/business/personal candidate visible with its actual restriction. No substitute or account qualification claimed. |
| D8 | Implemented package; qualification pending | Independent native pipeline tools inspect GitHub Actions/GitLab runs, jobs and logs. Reruns default off and use native ask/deny permission decisions. Bounded untrusted log handling and auth-safe redirects tested. GitHub read-only run/job/log access verified with the existing private repository. Real rerun/GitLab/native Windows workflows unqualified; package remains unavailable in catalog. |

## CI/CD and release

| ID | State | Evidence and remaining acceptance |
|---|---|---|
| E1 | Reconciled | `.github/AGENTS.md` describes actual Linux/Windows workflows and scoped release permissions. Prior fork CI retained. |
| E2 | Implemented workflow; execution pending | Source builds/types/core package tests, native owned-profile boot, packed-install and full Linux tests; Windows native process/installer fixtures; aggregate fails unless both lanes pass. Changed-package optimization not implemented. |
| E3 | Implemented workflow; Windows pending | Independent consumer installs 302 source/SDK/core/optional-CI distributable archives with lifecycle scripts disabled and platform prebuilts retained. Linux result retained; hosted-account fixture skips explicit. |
| E4 | Partial | Catalog signing, checksums, dependency/licence inventory and immutable version checks implemented. Full dependency SBOM and qualified optional release generation remain pending. |
| E5 | Gated implementation | Private preview workflow uses repository-scoped `contents: write`; publication only after reusable qualification. No preview release published yet. |
| E6 | Implemented gate; distribution proof pending | Promotion verifies signed catalog and package inventory, all published archive hashes, exact publication run/attempt and Linux/Windows/verdict/publish success. Same release changes only its prerelease flag; concurrent/unknown write outcomes restore preview status or report explicit manual recovery. Four fixtures pass; no published release exists to exercise promotion. |
| E7 | Pending | Core wired into desktop runtime; native OS installers, launch/export tests and supported signing not completed. Missing signing prerequisites must be configured, not bypassed. |
| E8 | Pending | Published-artifact upgrade/withdrawal/failed activation/rollback not exercised. |
| E9 | Partial ledger | This ledger records completion and gaps; installation/release conventions in `integrations/extension-store/README.md`. Final release notes, published install instructions and cold/warm/memory/context baseline comparison remain pending. |

## Remaining failure ownership

- Desktop packaging fixtures: update legacy artifact names to the preserved BharatCode contract; no signing-path bypass.
- Native plugin-manager/primary-runtime fixtures: diagnose actual failed assertion against current source and resolver, retain bounded startup checks.
- Catalog/persistence generators: regenerate only through their owning scripts and inspect semantic diff; preserve released session generations.
- Subagent/Python experimental tests: distinguish known baseline resource/teardown failures from regressions; no relaxed resource limits or suppressed tests.
- Native Windows and real-account evidence: execution/credentials requirements; source test fixtures cannot substitute.
- Implementation gaps above: BC implementation work, not external blockers. No release-complete claim is justified while they remain.

Logs stay local under `.workspace/core-extension-store/*.log`; signed packages and consumer inventories stay under ignored `dist/`. They are evidence rather than committed source or credentials. Original profiles, projects and credentials were not used as qualification fixtures. All new application homes are owned temporary directories and removed after each run.

Latest full root inventory: 1,881 files passed, three failed; 39,036 tests passed, 11 failed (nine Python resource-limit cases, one known subagent teardown case, one gate-wrapper assertion since corrected), 183 skipped and one expected failure. Serializing repository-mutating lint fixtures before the source-scanner inventory removes ephemeral-file races without dropping any tests. Focused gate suite: 138 passed. Context package: 1,853 passed, 80 compatibility fixtures skipped; all per-file source coverage gates at 100%.

Latest scoped checks: pending build approval merges existing and newly blocked selectors without changing explicit decisions (19/19); MCP qualification allowlist applies to every synchronization generation and dispatch (129/129 native MCP tests); five starter-skill lifecycle checks; authenticated native core smoke checks store and Skills Manager, 14 default bundles, 57 catalog entries, zero optional runtimes.

## Current execution handoff

The original checkout still reports the same 54 content changes (668 additions, 327 deletions); no source, live profile, credential or user-project mutation was made there. Current isolated build and type checks pass. Final Linux packed-consumer proof uses 302 distributable archives and passes native core and optional-pipeline registration/default-denial fixtures.

The latest full native repository run passes 1,881 files / 39,041 tests and fails 11 tests: nine Python address-space/resource cases, one persistent PowerShell scrollback/composition case, and one subagent teardown notice case. The earlier transient MCP composition regression is fixed; exact allowlists survive reconnect/list notifications while omitted policy retains existing connections (native config plus roster focused suite 70/70). No failures are filtered from the aggregate CI verdict.

Core-package tests complete their inventory but remain red on Cost Meter's legacy upstream verification: BC English copy, defaults, suppressed onboarding, explicit provider fixtures, qualified catalog and strict pricing assertions have been reconciled; remaining upstream assumptions must be assessed against the adapted source. This failure must block publication.

The signing key is provisioned as repository secret `BC_EXTENSION_CATALOG_KEY`; only its public verification key is shipped. No preview release, stable promotion, installer release or OS-signing credential is claimed. GitHub account read-only list/inspect/jobs passed against an existing private-repository run (37837305056); logs/reruns and GitLab real-account workflows remain unqualified.

Promotion review reproduced and fixed evidence-run substitution, unsigned extra archives, and post-write failure recovery. The release inventory now has its own Ed25519 signature and records the publishing run and attempt. Four fixtures cover stable byte retention, tampering/evidence refusal, concurrent mutation and lost responses. The complete store/pipeline fixture inventory passes 37 tests. Promotion has not been invoked; required native qualification is still red.

A single fresh owned-profile Linux measurement recorded 876 ms until authenticated core readiness and 392,355,840 bytes host RSS after five idle seconds, with zero optional runtimes and a 34,445-byte catalog projection. This is not a cold/warm renderer or baseline comparison; renderer, engine initialization and request-context measurements remain pending.

Private draft PR #9 is open. First hosted Linux and Windows lanes failed during install because workspace `prepare` scripts built adapted Library/LSP packages before native SDK declarations existed. CI installation now explicitly disables lifecycle scripts; the owning root/core build steps run in dependency order afterward. This also matches the approved dependency-script policy. Local frozen install under that policy passes. The optional pipeline API retrieved the authenticated failed Linux job log (70,664 bytes) with its untrusted-evidence marker; no rerun mutation was performed.

The second hosted qualification run (37912545676) failed both lanes. Windows additionally exposed short-path expansion misclassified as a linked skill source, a HOME-only compatibility fixture, and a five-second ledger fixture budget too short for bounded native PowerShell lock probes. Source link ownership now uses actual lstat links; fixture paths use canonical realpath/homedir; the Windows ledger fixture retains its assertions with a 30-second bound. Local Skills Manager passes its full suite, context compatibility passes eight fixtures with 80 historical-checkout skips, and task ledger passes 46 fixtures. Native Windows rerun remains required. The stale subagent disposal fixture now follows native keepInbox semantics and passes the 149-test continuation suite; the PowerShell scrollback case passes in isolation but its composition flake remains unresolved.

Cost Meter now passes its complete command: 11 BC native tests followed by all retained upstream verification imports. Explicit fixture-owned tariffs preserve positive arithmetic/currency/migration tests without adding unqualified automatic provider prices. English/default/route assertions match the adapted BC contract. Product defects fixed by those fixtures include omitted TurnCost arithmetic/call detail, missing statistics RPC retry, ambiguous zero-cache reporting, absent OpenRouter default dereference, and repeated unchanged DeepSeek price upgrades. Pricing matching covers 273 backend/client cases; sidebar rendering covers 256 combinations. Reviewer found no Important/Critical regressions; successful TurnCost rendering remains directly asserted in client-issues-127-129. Native Windows proof remains pending.

B2 native graphics export fixture now passes on Linux using an owned Xvfb display and Electron 44 profile. The actual prebuilt factory renders its default chart and local Mermaid sequence diagram with external requests blocked; native SVG delivery yields 7,228/40,876 bytes and exact-source clipboard delivery 239/229 bytes. Renderer sandboxing stays enabled. The launcher removes its profile after process exit to respect Windows file locks. Both CI lanes now require this fixture; Windows evidence and full application mixed-chat/installer acceptance remain pending.

Latest hosted run 37918267048 failed native graphics before the remaining checks. Linux rejected an unconfigured Electron SUID helper; CI now configures the downloaded helper root:root/4755 on its ephemeral runner and keeps sandboxing enabled. Windows reached native clipboard delivery and exposed standard CF_UNICODETEXT CRLF conversion; its fixture now compares exact content with platform-native line endings. Both require a fresh hosted rerun.

Local dependency-inspection review found ambient credential inheritance and immediate-child-only termination. Both are replaced by the existing native subprocess service and its scrubbed environment/managed range. Seven fixtures pass, including credential/host-identity scrubbing, ignored TERM, forced deadline, and a descendant retaining stdio whose owned PID is confirmed gone. All 44 store/pipeline fixtures and authenticated native core smoke pass. Managed downloads remain unavailable; inspection does not qualify or install any candidate.

Physical graphics splitting retains every local engine and licence notice. Sixteen graphics fixtures and native Linux chart/diagram SVG download and clipboard pass. Main module is 119,188 bytes; engine module is loaded only on diagram rendering. This measures module bytes and demand loading, not full application cold/warm startup or idle-memory comparison.

Independent review found no remaining Important or Critical issues in local dependency inspection and physical graphics splitting; reviewer reran all 44 store/pipeline and 16 graphics fixtures successfully. Native Windows and managed-download evidence remain separate gates.

The public operation contract now projects only action-owned fields before host/native operations and is also used by the UI. All 46 store/pipeline fixtures and authenticated Linux core smoke pass. Graphics composition now resolves the preserved repository by location rather than an old machine-specific source path; real YAML Loader prompt ownership and Cordis/SlotCore activation/disposal pass and run with the graphics package test command. Fresh independent Linux distributable qualification passes all 302 archives with 14 default core bundles and zero optional runtimes. Original content patch was rechecked byte-for-byte against the recoverable baseline (SHA-256 df2f56b52967a7964b4d6bbe7b4c125a663ee54428ffebb02b568892a38ae29f).

Pinned MotherDuck/DuckDB upstream MIT licence and 1.1.0 runtime requirements were verified from commit 41acb581d9bc04e427655ba5178b2c5c01f68cd2. Catalog requirements now state exact DuckDB/Python requirements, explicit local database/write configuration and separate cloud-account scope. No distribution or runtime qualification is claimed.

Hosted native run 37921920275 (ea71b399a2) passed full build/types/core builds and offline factory exports/clipboard on Linux and Windows. Linux core tests then failed the Cost Meter credential-description start race, which counted 100 event-loop turns before I/O could start. Explicit start latches retain the race assertions, add delayed credential I/O and impose a five-second deadline; focused and full retained Cost Meter verification pass. Overall qualification is still failed/open. Signed candidate dependency ranges now supplement native runtime floors. Full installed version identities are validated rather than coerced from development builds into stable releases; native parsing fixtures cover Python development/prerelease suffixes and Jupyter dev versions. All 48 store/pipeline fixtures and native Linux core smoke pass.

Native subscription credentials now use the host credential record transaction rather than runtime auth.json writes. Native provider and owned Linux profile fixtures prove migration, preserved legacy bytes, concurrent account updates, persisted logout and restart. 571 tests pass with explicit denial and persistence-acknowledgement cases. Windows portability fixes for graphics Loader file URLs and Skills Manager canonical temp paths are pushed in ce78c32d79; hosted aggregate rerun 37925052334 remains in progress.

After native credential migration, the independent Linux consumer again installed all 302 packed archives with dependency scripts disabled and passed the authenticated migration/logout core smoke: 14 enabled core bundles, 57 entries, zero optional runtimes. This evidence covers native storage with synthetic credentials; real provider consent and generation remain unverified.
