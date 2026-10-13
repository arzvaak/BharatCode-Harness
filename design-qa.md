# BharatCode Workbench design QA

Date: 2026-10-13

final result: passed

## Evidence and scope

- Source visual truth: `/mnt/slow-stuff/deepseek/ui-workbench-20261013/selected-workbench.png` (option 2, approved for implementation and iteration).
- Implementation: real Harness at `http://127.0.0.1:19392/`, using an isolated QA profile and fixture conversation. The source file viewer and terminal are functional; conversation content and chart values are illustrative fixtures, not a live model run.
- Equal-size comparison: `/mnt/slow-stuff/deepseek/ui-workbench-20261013/workbench-source-matched.png`. Source and implementation are both 1487 × 1058 pixels; implementation CSS viewport 1487 × 1058, device pixel ratio 1. No density resampling. Source is a generated raster mockup with no independent CSS viewport metadata.
- Desktop handoff: `/mnt/slow-stuff/deepseek/ui-workbench-20261013/workbench-final.png`, 1440 × 1024 pixels/CSS viewport, density 1.
- Narrow evidence: `/mnt/slow-stuff/deepseek/ui-workbench-20261013/workbench-narrow.png`, 390 × 844 pixels/CSS viewport, density 1.
- State: dark theme, populated session, sidebar expanded on desktop, source file open on the right, terminal below it, composer at bottom of conversation. Narrow capture uses the compact navigation rail and collapsed output pane.
- Source and equal-size implementation were opened together in the same comparison input after the final fixes. Earlier comparisons also informed layout iterations. Full-resolution text, icons, composer, navigation and code were readable in the comparison; additional cropped images were unnecessary.

This is an adaptation into the existing product, not a literal reproduction of generated mock content. The mock shows a diff review; the final evidence shows a real source file and an inline chart. Existing Chat/Trajectory/Context tabs, model/context/permission controls, session metadata, registered tools and terminal controls remain functional. These content and control differences are expected. Native brand assets and the existing icon system remain in use.

## Findings and iteration history

No actionable P0/P1/P2 finding remains in the reviewed scope.

| Earlier finding | Severity and impact | Fix | Post-fix evidence |
| --- | --- | --- | --- |
| Tools dominated the navigation before projects and conversations | P2: weak hierarchy relative to option 2 | Moved registered tools and workflows into a footer disclosure; retained settings and selected-session orange rail | Final desktop and matched screenshots; disclosure opened in browser and tools verified accessible |
| Terminal consumed the conversation's lower space | P2: composition departed from the mock and compressed chat | Dock terminal under the output pane when that pane is open, preserving full-height chat; retain fallback layout when output is closed/fullscreen | Final desktop and matched screenshots |
| Focusing/typing in terminal shifted the entire app upward | P1: persistent controls moved out of view | Constrained terminal flex sizing and overflow in the rightbar and layout seat | Browser after typing: frame height/scrollHeight 1024/1024, scrollTop 0; terminal height/scrollHeight 260/260; final screenshot shows title and composer intact |
| A terminal-only split left an empty resource pane | P2: blank space reduced useful code area | Remove empty projected resource panes while preserving persisted terminal layout; use original layout for split capability | New regression failed before fix, passed after; final source viewer occupies available pane |
| Sidebar footer produced an unwanted horizontal scrollbar | P2: distracting overflow in persistent navigation | Set footer overflow-x hidden while retaining bounded vertical scrolling | Final desktop and matched screenshots |
| Chart toolbar and bars became too tall in the conversation column | P2: density drift in split view | Adjusted compact breakpoints, title treatment, chart spacing and neutral prose headings | Motion timing figure in final desktop and matched captures |
| Wide diagrams could not reach readable native scale | P2: zoom ceiling too low for large diagrams | Derive maximum zoom from actual diagram width and measured viewport | Browser 24-node wide diagram reached 5560px native width from a 309px viewport; viewport unit tests |
| Fit handled width only and retained scroll offsets | P2: tall diagrams remained clipped after Fit | Fit both dimensions within the 580px canvas and reset scroll on Fit/source changes | Browser tall 24-node diagram fit to 579.97px height with offsets reset; interaction tests |
| Zoom bounds stayed stale after resizes above the chart width cap | P2: wrong diagram controls after pane resize | Track raw measured width separately from capped chart width | 800-to-1000px resize regression test passed |

## Required fidelity surfaces

- **Fonts and typography:** Retained native system sans stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, CJK fallbacks, `Helvetica Neue`, Helvetica, Arial, sans-serif), with code in the existing monospace renderer. The raster reference does not identify a licensed font. Body prose uses 16px/27px, neutral 25/21/18px heading hierarchy, stronger navigation labels and compact metadata. Wrapping and truncation were inspected at desktop and narrow widths. The implementation is intentionally denser in source/tool controls than the illustrative mock. Raster antialiasing is not treated as a pixel-matching target.
- **Spacing and layout rhythm:** 280px default sidebar, 40% default output allocation, independent pane scrolling, fixed composer, terminal under output, restrained 8/12px control/figure radii. Desktop retains the reference's three working regions and lower-right terminal. Narrow layout measured body scroll width equal to 390px viewport, without page-level horizontal overflow.
- **Colors and tokens:** Warm dark surfaces, quiet hairline borders, off-white foregrounds, restrained orange selected/action emphasis. Graphics use distinct orange, teal and lilac series. Native shared focus tokens remain visible; reduced motion is supported. No ornamental gradients were added to approximate mock texture.
- **Image quality and assets:** Existing BharatCode mark and product icons are retained. The app is rendered live, not flattened into a screenshot. Native charts and diagrams remain SVG for sharp scaling/export. No generated decorative artwork is required by this workbench. Grammarly's small composer overlay visible in screenshots comes from the browser extension, not the product.
- **Copy and content:** New persistent label is “Tools & workflows,” with English and Chinese translations. Existing session and composer copy stays native. Fixture messages explain layout and motion only inside the isolated QA conversation and are not shipped as interface copy. The mock's static diff, timestamps and model labels are not treated as functional requirements.

## Interaction and motion verification

- Opened real source, resized panes, expanded Tools & workflows, collapsed output at narrow width, opened a real terminal and executed `pwd` in the isolated fixture workspace. No live model invocation was required.
- Shared 140/220/320ms control/content/panel timing and eased panel tracks; figure entrances reveal once, with staggered bars/nodes and path reveals. Hover, editor interaction and zoom do not replay the entrance. Reduced-motion preference cancels running animation and source changes reset the appropriate state.
- Chart legend toggles update visible series and prevent hiding the last series. Arrow-key navigation moves between points and updates readout.
- Tested wide and tall diagrams, Fit, zoom, source edits and resize behavior. SVG export resolves animation to settled geometry instead of exporting an intermediate reveal.
- Checked browser console in the final fresh preview: observed an external Grammarly stylesheet error, no application error. Earlier hot-reload/server-restart errors were resolved before final captures.
- Automated verification: 189 UI test files / 2,246 tests passed; 31 graphics tests passed; real YAML loader and Cordis renderer composition/restore smoke passed. After the final split-capability adjustment, 16 rightbar files / 262 tests passed. These 262 are a targeted rerun, not additional unique coverage.
- Client, graphics and web builds passed. The last footer overflow change was followed by the client build and browser recapture. `git diff --check` passed.

## Remaining test gaps and follow-up polish

- This pass verifies the source build and isolated real browser app. The installed AppImage and public release were not updated or tested.
- Final visual comparison targets dark mode. Light mode retains native tokens but did not receive an equivalent final screenshot review.
- Device-specific animation performance, extended screen-reader use, all possible provider/session states and the entire repository test suite are outside this pass. Native math and renderer suites were included in the scoped UI tests.
- No P3 item is required for handoff. Further typography or motion preferences can be evaluated in daily use without changing the underlying session architecture.

## Implementation checklist

- [x] Implement option 2 in native shell and conversation components.
- [x] Improve chart/diagram interaction, motion and settled exports.
- [x] Preserve native math, plugin lifecycle and registered controls.
- [x] Fix issues found during browser and independent code review.
- [x] Compare source and final render together, including matched dimensions.
- [x] Save desktop/narrow evidence and leave local preview available.

## Release integration verification

The release checkout carries the approved Workbench changes and private chat links. The copied-link browser test sends completed history to two selected models and confirms the source history remains unchanged. Desktop bridge and layout tests pass, and the graphics suite also retains the newer delayed Apply regression. Installed platform qualification is recorded separately by the release gates and package reports.
