# BharatCode Harness

English | [中文](README.zh.md)

BharatCode Harness is a personal fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), the open-source agent harness developed by [DeepSeek AI](https://deepseek.com), retargeted as the BharatCode workspace: workflow-first flavors, dedicated views per field, and BharatCode branding.

Like upstream, everything is a plugin on [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512). Upstream documentation remains the reference: [deepseek-harness docs](https://deepseek-harness.github.io/deepseek-harness/).

## Developer preview

Upstream is in _developer preview_ and iterating rapidly — **compatibility-breaking changes happen**, and this fork inherits that status. Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run the Desktop app

The Electron Desktop app is the primary surface. From a repository checkout:

```sh
pnpm install
pnpm run build
DSH_DESKTOP_WEB_PORT=19400 pnpm exec tsx apps/desktop/scripts/start-linux-local.ts
```

`start-linux-local` prepares the pinned primary runtime and a development profile, then boots Electron with an isolated home and user data, so it runs beside an installed instance. `DSH_DESKTOP_WEB_PORT` selects the port; the default Desktop port is 19387.

### Run the Web UI

```sh
git clone https://github.com/arzvaak/Bharatcode-Harness.git
cd Bharatcode-Harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts; `pnpm dsh web` serves the built artifacts without rebuilding. Flags reach `dsh web`, for example `pnpm run dev:web --no-open --port 3081`.

## Release flow

Nothing reaches `main` without passing the gate set. Candidates are pulled into `alpha`, promoted to `beta`, then released to `main`:

```text
upstream (read-only) ── manual sync PR ──► alpha ◄── candidate/* & feature PRs
                                              │
                                   promotion PR (required checks)
                                              ▼
                                             beta ── 3-day soak + smoke ──► main (default, tagged)
```

| Branch | Purpose | Gates |
|---|---|---|
| `alpha` | Integration: upstream syncs, candidates, features | Slim: frozen install, build, unit tests, brand tripwire |
| `beta` | Stabilization | Full: test matrix, config-snapshot diff, plugin-row diff, brand tripwire, smoke |
| `main` | Released state — default branch | Beta promotion PR only: full gates, 3-day soak, agent-run smoke, human merge |

The **config-snapshot diff** catches the failure upstream tests cannot: the Cordis Loader warns and skips a patch row whose `id` no longer exists, so an upstream row rename would silently revert an override without failing any test.

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits; `pnpm run dev:desktop` builds and launches Desktop; `make help` lists the matching Make targets. The guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md). Contributions upstream go to [CONTRIBUTING.md](CONTRIBUTING.md).

## Upstream and attribution

- Forked from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) under the MIT License; this project is described as _built on DeepSeek Harness_ per the upstream [brand guidelines](https://github.com/deepseek-ai/deepseek-harness/blob/master/BRAND_GUIDELINES.md).
- Local changes are recorded as `local/*` commits on top of the pinned upstream base; see the journal for decisions and pending work.
- The `dsh` CLI, profiles, bundles, and Cordis plugin system are unchanged upstream technology.

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
