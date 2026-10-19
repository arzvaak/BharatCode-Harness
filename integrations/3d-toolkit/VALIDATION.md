# Implementation verification

Source implementation: `9f674221fb3f2b89d820006249a438d8462dd960` (2026-10-19).

Environment: Linux x64, Node 24.19.0, existing Playwright Chromium 1243. Headless rendering uses SwiftShader; it is not a hardware performance benchmark or native Windows qualification.

The combined implementation and real-browser gameplay suite passed **13/13** tests:

- Workspace-owned persistent editable projects, immutable revisions, stale-edit rejection and engine identity.
- Traversal, symlink and source-size rejection; compiled import boundaries and token-protected preview paths.
- Actual Three.js and Babylon.js PNG rendering, visible mesh metrics, GLB header/JSON mesh parsing, editable-source ZIP and offline-viewer ZIP export.
- Offline viewer opened directly from disk in Chromium and initialized successfully for both engines.
- Babylon native scene JSON export with mesh data.
- Deliberate scene initialization errors fail rendering.
- Module-scope exceptions report their actual browser error before waiting for readiness (regression initially failed).
- Invalid dimensions and pre-cancelled render cleanup.
- Unloading during compilation aborts work without leaving a preview server (regression initially failed).
- Unfinished source remains exportable without compilation (review regression initially failed).
- Malformed raw HTTP requests return a client error without crashing the host (review regression initially failed).
- Both model tool families execute with compiled JSON Schema and return PNG image attachments.
- Real UI clicks create/edit/preview/render/export and download GLB, source ZIP, offline viewer ZIP and Babylon JSON.
- A custom Babylon game responds to keyboard input, moves its player and collects an orb in both the live preview and exported offline viewer.

`npm run build` passed. Twelve dependency licence texts are retained, including exact-upstream fallback files for the two React Three packages whose npm distributions omit them. Runtime dependencies and transitive closure are recorded by `package-lock.json`; the release package bundles its dependency closure while consuming the existing host `dsh-tools` peer.

The extension-store suite passed **70/70** tests with the new catalog/probe records. The DeepBlend metadata adapter and Blender version-probe regression passed **2/2** tests. Normal commit hooks passed lint, notice generation, whitespace and vendor manifest checks.

An independent source review identified the malformed-URL crash and unfinished-source export failure; both were fixed and verified. Interactive browser previews provide origin separation, opaque iframe sandboxing and CSP subresource restrictions. They are not a complete network sandbox: self-navigation remains possible. Automated render/model export adds independent request interception.

The reproducible Linux x64 release packer is [`scripts/package-release.mjs`](./scripts/package-release.mjs). It builds the isolated package from the tested source revision, verifies the pinned runtime closure and licenses, excludes the host `@deepseek-ai/dsh-tools` peer, and enforces the extension-store 256 MiB expanded-archive ceiling. The final artifact is `bharatcode-3d-toolkit-0.1.0-linux-x64.tgz`, SHA-256 `4c2caf17e43d7664e7406e9fcb0a9c87cccd85f63ce2714141555a0f025f96a4`.

The final archive was installed through the shipped `dsh plugin --profile desktop add` command into the current user-owned desktop profile. Its manifest now includes `@bharatcode/3d-toolkit` and `@deepblend/dsh-blender-bundle`; DeepBlend's profile override pins Blender 5.2.1, FFmpeg, and ffprobe to the qualified user-owned runtimes. The package manager accepted both archives and retained their package closures. The live Electron process was already running before these profile changes, so this confirms the installed profile state, not that the existing window has reloaded the new bundles.

Artifact-bound native workflow evidence is recorded separately for DeepBlend in [`../deepblend/QUALIFICATION-linux-x64.md`](../deepblend/QUALIFICATION-linux-x64.md). A fresh live-model call through the configured DeepSeek route, visible in-app verification, and signed public-catalog publication remain unverified; publication is gated on the full app-release receipt and packed-core inventory, which this optional extension install does not produce.
