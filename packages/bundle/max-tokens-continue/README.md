---
description: "Auto-continues a turn cut off by the provider output-token cap, so a truncated response resumes in the same turn instead of ending mid-sentence."
kind: "package-bundle"
---

# @local/max-tokens-continue

English | [中文](README.zh.md)

## Summary

When a response is cut off by the provider's output-token cap, this layer keeps the turn alive: its plugin watches the agent stream for a `max-tokens` finish and steers a short continuation prompt back into the same turn. The shipped `web` profile template includes it; any other profile can name it as one more bundle. History is never rewritten, so the session log stays the single source of truth. The row's `config` sets the budget and the prompt.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped `web` template already lists this bundle, so a fresh `web` profile — and the Desktop profile the Electron shell initializes from the same template — mounts the row with no further step. Other profiles gain it by naming it in their bundle list or through `dsh plugin add`.

### Install into a profile

A path install links the package into the profile and appends it to the profile's bundle list:

```text
dsh plugin --profile <name> add /path/to/packages/bundle/max-tokens-continue
```

Alternatively add `@local/max-tokens-continue` to the profile's `dsh.profile.bundles`; in-box bundles resolve from the dsh installation before the profile's own `node_modules`. A named bundle whose package.json declares no `dsh.bundle` is skipped with a warning at load, and the rest of the profile stays active.

### What you get

One row, `max-tokens-continue`, whose plugin steers a short continuation user message back into a truncated turn:

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Master switch; `false` registers no listeners. |
| `maxContinuations` | integer 1–64 | `9` | Steers allowed per turn. |
| `requireProgress` | boolean | `true` | Skip a steer when the cut-off attempt streamed nothing. |
| `prompt` | string | built-in | The continuation message steered into the turn. |

A completed step after a cut recovers the turn outcome, so the transcript reports the turn as finished once the continuation runs clean; a turn that never completes still reports `max-tokens`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document: one `insert` row over the empty profile root, mounting the plugin that this same package ships in `src/`.

### Composition mechanics

A patch replaces the target row's whole `config` rather than merging into it, so a later layer or the user's profile `cordis.patch.yml` overrides the row by id with the last write winning. The row watches `agent/assistant-stream` frames for a `finish` whose kind is `max-tokens`, then at `agent/turn-stopping` — serial, no `next()` — checks the abort signal, the streamed-progress guard, and the per-turn budget before calling `agent.steer()` with an ordinary user message. Steering clears the finish marker, so one cut-off finish steers at most once.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: the insert row and its default config |
| [`src/index.ts`](src/index.ts) | The plugin: stream tracking, the turn-stopping hook, and the `Config` schema |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [app-boot profile section](../../boot/app-boot/README.md) — how profiles resolve, layer, and reconcile bundles.
- [Bundle package map](../README.md) — the surfaces a profile composes.
- [Generated config catalog](../../../docs/config-catalog.md#localmax-tokens-continue) — the row's configuration keys.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the plugin this bundle mounts, which steers a continuation message into a truncated turn.

#### KV Cache effect

The bundle itself adds no request prefix; each steer reaches the model as an ordinary user message appended to the existing history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits tell you when the continuation stops helping or how to turn it off. They are current package constraints, not a general comparison or a task backlog.

- **One steer per cut-off finish, capped per turn** — `maxContinuations` bounds the steers a single turn may receive, so a route that truncates repeatedly ends the turn after the budget instead of looping.
- **`requireProgress` skips no-content cuts** — when the cut-off attempt streamed nothing at all, the plugin does not steer, because an immediate re-cut would burn the budget without model progress.
- **Disable it per profile, not per request** — the row is profile-wide: a profile that needs strict truncation semantics sets `enabled: false` in its own patch layer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The turn-outcome rule this bundle relies on lives in `packages/core/agent-loop/src/agent.ts` (the `local/32k-turn-recovery` commit): a completed step after a max-tokens cut recovers the turn, a null step end clears only a closable turn, and a fresh max-tokens step re-marks it. The bundle was carried from the working installation as `@local/max-tokens-continue` and converted to a workspace package so the repository gates type-check and document it.

</details>
