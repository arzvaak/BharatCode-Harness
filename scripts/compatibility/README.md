# Fork compatibility

English | [中文](README.zh.md)

The accepted upstream record, behavior register and GitHub Actions checks govern upstream integration. The original rebranding worktree remains independent. The initial record identifies the previously accepted source commit; its empty artifact list means that no old artifact identifiers were retained. Each successful new lane records its exact source SHA, upstream SHA, Node/pnpm versions, lockfile SHA-256, run URL and artifact name. GitHub assigns the artifact IDs, which the release-candidate manifest records.

## Daily upstream integration

Configure a GitHub App installed only on this repository with Contents, Pull requests, Issues and Workflows read/write permissions. Store its App ID as repository variable `UPSTREAM_APP_ID` and its PEM private key as secret `UPSTREAM_APP_PRIVATE_KEY`. Workflows permission permits pushing upstream workflow changes; installation-token pushes trigger ordinary PR checks. No personal access token fallback is used. Missing credentials fail after recording read-only drift; no branch or PR changes occur.

The daily workflow compares upstream master with `baseline.json` on protected master. It merges trunk and upstream into one `sync/upstream` branch, preserving prior candidate repairs and upstream ancestry. A normal push refuses concurrent remote movement. It opens or updates one PR; conflicts abort the merge and update one blocking issue. The accepted record changes on the candidate only, becoming authoritative after reviewed merge. An upstream history rewrite requires human investigation. Integration never auto-merges, force-pushes, deletes tests or rewrites expected outputs.

```sh
node scripts/compatibility/upstream.mjs report upstream/master HEAD
node scripts/compatibility/upstream.mjs validate
```

The preparation command mutates its checkout and runs only in a clean, disposable candidate checkout. Keep the daily-driver profile and concurrent development worktrees separate.

## Required evidence

The `build + unit + config` check builds the complete product, verifies effective profile settings, runs negative controls and persistence-format checks, and retains the full default unit suite. `Linux replay + web + desktop` runs committed-session replay, built CLI expectations, built browser scenarios and the real Electron main/preload/Web Host under Xvfb. `Windows unsigned runtime` builds and packages on native Windows, runs the packaged runtime smoke and checks missing-dependency rejection. The `fork compatibility` aggregate fails if any required lane fails, cancels or skips. GitHub-hosted runners own these exhaustive checks; local commands provide focused feedback.

```sh
pnpm install --frozen-lockfile
pnpm run build
node --test scripts/compatibility/*.test.mjs
node scripts/compatibility/composition.mjs
pnpm exec vitest run scripts/compatibility/continuation.spec.ts apps/desktop/tests/runtime-tree.spec.ts
pnpm exec vitest run --config vitest.expected.config.ts apps/cli/tests/profiles/web/tests/fork-compatibility.expected.e2e.ts
xvfb-run -a pnpm exec tsx scripts/compatibility/linux-desktop.ts
```

Install Electron's runtime before the desktop command with `pnpm --dir apps/desktop exec node node_modules/electron/install.js`. The smoke owns its temporary home, user data and OS-allocated port. `BHARATCODE_COMPAT_RUNTIME` may select an already prepared Linux runtime for local checks; CI prepares its own pinned runtime. Preparation verifies Office/Python payloads before launching the application. Linux output is a development-runtime smoke, not a distributable installer.

The fresh-profile checks cover web, headless, SDK, SDK-minimal and ACP. The sanitized desktop overlay asserts BharatCode model/context/output limits, maximum reasoning selection, the Cordis preset and SearXNG routing without containing credentials or user sessions. A built Web process reports independently collected plugin states, reads actual model/preset services and invokes the accepted SearXNG adapter against an OS-allocated local stub. Disabled-plugin and wrong-provider controls must fail their behavioral assertions. The desktop plugin set remains an explicit fixture; third-party plugins must be added with individual activation and behavior checks before claiming compatibility.

The SearXNG adapter fixture is the accepted out-of-tree implementation, copied from the local bundle during initial setup. Changes to the local plugin require updating this fixture and its tests in a reviewed PR; CI cannot read a developer's external filesystem. The live SearXNG instance is verified separately by invoking search from the actual installed profile and checking service traffic. Replay does not prove live search-engine availability or live model inference.

## Customization and failure repair

Every customization has an entry in `behaviors.json` naming its purpose, dependent upstream paths and evidence owners. Add behavior tests before changing requirements. Package-interface changes can affect a behavior without touching the fork's edited files; overlap is only a risk signal. The rebranding phase must update the branding tests and identity assertions together; this branch preserves the existing committed identity instead of mixing uncommitted branding into compatibility infrastructure.

Repair briefs contain one behavior ID, relevant diff, exact failing command, expected outcome and an evidence report. Compare the previous fork, selected upstream and candidate under equivalent toolchains and environments, then classify the failure as upstream regression, fork regression, environment failure or flaky test. Do not refresh snapshots, delete tests, introduce broad exclusions or accept skipped platform checks to obtain green CI. Review all changed expected outputs explicitly. Session-format changes use the repository's persistence acknowledgements and committed historical generations.

## Internal candidates and rollback

After protected master passes all lanes, manually dispatch `Retain compatibility candidate` on master. Configure `BHARATCODE_API_KEY` in the `compatibility-release` environment; optional variables `BHARATCODE_BASE_URL` and `BHARATCODE_MODEL` select the HTTPS endpoint and model. The credentialed inference probe fails on absent credentials or an unexpected response. This direct inference probe supplements the harness's keyless end-to-end tests; it does not verify every live tool or reasoning tier.

The workflow requires a successful trunk CI run for the exact commit, the aggregate check, and non-expired unit/Linux/Windows artifacts. It tags an internal prerelease and retains the original artifact archives plus their IDs and SHA-256 values. Ordinary CI artifacts last 30 days; internal candidate attachments retain the selected known-good output. Repeating a candidate tag cannot overwrite existing release assets. The Windows payload is unsigned. The Linux archive contains the tested source, dependencies, Electron and pinned runtime; after extraction, launch it with `ELECTRON_RUN_AS_NODE=1 apps/desktop/node_modules/electron/dist/electron --import tsx/esm apps/desktop/scripts/start-linux-local.ts`, which regenerates development links for the new directory. It is not an installer. Public release requires signed packaging, installer verification and upgrade testing; a compatibility candidate is not a public release.

Test upgrades only with disposable copies of profile/session data. The replay suite reads committed historical sessions in private roots. Preserve the prior application and data backup until the upgrade passes. A forward data migration can make application-only rollback invalid; never point an older application at migrated live data without an explicit supported downgrade path.
