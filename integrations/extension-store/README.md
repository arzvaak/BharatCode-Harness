# BC Extension Store

English | [中文](README.zh.md)

Public signed catalog and verified package installation through BC's native plugin manager. Graphics and standard workflows ship in the core; this catalog adds optional capabilities.

Public catalog downloads use `arzvaak/BharatCode-Extensions` without GitHub sign-in. The optional `BC_EXTENSION_GITHUB_TOKEN` credential reference increases API limits and stays in native credentials. Catalogs require an Ed25519 signature and monotonically increasing revisions. Packages require exact size/hash and per-platform evidence before installation; they install disabled.

Native bundles activate profile-wide with host privileges. Qualified MCP runtimes attach to the calling agent and workspace only after explicit workspace enablement and `extension_load`. Unused runtimes close after five idle minutes, except persistent kernels and leased/active work. Do not claim that process separation provides sandboxing.

Seed entries are discovery metadata, not qualification. Hosted-account and application-dependent routes stay unavailable until their concrete checks pass. The preview does not advertise macOS support.

Run `npm test` and `npm run build` in this package. Publication signs immutable catalogs and publishes public assets. No end-user build scripts are approved implicitly.


## Preview build and public downloads

A user-facing installer has not been published yet. The current engineering branch can be built with Node 24 and the pinned pnpm version: run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm run build`, and `node scripts/extensions/core.mjs build` at the repository root. Run `node scripts/extensions/verify-core.mjs` for an owned temporary profile. This smoke removes its fixture home afterward and does not configure the user's live profile.

Public distribution uses `arzvaak/BharatCode-Extensions` and does not require GitHub sign-in. Optional GitHub credentials can increase API limits. Catalog signatures, exact archive hashes, platform checks and qualification still determine installability. Core bundles are included in BC; optional candidates remain unavailable until their workflow evidence passes. Catalog cards explain when release availability, version, platform, download metadata or validation blocks installation. Installed inactive native extensions show activation guidance; workspace extensions prompt workspace selection.

An uninstall removes manager-owned package activation and installation records; it does not silently delete connection credentials or user data. Disconnect is explicit. Package and managed runtime archives are rechecked against their signed sizes and SHA-256 before reuse, so interrupted setup can be retried after restart without a download when the verified cache remains available. Tampered cache files are refused. Clearing downloaded archives removes that offline recovery path. Updates require a declared supported migration from the installed version and no active extension work. Rollback is currently unavailable because no reversible release migration has been qualified.

## Version and release contract

Application version, package semver and catalog revision are independent. Qualified descriptors require exact source commit, licence, artifact identity/size/SHA-256, BC version range and platform evidence. Each qualificationEvidence record names a platform, packed-install/lifecycle/workflow check, source commit, archive SHA-256, result and HTTPS evidence link. Every advertised platform must have all three passed checks for the exact descriptor source and artifact; duplicate, stale or incomplete records cannot authorize installation. An incompatible, restricted or unqualified candidate remains visible but cannot install. Catalog revision is an increasing positive integer; previously verified catalogs are reverified when loaded offline. Same-version different-byte packages and catalog revision replacement are refused.

The public preview channel uses `scripts/extensions/publish-public.mjs` with an external Ed25519 private key and a reviewed public source commit. It verifies the native Linux packed-install inventory and exact archive hashes before uploading thirteen core extension packages, the signed catalog, and checksums. An optional hosted Linux runtime report adds its verified archive; the requested catalog revision must increase for each publication. The subscription adapter remains bundled with the application and is excluded from the public snapshot pending review of its native OAuth client configuration. Six starter skills are available in the public repository. Optional entries retain their qualification status; public availability does not qualify an unavailable workflow.

The previous private publication and promotion workflows describe a separate legacy channel and do not publish this public channel. Their original signing secret is not the public channel key. OS application signing uses separate secrets and is not replaced by catalog signing. Published-artifact upgrade and recovery acceptance remains pending.

See the [acceptance ledger](../../.workspace/core-extension-store/ledger.md) for every A1–E9 task, evidence and remaining work.

## Local requirement inspection

Selected candidate cards offer **Inspect local requirements**. This explicitly runs fixed version probes through BC's native subprocess service, reusing the BC Node runtime or existing local Python/Jupyter/DuckDB/Typst/Tinymist/FFmpeg installations and LaTeX engines/build runners. The Technical Publishing pack includes the BC LaTeX starter workflow, which is inspected and installed through Skills Manager. It preserves LaTeX templates and uses an existing TeX Live or MiKTeX installation; managed TeX distribution setup remains unavailable. Probes have a five-second deadline, bounded output, scrubbed credentials, and awaited process-range cleanup. They do not run at boot, install packages, download models, activate tools, or return raw process output. A found version is an inspection result; package, account and workflow qualification still apply. The existing bundled workspace-dependency service remains available separately.

## Managed runtime setup

An extension card offers **Set up managed requirements** only when the signed catalog contains a compatible, platform-qualified runtime for the current CPU architecture for its missing dependencies. Setup verifies the signed release inventory and exact artifact size and SHA-256, bounds archive extraction, checks the provided versions, and activates the runtime atomically. The source catalog records the x64 Typst runtime as unavailable until publication. Native qualification repackages hash-pinned upstream Linux and Windows executables with their Apache licence and third-party notices; each lane verifies signed installation, reload, PDF/SVG output, cancellation and removal. Publication requires native reports for every advertised platform and includes the exact archives in the signed release inventory. The public preview supports an explicit Linux-only descriptor: revision 3 publishes Typst 0.15.1 for Linux x64 after hosted native qualification; Windows and ARM64 are unavailable. The assembler still requires both Linux and Windows reports when no platform subset is specified. Other managed runtimes remain unavailable. **Managed runtimes** lists installed versions for individual removal; removal is refused while agent work is running or a dependent extension runtime remains active.
