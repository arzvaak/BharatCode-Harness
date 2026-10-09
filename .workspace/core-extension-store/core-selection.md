# BC standard core and optional extensions

Decision revision: 2026-10-09. The user clarified that core workflow functionality, including the locally authored chat graphics extension, must ship with BC. This supersedes the smaller-core recommendation in the conversation. This is a product selection and packaging proposal, not an installation or release-readiness claim.

## Standard core

Core means included in the standard BC installation and accessible without visiting the extension catalog. The chat graphics engine is included and enabled by default: no installation, enablement step, separate download or account is required for its local charts and diagrams. Internal lazy initialization may reduce startup work while keeping graphics immediately available when an answer contains them. Other panels, models, language servers and background processes need not all start at launch.

| Included capability | Implementation direction | Loading policy |
|---|---|---|
| Rich chat and graphics — enabled by default | `@local/dsh-visuals` layered over native chat; inline charts, Mermaid/ZenUML, data tables, source preview editing and SVG export | Bundle and enable the full graphics feature by default; split renderer modules so heavy diagram code loads when a visual is encountered. This split is proposed work, not verified existing behavior. |
| Provider and subscription access | Provider Hub plus the existing subscriptions integration and native credential storage | Include settings/login interfaces; initialize selected providers and account flows as needed. |
| Skills Manager | Reconcile the existing Skills Manager package; discover, install, manage and enable skills | Include manager and curated starter skills; load task instructions selectively. |
| Task Board and execution tracking | Reconcile the task-board candidate with native todo/job/goal/session services | Include board, persistent task state, run controls and status; render board on opening. Avoid competing task ledgers. |
| Scheduling and continuation | Native schedule/job mechanisms surfaced through consistent task controls; bounded max-token continuation | Include workflow support; background activity follows explicit schedules/running work. |
| Context inspector | Reconcile `dsh-context` and native context projections | Include inspection interface; detailed browsing loads when opened. |
| Usage and cost view | Reconcile Cost Meter and existing usage projections | Include compact status and detail panel; distinguish provider-reported usage from estimated pricing. |
| Reversible output reduction | DSH Zero Safe/Lean/Off | Include controls and recovery; qualify real-model behavior before choosing the release default. |
| Tool-call compatibility | Tool Call Guard | Include lightweight hooks; qualify behavior across supported providers. |
| Checkpoint and Rewind | Native session/file-change integration plus qualified checkpoint extension where useful | Include recovery UI; checkpoint storage must be bounded and visible. |
| Git Review | Native review/diff interfaces with missing workflow functionality filled in | Include review UI; repository work runs when requested. |
| Session search and navigation | Native session query plus richer search UI where needed | Include search; avoid a separate duplicate conversation store. |
| Files, artifacts and previews | Native workspace browsing with result links and supported previews | Include common artifact handling; specialized viewers load on opening. |
| Research workbench | DeepRead + Library + Research Report workflow, reconciled with native files/artifacts | Include reading, source organization and report workflow. Download large OCR/parser dependencies only when required. |
| Writing workbench | Oh Story-derived or reconciled writing workflow plus general outlining/editing/report skills | Include standard writing interface/templates; specialized story modes remain selectable and use the user's chosen provider. |
| Common document workflow | Office Tools / MarkItDown integration and qualified preview/export path | Include workflow controls and lightweight support; heavy converters/runtimes install on first use. Do not promise every format needs no dependency. |
| Coding intelligence entry points | LSP Actions plus documentation lookup integration | Include UI and configuration; language servers are installed per language/project, not all bundled. Documentation account/network prerequisites remain visible. |
| Project knowledge and memory controls | Explicit workspace knowledge; Engram candidate for persistent recall after qualification | Include visible scope/inspect/clear/disable controls. Embedding models and advanced indexing are opt-in downloads; existing Engram review/compatibility work remains unresolved. |
| Extensions and connectors | Existing plugin manager, shared MCP bridge, capability catalog and on-demand activation controller | Include management infrastructure; no external connector is automatically connected. |

## Graphics evidence

Local `dsh-visuals/package.json` identifies `@local/dsh-visuals` 0.1.0, with a DSH engine requirement of >=0.2.0-rc.2 and native chat/renderer injection.

README documents seven custom chart/procedure designs, Mermaid 12.1 plus ZenUML, native content preservation, source preview editing and portable SVG serialization/export. The current prebuilt browser bundle is documented as about 8 MiB uncompressed; it is not currently a proven split/lazy-loaded engine.

`dsh-visuals/VALIDATION.md` records unit, isolated real-loader/slot composition and browser-gallery checks. It explicitly leaves live desktop activation, real-model conversation rendering, and native clipboard/download delivery unverified. These records were inspected, not rerun during this selection update.

The README still documents English/Chinese controls. English-only reconciliation must cover UI/settings/help/errors/prompts without altering user-authored diagram language or stable identifiers.

## Optional extensions

Keep application-, account- and domain-specific tooling in the catalog: Google Workspace; GitHub/GitLab; Linear/Atlassian; Jupyter/DuckDB; advanced Excel workbench; Zotero/reference checking; Typst/draw.io; FFmpeg/subtitles; Blender/FreeCAD/QGIS/MATLAB; Playwright/DevTools/Sentry; cloud/Kubernetes; WordPress/Postiz/CRM/billing; n8n/Home Assistant; voice/image endpoints.

Research/Writing/common-document workflow interfaces are core even when their advanced engines are optional. Typst, Zotero, Jupyter and media production remain explicit additions rather than compulsory dependencies of those interfaces.

## Bloat controls

- Separate included code, enabled capabilities, active processes and exposed tool schemas.
- Ship prebuilt internal plugins with the standard product; no end-user package installation to unlock essential workflow UI.
- Split client chunks by panel/renderer and initialize heavyweight engines only when needed.
- Reuse existing local applications/runtimes; offer managed dependency downloads where feasible.
- Connect external services only after account setup; expose relevant tool groups on demand.
- Keep one native provider/session/agent/task authority; reconcile plugin views around it.
- Use explicit settings for persistent memory, scheduled execution and model fallback.
- Measure package size, cold/warm startup, idle memory and request-context overhead before release; no numerical budgets or performance results are claimed here.

Source: local project journal and package records. The historical candidate table is not current release clearance. Detailed external candidates remain in [BC Plugin Far Search](BC-PLUGIN-FAR-SEARCH-20261009.md).
