# dsh-lsp-actions

English | [中文](README.zh.md)

Use diagnostics, formatting, symbols, completion, signature help, inlay hints, and rename.

English local fork for BharatCode and DeepSeek Harness 0.2.0-rc.2. Install the generated tarball through the host plugin inventory; its bundle patch registers the plugin. The client packages use the existing host UI and ModuleLoader.

Configure language servers or the official LSP seam. The default empty server map reports LSP_ACTION_UNAVAILABLE; server installation is outside this package.

Upstream: https://github.com/PerryLink/dsh-lsp-actions

Pinned upstream revision: `50468c8e1f9996078298e246615516b6574fabe4`. Original license: Apache-2.0; see LICENSE and any included third-party notices. Canonical source is preserved in the integrations/workflows/upstream checkout.

Verification: 368 tests passed; 9 environment-dependent skipped.

Build with the scripts in package.json using the matching harness packages. No real project, GitHub, or Zotero data was used for verification.
