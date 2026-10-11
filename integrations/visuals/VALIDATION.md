# Validation — 7 October 2026

## Native export qualification added 9 October 2026

`scripts/native-export.mjs` loads the actual bundled client factory in an owned
Electron 44 profile with renderer sandboxing enabled. External requests are
blocked. On Linux under an owned Xvfb display, both the default chart and bundled
Mermaid sequence diagram rendered, exported through native download delivery
(7,228 and 40,876 bytes), and copied their exact original source through the native
clipboard (239 and 229 bytes). The fixture uses Electron 44's asynchronous
clipboard API and deletes its profile after the process exits. Both platform CI
lanes now run this check. Windows results remain pending.

This establishes native export/clipboard delivery for an owned factory fixture.
Full desktop startup, model-generated mixed chat and installer qualification
remain separate acceptance checks.

## Verified

- `npm test`: 15 passing tests. Coverage includes signed/zero numeric ranges, bounded inputs, source routing, closed streaming fences, literal hostile labels, cross-segment link definitions, native content preservation, slot late registration/disposal, diagram sanitization, SVG serialization and actual prebuilt factory activation/disposal.
- `npm run build`: standalone Harness module-loader factory generated successfully. React is supplied by the host; other browser dependencies are bundled. The archive includes third-party license texts in `lib/licenses` and linked bundle notices.
- `npm run test:composition`: real installed Harness YAML Loader activated/disposed the system-prompt guide in an isolated fixture. Real Cordis ownership and SlotCore correctly shadowed and restored the native assistant slot. This check uses built Cordis directly because the source checkout currently contains unrelated Cordis test stubs; no live application files were changed.
- Browser gallery: all seven custom designs and 21 Mermaid examples produced SVG, with zero errors and zero pending renderers. Sequence, ER, state, class, mind map, Gantt, journey, quadrant, requirements, Git, grouped flow, C4, Sankey, XY, blocks, packet, Kanban, architecture, radar, treemap and ZenUML were exercised.
- Preview source editing applied a changed title/value; Reset restored the original. Invalid numeric source showed an error and preserved the original graphic. The expanded data table showed exact source values.
- Light and dark designs visually inspected. Mermaid's natural dimensions were preserved after correcting an over-scaling issue. At a 390px viewport, the document stayed within its viewport and metrics stacked vertically; dense charts retain local horizontal scrolling.
- SVG serializer checked for valid XML, original viewBox, concrete dimensions, resolved background, typography, labels and removal of keyboard-only attributes.
- Dependency audit: zero known vulnerabilities. Mermaid's transitive KaTeX is pinned to patched 0.18.2. DOMPurify is pinned to 3.4.16. Reproduce with the lockfile.
- Installation helper dry-run against the installed desktop refused a busy host, as intended.

Screenshots from the browser are saved in `artifacts/gallery-light.png`, `gallery-dark.png`, `gallery-diagrams.png` and `gallery-narrow.png` in the development checkout. The preview uses the same graphics components as the plugin; screenshots are not evidence of live Harness installation.

## Not yet verified

The plugin has not been added to the live Desktop profile or tested in a real model-generated conversation. Harness was running agents throughout verification. Its source CLI also currently fails module resolution against unrelated Cordis stubs in that checkout; installation should use a working installation-owned CLI after that work is complete.

The in-app browser did not report a download event from either SVG export attempt. Serialization is tested, and the browser click did not show an export error, but native Desktop download delivery and clipboard delivery still need a live host check. Source copy reported success in the preview; the browser connector's separate clipboard reader did not return its contents.

No Harness source files, running agent state or live profile metadata were changed. No GitHub repository or marketplace listing was published.

The physical module split was exercised on native Linux with the prebuilt factories: chart startup requested zero diagram modules, and the first diagram requested one bundled local module. SVG download and native clipboard assertions passed for both. Sixteen unit fixtures pass, including failed local-engine loading and retry. Native Windows qualification remains pending.

## 2026-10-11 refinement

Visuals 0.1.1: production client build and all 19 tests passed, including source-disclosure keyboard focus, 320px chart geometry, reduced-motion behavior, no reveal replay on controls, and disposal cleanup. Real YAML Loader/SlotCore composition passed. The browser gallery rendered all 28 custom/Mermaid examples with zero errors and zero pending diagrams after settling. At a 390px viewport all simple chart canvases fit their panels; dense flow geometry scrolls at readable size. Light and dark themes, rejected BOXED source, and applying a valid signed-bar edit were inspected.

SVG serialization retains final geometry, resolved colors and background in the automated check. Browser download-event delivery and clipboard delivery could not be confirmed in the Codex in-app browser; no success claim is made for them.

A local AppImage was built from the previously installed EPIPE-fixed binary, replacing only the Visuals package. The previous binary and launcher backups are retained. Live mounted package/archive parity and session-file digests are checked after activation. This is a local installation, not a published release. The user's original BOXED reply was not present in the local sessions examined, so the updated authoring guidance is preventive rather than a reproduced provider-backed fix.

## LaTeX clarification (0.1.2)

The reported issue concerns LaTeX, and no original failing reply was available. Corrected the earlier formatting guidance: legitimate \boxed{...}, fractions, aligned environments and native math delimiters are explicitly supported. The extension does not render prose equations itself. Two integration regressions exercise the actual Visuals wrapper with native MarkdownText: inline and multiline boxed equations on either side of a graphic retain exact TeX and render both boxes; incomplete streamed math stays literal and typesets on settlement without errors. The existing native Markdown and incremental suites also pass (67 tests). A browser check using the native KaTeX version and existing display overflow rules rendered boxed quadratic, aligned fluid equations and a wide summation identity; wide formulas scroll from their left edge. No reproduced renderer defect is claimed.

## Formula-sheet layout (0.1.3)

Rendered the user's persisted transmission-line answer through the actual native Markdown/KaTeX component with the extension stylesheet in Chromium at 1000px, 560px, and 390px viewport widths. All eight formula rows retain their original TeX annotations, have no KaTeX errors, and produce no page or formula-cell overflow. Formula notation is 19.72px at the default font setting; labels are above the expressions. Narrow screens wrap the equivalent forms naturally. Styling changes only the outer KaTeX box, preserving its internal metrics. Light and dark color schemes use separate heading and equation-surface colors.

## Heading hierarchy and display math (0.1.4)

Rechecked the original transmission-line answer in dark mode with larger section headings (32px) and colored formula titles (20px). Equations use neutral ink at 24px on desktop and 21.6px in narrow containers. Formula-table products use display metrics, and equivalent expressions are aligned on separate lines with units attached. The presentation projection uses mdast source ranges, skips source code and link URLs, and preserves the stored answer. Tests cover original expression preservation, idempotence, escaped dollars, unfinished math, native streaming, and settled product limits.
