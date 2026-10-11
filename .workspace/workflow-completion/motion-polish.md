# Workflow visual and motion polish

This pass follows the approved OpenGhost engineering audit in `motion-audit.md`.
The choreography, timings, shapes and styling here are original BharatCode work.
It retains the existing warm palette and uses the theme's actual border and
reading-font tokens. No OpenGhost animation or visual-design source was copied.

## Delivered

- Consistent fields, action styling, spacing and dividers across Writing,
  Research readers, analysis records and document review.
- Writing structure uses paired fields when there is sufficient space, a single
  column on narrow panes, and a bounded independently scrolling area so the
  manuscript retains room. Its measured opening reveals space progressively.
- The document editor remains mounted while structure opens/closes. Rich prose
  has the reading font, a constrained line length and a visible keyboard focus
  indicator; coarse-pointer controls have 44px minimum targets.
- Source readers, selected-passage evidence forms, edit review/proposals and
  changed analysis status receive short contextual transitions. Stable records
  and ordinary text input do not repeatedly animate.
- The shared helper samples an interrupted visual transition before replacing
  it, cancels obsolete animations, disposes on owner change/unmount, and responds
  immediately when the OS switches to reduced motion. CSS interactions honour
  reduced motion too. No persistent animation loop was added.
- MCP App authorization and frame removal keep their existing immediate lifecycle;
  this pass adds no delayed app exit, editor remount, streaming buffer or data
  mutation behavior.

## Verification

- Seven focused UI files / 22 tests passed, including preservation of an unsent
  textarea node, rapid reversal, owner cleanup and reduced-motion changes during
  an animation. Existing prose, exact-selection review and app-frame tests pass.
- Client build and Web build passed. Changed-source Oxlint and `git diff --check`
  passed.
- Shipped keyless Web workflow: 4 tests passed in refresh and 4 in replay. The
  Writing acceptance now also asserts real field borders/backgrounds and draft
  preservation with reduced-motion toggling after a saved brief reload.
- Browser fixture uses the real Writing, Research and document components with
  explicit synthetic project/evidence/run records. It verifies measured expansion,
  unchanged Lexical DOM, keyboard focus, draft preservation, reduced motion,
  populated Writing/Research/Runs, 390px/1280px layouts and 44px touch targets.
  It reports no page errors. Screenshots cover both themes at wide/narrow sizes;
  the probe records a local browser video under the ignored `browser/videos/`.
- Independent GPT-6 Luna verification at max reasoning found missing prose focus
  and reader-form insets initially; both were fixed. Its final review reported no
  actionable findings in the revised motion/CSS or editor lifecycle.

Reproduce the component browser inspection by starting the existing Vite fixture
and running `node .workspace/workflow-completion/browser/polish-probe.mjs`.
The fixture is supplemental evidence; shipped Web reload/replay is separate.
Logs and screenshots are ignored under this evidence folder.

This is source/build/browser verification in the isolated
`implementation/workflow-completion` branch. No installed desktop or public
release was replaced. The actively changing continuation and Visuals checkout
must be combined with these commits before a release build, as described in
`implementation.md`.
