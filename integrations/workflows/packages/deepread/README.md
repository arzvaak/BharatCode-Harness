# dsh-deepread

English | [中文](README.zh.md)

Extract local or pasted sources and generate English evidence reports, book synthesis, and model-free budget estimates.

English local fork for BharatCode and DeepSeek Harness 0.2.0-rc.2. Install the generated tarball through the host plugin inventory; its bundle patch registers the plugin. The client packages use the existing host UI and ModuleLoader.

Scoped fork of the original source/PDF extraction, model JSON retry, chunk synthesis, budget, calibration and URL cache engine. Modes quick/deep/book and English only. The duplicate shell, batch, maps, Feynman, background jobs, packaged skill and automatic disk exports are omitted. Reports require a configured model; estimate does not call a model.

Upstream: git+https://github.com/xiehuan123/dsh-deepread.git

Pinned upstream revision: `9462f1e546b94a7f27e77abaf3d9ee3fedf7f746`. Original license: MIT; see LICENSE and any included third-party notices. Canonical source is preserved in the integrations/workflows/upstream checkout.

Verification: Real ToolRuntime estimate, local file reading, quick and book reporting, English prompts/output, schema rejection and disposal passed.

Build with the scripts in package.json using the matching harness packages. No real project, GitHub, or Zotero data was used for verification.
