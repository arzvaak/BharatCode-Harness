# dsh-browser-playwright

English | [中文](README.zh.md)

Browse and extract research sources with scoped tabs, snapshots, screenshots and interactions.

English local fork for BharatCode and BharatCode Harness 0.2.0-rc.2. Install the generated tarball through the host plugin inventory; its bundle patch registers the plugin. The client packages use the existing host UI and ModuleLoader.

Configure channel chromium for the installed Playwright browser. Model extraction needs a configured model. No external site navigation was used in verification.

Upstream: https://github.com/ChenyuHeee/dsh-browser-playwright

Pinned upstream revision: `57ebe45fb906b6977312a0c7562d407faee4b449`. Original license: MIT; see LICENSE and any included third-party notices. Canonical source is preserved in the integrations/workflows/upstream checkout.

Verification: 47 local browser fixture tests passed using cached Chromium; live website tests omitted.

Build with the scripts in package.json using the matching harness packages. No real project, GitHub, or Zotero data was used for verification.
