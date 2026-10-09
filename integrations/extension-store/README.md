# BC Extension Store

Private-preview catalog and verified package installation through BC's native plugin manager. Graphics and standard workflows ship in the core; this catalog adds optional capabilities.

The store uses the user's `BC_EXTENSION_GITHUB_TOKEN` credential reference and private repository collaborator access. Secrets stay in native credentials. Catalogs require an Ed25519 signature and monotonically increasing revisions. Packages require exact size/hash and per-platform evidence before installation; they install disabled.

Native bundles activate profile-wide with host privileges. Qualified MCP runtimes attach to the calling agent and workspace only after explicit workspace enablement and `extension_load`. Unused runtimes close after five idle minutes, except persistent kernels and leased/active work. Do not claim that process separation provides sandboxing.

Seed entries are discovery metadata, not qualification. Hosted-account and application-dependent routes stay unavailable until their concrete checks pass. The preview does not advertise macOS support.

Run `npm test` and `npm run build` in this package. Release workflows sign immutable catalogs and publish private assets. No end-user build scripts are approved implicitly.


## Private preview installation

A user-facing installer has not been published yet. The current engineering branch can be built with Node 24 and the pinned pnpm version: run `pnpm install --frozen-lockfile`, `pnpm run build`, and `node scripts/extensions/core.mjs build` at the repository root. Run `node scripts/extensions/verify-core.mjs` for an owned temporary profile. This smoke removes its fixture home afterward and does not configure the user's live profile.

When a preview is qualified and published, testers use their own GitHub account with collaborator access to `arzvaak/Bharatcode-Harness`. In Extensions, expand Private preview access, enter a repository-restricted credential with Contents read permission, and refresh the signed catalog. GitHub authentication does not qualify an optional extension: unavailable entries explain their remaining requirements. Only releases with exact package hashes and evidence for the current platform offer Install. Optional packages install disabled; workspace capabilities require explicit enablement in each workspace. Native host packages are profile-wide and run with host privileges.

An uninstall removes manager-owned package activation and installation records; it does not silently delete connection credentials or user data. Disconnect is explicit. Clearing downloaded archives removes recovery cache. Updates require a declared supported migration from the installed version and no active extension work. Rollback is currently unavailable because no reversible release migration has been qualified.

## Version and release contract

Application version, package semver and catalog revision are independent. Qualified descriptors require exact source commit, licence, artifact identity/size/SHA-256, BC version range and platform evidence. An incompatible, restricted or unqualified candidate remains visible but cannot install. Catalog revision is an increasing positive integer; previously verified catalogs are reverified when loaded offline. Same-version different-byte packages and catalog revision replacement are refused.

CI runs Linux and native Windows qualification before the private preview publication job. That job receives repository-scoped GitHub permissions and `BC_EXTENSION_CATALOG_KEY` through the supported repository-secret mechanism. Its public key is bundled here; key rotation requires a BC update. OS application signing uses separate supported secrets and is not replaced by catalog signing. Preview publication refuses an existing release tag. Stable promotion and published-artifact recovery remain pending; inventory promotion fixtures are not a completed distribution workflow.

See the [acceptance ledger](../../.workspace/core-extension-store/ledger.md) for every A1–E9 task, evidence and remaining work.
