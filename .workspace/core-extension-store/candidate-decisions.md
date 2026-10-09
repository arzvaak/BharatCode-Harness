# BC Harness: wider plugin and integration decisions

Research date: 2026-10-09. This extends [the first decision report](BC-PLUGIN-DECISIONS-20261009.md); it does not replace its coding/research baseline.

**Core selection update:** The user subsequently requested a fuller standard core, including the locally authored chat graphics engine and core workflow workbenches. lanSee [BC Core Selection](BC-CORE-SELECTION-20261009.md) for the superseding packaging decision. The external candidate evidence below remains applicable.

## Decision

Expand BC through three supported routes: native DSH/Cordis plugins for workbenches, MCP connectors for outside applications, and portable skill packs for repeatable workflows. Present them through one capability catalog with clear prerequisites and enable only the tools a workflow needs. A connector existing upstream is not evidence that BC's authentication, transport, UI, or real-model execution works with it.

The next qualification wave should focus on Google Workspace, Jupyter, FFmpeg/subtitles, Typst, editable diagrams, bibliography checking, Zotero reading, spreadsheet inspection/editing, issue trackers, and browser debugging. These expand the range of tasks users can complete beyond software development. Engineering, infrastructure, publishing, CRM, and home automation belong in optional packs.

The earlier shortlist remains useful: Checkpoint/Rewind, Git Review, LSP Actions, Context7, Library, DeepRead, Research Report, Office Tools, and selective disclosure of tool schemas. Keep SearXNG deferred. Keep BC's existing provider/session/agent mechanisms and explicit model choice.

## Evidence and limits

- 30 searches of the official MCP registry collected 393 unique latest-version records. This is discovery metadata, not 393 audited or BC-tested integrations. Searches were capped at 30 results per term; some had more pages. The registry does not endorse every server it lists.
- 48 repositories have exact HEAD commit identifiers and available README/package/license snapshots in `plugin-far-search-20261009/inventory.json`. These are documentation and manifest checks, not exhaustive source audits. GitHub API rate limits were handled with public `git ls-remote` and raw files at the pinned commit.
- Primary vendor documentation was checked for hosted services, including Linear, Atlassian, Figma, GitLab, Sentry, Cloudflare, Hugging Face, AWS, Stripe, HubSpot, WordPress, n8n, Home Assistant, and accessibility tooling.
- BC's inspected fork is `0.2.0-rc.2`; desktop uses Electron 44. Broad or wildcard peer declarations are not proof of compatibility. Old `^0.1.0-rc.6` or `<0.2.0` ranges need adaptation and exact-host composition checks.
- Nothing in this research pass was installed, activated, authenticated, or tested against a live user account.

## Research, data, and office workflows

| Candidate / primary source | Useful workflow | Decision and concrete condition |
|---|---|---|
| [Datalayer Jupyter MCP](https://github.com/datalayer/jupyter-mcp-server) | Open/edit/execute notebook cells, inspect outputs, turn data analysis into a reproducible notebook. | **Select for qualification.** Prefer this maintained upstream route initially. Requires Jupyter environment and runtime access; qualify kernel lifecycle, cancellation and output handling. BSD-3-Clause upstream. |
| [Native DSH Jupyter](https://github.com/kikulmj/dsh-jupyter) | Notebook workbench embedded in the harness. | **Adapt later.** Manifest declares Apache-2.0 but older DSH peers. Native panel is useful only after exact-host and licence-file checks. Do not bypass peers. |
| [MotherDuck/DuckDB MCP](https://github.com/motherduckdb/mcp-server-motherduck) | Query local analytical data and DuckDB databases; optional MotherDuck connection. | **Select local analytics route.** Distinguish local DuckDB from cloud account requirements. Useful beside Data Insight/SQL, with explicit write capability. |
| [Microsoft MarkItDown](https://github.com/microsoft/markitdown) / [DSH adapter](https://github.com/jiekesu967/dsh-markitdown) | Convert common document formats into readable Markdown for research and subsequent authoring. | **Select as ingestion component.** Real conversion engines and OCR should be identifiable; fallback conversion is not equivalent. MIT Microsoft project. This complements MinerU rather than replacing difficult PDF OCR/layout handling. |
| [Excel Chat / Vera](https://github.com/hccccc01333/dsh-excel-chat) | Read, edit and clean spreadsheets; inspect formula results and generate reports. | **Select for qualification.** Bundle 0.40.0 declares MIT and broad peers. Core editing does not require Excel; charts/PDF export rely on Windows Excel. Formula verification claims need representative real-workbook proof. |
| [Reference Checker](https://github.com/Yu-tao-Li/dsh-reference-checker) | Check bibliography entries against scholarly metadata sources. | **Select academic pack.** Preserve found/partial/not-found/error states and evidence. A missing match is not proof a citation is fabricated. MIT. |
| [Zotero DSH](https://github.com/Hongcheng-LI/dsh-zotero) | Search an existing Zotero collection, inspect metadata, read local full text and attachments. | **Select reading connector.** Zotero must run with local communication enabled. Upstream documents local API note writes as unavailable on tested versions; do not promise writable notes. |
| [Hugging Face MCP](https://huggingface.co/docs/hub/agents-mcp) | Discover models, datasets, research papers and selected Space tools. | **Select research/model-discovery connector.** Separate Hub discovery from paid inference-endpoint provisioning. Tools exposed by third-party Spaces require individual qualification. |
| [MATLAB MCP, MathWorks](https://github.com/matlab/matlab-mcp-server) | Run and inspect MATLAB work in engineering/scientific projects. | **Optional licensed engineering pack.** Requires an installed supported MATLAB and the user's licence. Not a free MATLAB replacement or universal default. |
| [Obsidian ACP bridge](https://github.com/SilenZerOrz/obsidian-dsh-acp) | Use BC in an existing notes/vault workflow. | **Optional interoperability route.** Verify ACP handshake and workspace ownership; do not create another memory store just to connect a vault. |

## Writing, creative work, and media

| Candidate / primary source | Useful workflow | Decision and concrete condition |
|---|---|---|
| [Typst Preview](https://github.com/Limbo-137/dsh-typst-preview) | Edit technical reports with rendered previews. | **Select publishing pack.** Version 0.3.8 declares MIT and peer range including BC rc.2. Requires tinymist; verify desktop preview and export. |
| [Oh Story](https://github.com/zenstory-ai/oh-story-dsh) | Long-form fiction, short drama, interactive stories, video recap workflows. | **Retain and expand creative pilot.** Current 0.1.14 documents BC rc.2 support and native host/model usage. English docs do not prove all UI/prompts are English; inspect them before offering. MIT. |
| [DSH Translator](https://github.com/SiYue-ZO/dsh-translator) | Side-by-side text translation with glossary and persona choices. | **Adapt for translation pack.** Version 0.2.0 declares MIT but peers `<0.2.0` exclude current BC. It handles text/plain-text files, not general PDF/DOCX/audio translation. |
| [Subtitle Studio](https://github.com/JohnXu22786/subtitle-studio) | Parse, translate, merge and export SRT/VTT while retaining alignment and glossaries. | **Select alongside media tools.** Default external DeepSeek route must be replaced/configured to native DSH provider mode and verified with chosen user models. MIT declaration. |
| [DSH FFmpeg](https://github.com/STARDUSTLC666/dsh-ffmpeg) | Probe/cut/concatenate/transcode media, extract audio/subtitles/frames and make GIFs. | **Select media utility.** Version 0.4.5 declares MIT; requires ffmpeg/ffprobe. Verify outputs and dependency discovery on Windows/macOS/Linux. |
| [draw.io official MCP](https://github.com/jgraph/drawio-mcp/tree/main/mcp-tool-server) | Create editable diagrams from Mermaid, XML or CSV. | **Select visual authoring route.** Standard tool-server first. Hosted inline editor uses MCP Apps, a separate host capability that BC has not been qualified for. Complements existing visuals when editable diagram files matter. |
| [DeepBlend](https://github.com/pearjelly/deep-blend) | Blender scene authoring, inspectable revisions and renders in a workbench. | **Optional 3D pack.** Requires Blender; documented baseline is DSH 0.1.5-rc.2, so BC rc.2 compatibility needs proof. MIT project declaration. |
| [Blender MCP](https://github.com/ahujasid/mcp-for-blender) | Connect to an existing Blender installation without needing a custom workbench. | **Alternative to DeepBlend.** Pick one primary route per pack after testing; inspect addon version, process access and optional telemetry settings. |
| [DSH CAD](https://github.com/LAU-MARS/dsh-cad) | Parametric models, constrained sketches, 2D/3D previews and fabrication exports. | **Optional CAD pilot.** Actual repository LICENSE is Apache-2.0 despite MIT README badge. Resolve package/documentation discrepancy before redistribution. Qualify real export geometry. |
| [FreeCAD MCP](https://github.com/tspspi/mcpFreeCAD) | Operate the user's existing FreeCAD installation. | **Alternative CAD connector.** Requires FreeCAD and bridge setup. Prefer this for existing FreeCAD projects; avoid enabling multiple competing CAD toolsets by default. |
| [QGIS MCP](https://github.com/jjsantos01/qgis_mcp) | Geospatial operations inside an existing QGIS environment. | **Optional desktop GIS route.** Requires QGIS and plugin bridge; exact API/environment qualification needed. |
| [DSH WebGIS](https://github.com/Mekansm1/DSH-WebGIS) | Interactive maps, vector data and PostGIS workflows. | **Web-host pilot only.** Version 0.2.0 targets rc.2, but upstream explicitly says official desktop transport unsupported. Not a general BC Desktop promise. |
| [Tylina](https://github.com/tylina/dsh-tylina) | Typst-based academic/report/slide authoring with packaged engine. | **Hold for redistribution review.** README explicitly describes proprietary core npm dependencies. Prefer open-source Typst Preview for the initial pack. |

## Everyday work and connected applications

| Candidate / primary source | Useful workflow | Decision and concrete condition |
|---|---|---|
| [Google Workspace MCP](https://github.com/taylorwilsdon/google_workspace_mcp) | Work across Gmail, Drive, Docs, Sheets, Slides, Calendar and other Google applications. | **Highest-value connected-work pilot.** Community project, not Google official. Supports 120+ tools across twelve services and progressive tiers/read-only mode. Requires Google Cloud OAuth client/API setup; BC must make that setup understandable. MIT upstream. |
| [Linear official MCP](https://linear.app/docs/mcp) | Turn discussion/research into tracked issues, projects and status updates. | **Select team-work connector.** Qualify Streamable HTTP/OAuth; read-only endpoint exists for initial onboarding. |
| [Atlassian Rovo MCP](https://developer.atlassian.com/cloud/rovo-mcp/) | Connect Jira/Confluence work and documentation. | **Select alongside Linear as account choice.** Requires Atlassian account/admin-compatible setup; test available scopes/tools, not assumed parity with all product APIs. |
| [GitLab official MCP](https://docs.gitlab.com/user/model_context_protocol/mcp_server/) | GitLab projects, merge requests and workflow context. | **Select GitLab alternative to GitHub.** Currently beta; server access must be enabled at group/instance level. HTTP and proxy routes supported upstream. |
| [n8n instance MCP](https://docs.n8n.io/connect/connect-to-n8n-mcp-server.md) | Discover and trigger suitable existing automations. | **Optional automation pack.** Requires configured n8n instance/access and workflows exposed to MCP. Do not imply every workflow or arbitrary graph edit is available. |
| [WordPress official MCP adapter](https://github.com/WordPress/mcp-adapter) | Operate site capabilities registered through WordPress Abilities. | **Optional publishing pack.** GPL-2.0-or-later adapter and site setup/authentication required. Available tools depend on registered abilities; no automatic claim of complete publishing coverage. |
| [Postiz agent integration](https://github.com/gitroomhq/postiz-agent) | Prepare, schedule and publish to configured social channels. | **Optional publishing connector.** Auth/account/self-host prerequisites apply. User-visible drafts and explicit publishing intent are needed for real actions. |
| [HubSpot MCP](https://developers.hubspot.com/ai-tools) | Read and update supported CRM records. | **Optional business pack.** Distinguish CRM remote MCP from developer app-building tooling; auth app beta and account support need qualification. |
| [Stripe official MCP](https://docs.stripe.com/mcp) | Work with supported Stripe account/development operations. | **Optional business pack.** Qualify exact tool/scoping/account behaviour; do not infer arbitrary money-transfer functionality from MCP availability. |
| [Home Assistant MCP](https://www.home-assistant.io/integrations/mcp_server/) | Inspect home context and control exposed devices/assist tools. | **Optional personal automation pack.** Existing Home Assistant required. Streamable HTTP with OAuth or token; OAuth uses URL client metadata/IndieAuth rather than RFC7591 registration, so a generic DCR-only client fails. |
| [Figma official MCP](https://developers.figma.com/docs/figma-mcp-server/) | Retrieve design context and supported canvas operations. | **Hold remote availability promise.** Figma documentation limits remote connections to clients in its catalog. Establish BC eligibility first; desktop routes have separate prerequisites. |

## Engineering operations, quality, and continuity

| Candidate / primary source | Useful workflow | Decision and concrete condition |
|---|---|---|
| [Sentry official MCP](https://mcp.sentry.dev/) | Investigate application errors and performance with live project evidence. | **Select operations connector.** OAuth and explicit organisation/project scope; test real trace/error access. |
| [Cloudflare official MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) | Inspect or manage supported Workers, account and infrastructure services. | **Optional cloud pack.** Choose service-specific capabilities; configured account and write scope required. |
| [AWS agent tooling / MCP](https://github.com/awslabs/mcp) | AWS diagnostics and service operations. | **Optional cloud pack.** Upstream now points to Agent Toolkit for AWS as successor; evaluate current recommended path, IAM and service costs. Do not ship every historical AWS MCP server. |
| [Microsoft MCP](https://github.com/microsoft/mcp) | Supported Azure/Microsoft developer services. | **Optional cloud pack.** Service-specific onboarding; this repository is not proof of a complete Microsoft 365 connector. |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) | Reproducible browser interaction and application checks. | **Select developer QA option.** Distinct from casual browsing; integrate with current browser ownership and avoid two uncontrolled browser lifecycles. |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Debug network/console/performance in Chrome. | **Select developer debugging option.** Useful instrumentation beyond browser clicks; requires Chrome and deliberate session attachment. |
| [BrowserStack MCP](https://github.com/browserstack/mcp-server) | Cross-browser/device testing through existing test infrastructure. | **Optional paid/account QA pack.** Account/product entitlement required; no universal free device-lab promise. |
| [Deque Axe MCP](https://www.deque.com/axe/mcp-server/) | Accessibility findings and assisted fixes during frontend work. | **Optional accessibility route.** Qualify product/account entitlement; automated checks cannot establish full accessibility conformance. |
| [Codegraph](https://github.com/JohnXu22786/codegraph) | Local symbol search and transitive impact queries across code. | **Pilot beside LSP Actions.** Python/SQLite implementation with CLI and MCP-style tool server; validate actual protocol/language resolution, do not treat heuristic call edges as compiler truth. |
| [DSH DevOps](https://github.com/Jackson-chen97/dsh-devops) | GitLab pipelines/MRs plus Kubernetes operations in a workbench. | **Optional combined ops UI.** Compare with official GitLab and selected Kubernetes tooling before adopting overlapping tools; kube/token dependencies. MIT declaration. |
| [DSH Kubectl](https://github.com/WODE25500/dsh-kubectl) | Execute Kubernetes operations through configured local kubectl. | **Hold for focused operations qualification.** Wildcard peers prove little; explicit context and apply/delete/exec behaviour need checks. |
| [Hyzyn plugin kit](https://github.com/hyzyn/dsh-plugin-kit) | Selected Docker/RSS/screenshot/task and utility modules. | **Select modules individually.** Current rc.2 declarations are useful; do not install its whole toolkit by default. Apache-2.0 upstream. |
| [Cloud Sync](https://github.com/dickpy/dsh-cloud-sync) | Backup/restore supported harness configuration and optional plugin sources via selected storage backend. | **Optional continuity pack.** This is not verified whole-project sync. Gist mode explicitly syncs configuration only; qualify restore, conflicts and sensitive fields before offering. English adaptation required. |
| [Session Search Pro](https://github.com/LeslieWylie/dsh-session-search-pro) | Find useful previous sessions. | **Adopt capability via native session query, adapt plugin if needed.** Older peer ranges; no need for another agent memory engine. MIT. |
| [Lost and Found](https://github.com/wangzhanchao883/dsh-lost-and-found) | Find files across user-selected directories using local indexes. | **Optional local knowledge pack.** rc.2-compatible range declared; verify Windows/Linux/macOS path handling and index freshness. MIT. |
| [Daruma](https://github.com/SISCHOI/daruma) | Controlled provider failover after selected request failures. | **Hold pending native-retry overlap review.** Actual plugin 0.1.8 peers `<0.1.6` exclude current BC. User-selected fallback routes, replay boundaries and credential ownership required; no automatic model/provider substitution. |
| [DSH Eval](https://github.com/hccccc01333/dsh-eval) | Scripted workflow evaluations, traces and comparisons. | **Internal qualification candidate.** Older peers; useful for proving packs before public availability, not mandatory for end users. |
| [Issue2PR](https://github.com/LONGSASASASASA/dsh-issue2pr) | Opinionated issue-to-change pipeline. | **Do not default-install.** Reconcile staged approval/planning with BC's native workflow before adding another orchestration layer. |

## First qualification wave

1. Google Workspace + Linear/Atlassian account choice: complete a document/calendar/issue workflow with account connection and scoped tools.
2. Jupyter + local DuckDB: run an analysis, inspect outputs and save a reproducible notebook.
3. FFmpeg + Subtitle Studio: turn an input clip/subtitle file into verified exported media and aligned translated subtitles using the user's configured model.
4. Typst Preview + draw.io: produce a rendered report and an editable diagram artifact.
5. Reference Checker + Zotero reading: trace claims to stored papers and preserve ambiguous citation outcomes.
6. Excel Chat: edit representative workbooks and verify formulas/artifacts on supported platforms, including clearly separated Windows Excel features.
7. Oh Story: qualify English creative workbenches without switching the user's provider.
8. Playwright/DevTools + Sentry: connect reproduction steps to browser evidence and application errors.

Then offer optional engineering (CAD/Blender/QGIS/MATLAB), cloud/DevOps, publishing/business, local-knowledge/continuity, and personal-automation packs.

## What BC needs to expose these well

Use one catalog record per capability with upstream identity, pinned version/commit, licence evidence, desktop/web support, runtime dependency, account requirement, transport and tool groups. Tell users whether a package is discovered, source-reviewed, composition-tested, activated or end-to-end verified. Those are different states.

MCP support should qualify stdio and Streamable HTTP, OAuth variants, token credentials, reconnect/cancellation and bounded tool outputs. MCP Apps UI is a separate qualification target. Portable skills should invoke existing BC mechanisms rather than replace its provider, session or agent runtime.

Offer workflow packs such as Research, Data/Notebooks, Office, Creative Writing, Media, Engineering, Team Work, Cloud Ops and Publishing. Keep their tools discoverable on demand so broader availability does not inject every schema into every session. English UI/help/errors/prompts and provider-independent execution remain requirements. Account-gated/paid tools must show that prerequisite before installation.

## Evidence files

- `plugin-far-search-20261009/inventory.json`: exact repository commit and snapshot file inventory.
- `plugin-far-search-20261009/mcp-registry-search.json`: queries and registry responses.
- `plugin-far-search-20261009/mcp-registry-candidates.json`: deduplicated discovery records.
- Per-repository directories: README, manifests and available licence evidence. Missing licence snapshots are unresolved evidence, not permission to redistribute.

No blanket peer-check exceptions, installs or activation are implied by selection here.
