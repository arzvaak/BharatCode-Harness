# OpenGhost motion study and BharatCode polish gap

Inspected on 11 October 2026. This is a source audit and design proposal, not a
claim that every effect was exercised or that aesthetic quality was measured.
BharatCode implementation baseline: the connected workflow implementation on `implementation/workflow-completion`.

The earlier delivery verified functionality, recovery, ownership, and security.
It did not deliver or verify a complete OpenGhost-level visual/motion treatment.
The workflow surfaces need a dedicated polish pass.

## Source identity and scope

The installed/local OpenGhost source is at
`/home/sushi/Applications/openghost-source`, HEAD
`42f0dc879f3cc443552d6b27a9b7998d3cc1deee`; it has existing provider integration
changes. I left that checkout untouched. Its source is behind upstream.

For current coverage I read an independent, sparse checkout of upstream at
`2646bb9b8ae526a8bdc6646cc70cba36f6a551d2` in `/tmp/openghost-motion-audit-20261011`.
I surveyed root application scripts/styles, the entry-point composition, shared
primitives, stream/diagram rendering, interaction controllers, and the separate
website motion. The inventory below identifies 56 root files containing
motion markers. Counts describe source call sites, not the number of effects or
runtime coverage. Controls inheriting IconButton also animate without declaring
their own animation loops. WebGL splash rendering is another supporting layer.

## How the system actually works

| Layer | Implementation | What makes it feel coherent |
|---|---|---|
| Control feedback | [icon-button.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/icon-button.js) defines a custom element with shared spring states; individual icon controls inherit it | Pointer and keyboard press, hover, release, blur, and disable all participate in the same state model |
| Continuous motion | Icon controls, search, effort controls, scrollbar, media slider and chart highlights integrate position and velocity in requestAnimationFrame | Motion can change direction from its current position instead of restarting a canned animation |
| Discrete transitions | CSS plus the Web Animations API; common timing families and component-specific enter/exit sequences | Opening, confirming and leaving have distinct roles; not everything uses the same fade |
| Stable geometry | [smooth-height.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/smooth-height.js), [message-fold.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/message-fold.js), and measured list positions in [chat-list.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/chat-list.js) | Content makes room deliberately; lists animate between measured positions rather than suddenly jumping |
| Trigger continuity | [dock.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/dock.js), [model-stage.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/model-stage.js), effort stages, [photo-viewer.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/photo-viewer.js) | The expanded control or viewer visibly comes from the thing that opened it and returns toward it |
| Reading/streaming | [stream-view.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/stream-view.js) paces arriving text, patches existing DOM, and manages reveal spans and settling heights | Previously readable content stays stable while new content arrives |
| Visual explanations | The keyed Scene in [diagram.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/diagram.js) retains items, retargets properties and interpolates paths | An updated chart/diagram transforms from its earlier state, preserving the user's mental map |
| Focus and hierarchy | [selection-focus.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/selection-focus.js), layered panels, overlays, depth, and coordinated surrounding content | Motion directs attention to the current interaction while retaining context |

There is no application dependency on Framer Motion, GSAP, or a generic UI
animation framework in the inspected package manifest. Most motion is authored
plain JavaScript/CSS, with custom elements, SVG, canvas and a WebGL splash.
Shared primitives exist, but this is not one centralized animation engine:
component controllers own much of the orchestration and their own constants.

The spring loops track position/velocity, clamp frame delta, subdivide numerical
steps and stop near rest. Discrete effects use `animate()` and its finished
promise. Several controllers measure the current rendered state and cancel
old animations before replacing them. Scene items use stable keys. Together
these mechanisms make rapid interaction much less likely to snap back to an
old starting pose.

The list implementation uses FLIP: measure old positions, update the layout,
measure new positions, temporarily invert the displacement, then animate to
rest. It also accounts for nested folder displacement. This is the useful
principle for source lists, document tabs, history rows and run lists.

The stream renderer maintains the authoritative source separately from what
has been painted. It reacts to backlog, then drains when generation ends;
Markdown blocks that did not change are retained, and diagram/media components
are updated in place. BharatCode must preserve exact copy/export text and
accessibility semantics if it adopts any original streaming treatment. It
should not add mandatory typing delays just to make an effect visible.

## Additional interaction coverage

- Search: upstream now has Spotlight, with a measured result area, focus/keyboard
  handling, and a compact panel sequence. The older SearchField remains source
  context; it should not be mistaken for the current primary search flow.
- Model/mode/effort: expanded controls, staged labels, moving selection indicators,
  geometric morphing, and separate selection/closing sequences.
- Conversation: queued-message acknowledgement, message folding, attachment
  insertion/removal/reflow, selection menus, approvals, questions, and statistics.
- Notes and memory: panel opening, row insertion/removal, space allocation,
  loading-to-content transitions, and review/confirmation states.
- Media/browser: drag velocity, rubber-band limits, spring settling, image
  origin-to-viewer motion, tab entry, progress, and agent cursor feedback.
- Brand/ambient: thinking/welcome ghost, launch choreography, dust and WebGL mist.
  These are distinctive identity elements; they are unnecessary for a functional
  motion foundation and should not be reproduced in BharatCode.
- Website: separate reveal choreography, pointer parallax, hero motion, FAQ
  expansion and theme changes. The site pauses its hero when offscreen or hidden.
  Website effects should not be imported wholesale into a working editor.

## What BharatCode already has

The shell is not motion-free. `ui-theme/src/styles/bharatcode.css` defines control,
content, sidebar and figure durations, including a reduced-motion override.
The shell has sidebar layout transitions, modal/toast feedback, and other existing
motion. `WorkflowWorkspace.tsx` adds a small, cancellable profile transition
with a reduced-motion guard and preserves the composer across profile switches.

The new Writing/Analysis/Git/App surfaces are largely straightforward controls,
forms and lists. Writing/Analysis fields have only basic local styling; they need
consistent input surfaces, typography, focus states, grouping and responsive
layout. Document toolbars also need clearer hierarchy between editing, review
and evidence actions. These are source-based observations; a full visual audit
of all populated light/dark/narrow layouts remains to be done.

## Recommended original BharatCode pass

1. Refine the static design first: consistent fields, intentional writing/research
   typography, calmer toolbars, clear primary actions, coherent panel spacing,
   useful empty/loading/error states, and compact/expanded layouts.
2. Build a small motion layer around the existing tokens: reversible presence,
   interruptible measured height/layout, moving selection indicators and feedback.
   Avoid a new large dependency unless these primitives prove insufficient.
3. Give each workflow a specific interaction story: evidence opens beside its
   cited passage; a proposal unfolds from its selected text; a Run keeps its
   place as it changes state; Writing structure opens without disrupting the
   manuscript; Coding diagnostics and diff review leave the editor stable.
4. Preserve continuity under rapid input: transitions start from current visual
   values, obsolete completions are ignored, and unmount/session/project change
   cancels loops and disconnects observers. Do not remount Monaco or Lexical just
   to replay entrance effects.
5. Retain immediate semantic closure for MCP Apps and owned sessions. An exit
   animation must not keep an old tool bridge authorized after Close or a switch.
6. Validate light/dark, narrow/wide, keyboard/touch, reduced motion, rapid reversal,
   content streaming, loading/error, long documents and actual completed Runs.
   Record representative motion and inspect it; functional tests alone cannot
   establish visual polish. Measure expensive blur/filter/layout work before
   claiming performance.

Use mostly action-driven motion. Keep active reading and editing steady.
Choose original shapes, easing, timings, typography and choreography rather than
copying OpenGhost's effect definitions. The existing BharatCode identity should
remain recognizable.

## Constraints and useful criticism

[LICENSE](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/LICENSE) explicitly excludes its animations and application visual
design from the MIT source-code grant. This study supplies engineering patterns
and a gap analysis; it does not authorize transplanting those effects/designs.

Reduced-motion handling is widespread but component-local, and cleanup is not
uniform: SmoothHeight observes content without a public disposal API in the
inspected source. BharatCode's plugin/session lifecycle requires explicit owner
cleanup rather than assuming every reference implementation is suitable as-is.
Blur, per-letter animation, large backdrops and continuous ambient rendering
have real costs; source inspection does not establish frame rate or battery use.

## Complete static motion-marker inventory

WAAPI = direct `.animate(...)` call sites. RAF = scheduling call sites. Keyframes
= declarations. A zero does not mean a file is static: it can inherit a primitive
or set a CSS state that animates elsewhere. This inventory is an audit index,
not a runtime correctness or accessibility certification.

| Source file | WAAPI | RAF | Keyframes | Reduced-motion marker |
|---|---:|---:|---:|---|
| [approval-card.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/approval-card.js#L15) | 3 | 0 | 0 | yes |
| [ask-card.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/ask-card.js#L27) | 16 | 0 | 0 | yes |
| [attachments.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/attachments.js#L23) | 3 | 0 | 0 | yes |
| [browser-panel.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/browser-panel.js#L17) | 2 | 2 | 0 | yes |
| [browser-toggle.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/browser-toggle.js#L22) | 0 | 0 | 1 | yes |
| [chat-list.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/chat-list.js#L15) | 6 | 2 | 0 | yes |
| [chat.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/chat.js#L239) | 4 | 6 | 0 | yes |
| [clear-button.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/clear-button.js#L16) | 0 | 0 | 0 | no direct marker |
| [composer-text.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/composer-text.js#L30) | 1 | 2 | 0 | yes |
| [desktop.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/desktop.js#L19) | 0 | 0 | 0 | yes |
| [diagram.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/diagram.js#L138) | 4 | 4 | 0 | yes |
| [dock.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/dock.js#L69) | 14 | 2 | 0 | yes |
| [dust.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/dust.js#L33) | 0 | 2 | 0 | yes |
| [effort-morph.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/effort-morph.js#L22) | 0 | 2 | 0 | yes |
| [effort-paint.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/effort-paint.js#L32) | 0 | 2 | 0 | yes |
| [effort-slider.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/effort-slider.js#L28) | 0 | 2 | 0 | yes |
| [effort-stage.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/effort-stage.js#L27) | 8 | 0 | 0 | yes |
| [folder-pill.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/folder-pill.js#L10) | 1 | 0 | 0 | yes |
| [ghost-thinking.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/ghost-thinking.js#L63) | 0 | 2 | 0 | yes |
| [icon-button.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/icon-button.js#L7) | 0 | 2 | 0 | yes |
| [link-chip.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/link-chip.js#L16) | 1 | 0 | 0 | yes |
| [lock-ui.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/lock-ui.js#L50) | 36 | 2 | 0 | yes |
| [media-embed.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/media-embed.js#L30) | 1 | 0 | 0 | yes |
| [media-slider.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/media-slider.js#L20) | 0 | 2 | 0 | yes |
| [memory.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/memory.js#L166) | 7 | 0 | 0 | yes |
| [message-fold.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/message-fold.js#L13) | 1 | 0 | 0 | yes |
| [mini-chat.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/mini-chat.js#L19) | 1 | 2 | 0 | yes |
| [mode-picker.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/mode-picker.js#L16) | 3 | 0 | 0 | yes |
| [model-button.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/model-button.js#L16) | 0 | 0 | 0 | yes |
| [model-stage.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/model-stage.js#L42) | 23 | 3 | 0 | yes |
| [notepad.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/notepad.js#L51) | 18 | 0 | 0 | yes |
| [photo-viewer.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/photo-viewer.js#L24) | 10 | 0 | 0 | yes |
| [queued-ring.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/queued-ring.js#L26) | 6 | 0 | 0 | yes |
| [quick-chat.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/quick-chat.js#L57) | 10 | 4 | 0 | yes |
| [quick-photo.css](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/quick-photo.css#L50) | 0 | 0 | 0 | yes |
| [row-glide.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/row-glide.js#L37) | 0 | 0 | 0 | no direct marker |
| [row-menu.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/row-menu.js#L29) | 2 | 2 | 0 | yes |
| [scrollbar.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/scrollbar.js#L14) | 0 | 2 | 0 | yes |
| [selection-focus.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/selection-focus.js#L14) | 2 | 1 | 0 | yes |
| [selection-menu.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/selection-menu.js#L66) | 0 | 1 | 0 | no direct marker |
| [settings-appearance.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/settings-appearance.js#L216) | 2 | 0 | 0 | yes |
| [settings-button.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/settings-button.js#L32) | 0 | 0 | 0 | no direct marker |
| [settings-general.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/settings-general.js#L14) | 2 | 0 | 0 | yes |
| [settings-language.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/settings-language.js#L17) | 0 | 2 | 0 | yes |
| [settings-memory.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/settings-memory.js#L12) | 3 | 0 | 0 | yes |
| [settings-usage.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/settings-usage.js#L26) | 0 | 4 | 0 | yes |
| [settings.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/settings.js#L28) | 2 | 0 | 0 | yes |
| [smooth-height.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/smooth-height.js#L6) | 0 | 2 | 0 | yes |
| [splash.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/splash.js#L135) | 12 | 4 | 0 | no direct marker |
| [spotlight.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/spotlight.js#L25) | 3 | 1 | 0 | yes |
| [stats-card.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/stats-card.js#L23) | 9 | 2 | 0 | yes |
| [stream-view.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/stream-view.js#L11) | 0 | 2 | 0 | yes |
| [styles.css](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/styles.css#L597) | 0 | 0 | 56 | yes |
| [theme.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/theme.js#L16) | 1 | 0 | 0 | yes |
| [usage-peek.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/usage-peek.js#L63) | 4 | 1 | 0 | yes |
| [welcome-ghost.js](https://github.com/ANDRETRIPOL/OpenGhost/blob/2646bb9b8ae526a8bdc6646cc70cba36f6a551d2/welcome-ghost.js#L16) | 5 | 2 | 0 | yes |
