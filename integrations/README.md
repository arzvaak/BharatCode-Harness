# BharatCode English integrations

This directory owns reviewed local forks and original plugins for the BharatCode workflow UI. SearXNG is deferred. The project editors, reader, context handoffs, and shell remain owned by the Harness; workflow plugins add capabilities through its native services.

`registry.json` records enabled packages and qualified archives. Every shipped UI, setting, help/error message, tool description, and instruction is English. Locale identifiers, protocol keys, user documents, and licensed third-party content retain their identity. Vendor libraries can contain other language data without exposing it as the product's UI.

Prepare the isolated linked preview with `node integrations/scripts/prepare-preview.mjs`. Its home is on the host's native filesystem so owner-only credential permissions work. The preview uses a separate Engram database and no copied accounts or session history. Launch it through `dsh --profile integrations` with that DSH_HOME. See `artifacts/preview-profile.json` for this run's exact location.

Install the small helper dependency with `npm ci --ignore-scripts --prefix integrations`, then install the archived packages through the native profile manager:

```sh
node integrations/scripts/install.mjs --home /path/to/DSH_HOME --profile web --cli /path/to/dsh --dry-run
node integrations/scripts/install.mjs --home /path/to/DSH_HOME --profile web --cli /path/to/dsh
```

Close the intended host or wait for its running sessions to finish before changing a profile. The installer preserves profile metadata in integration-backups and delegates dependency resolution, locking, and compatibility validation to the Harness, then activates the enabled declared bundles and the native Plugins management UI. Restart the app afterward. Qualified archives are copied to checksum-based paths so pnpm cannot reuse a stale archive after a rebuild. If pnpm requests approval for native dependency build scripts, review the exact packages in the profile workspace file; this run approved onnxruntime-node and protobufjs in the isolated qualification profile. Desktop uses its already initialized desktop profile; a compiled CLI bin.js can be passed for development.

Provider Hub uses native credentials and subscription adapters. Simulated authentication, quota, refresh, and inference tests are separate from signing in with a real user's subscription. API billing uses verified provider-specific rates; custom gateways and subscription routes remain unpriced unless their own rate is supplied. A quota indicator is not a cash balance.

Zero's initial Safe mode keeps recoverable originals and compresses repeated text. Its counters describe projections, not proven billing savings. Visuals lives in shared Settings and preserves native answer rendering on unload. Tool Call Guard repairs malformed outbound historical tool calls while retaining the canonical transcript and valid blocks.

See PLAN.md and VERIFICATION.md for the scope, commands, native-profile results, and remaining account/platform qualification.

The final set contains 17 packages. Coding adds GitHub review and LSP Actions; research adds Zotero, Library, Browser Playwright and DeepRead; writing adds Novel Continuity; Task Board supplies task tracking. [LSP setup](workflows/LSP-SETUP.md) pins and configures the local TypeScript/JavaScript server. Zotero, authenticated GitHub, and model-backed research still require the user's own configuration.
