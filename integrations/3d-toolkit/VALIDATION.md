# Implementation verification

Source implementation: `35089609afdc367699f24faf97e31490d6d0098f` (2026-10-19).

Environment: Linux x64, Node 24.19.0, existing Playwright Chromium 1243. Headless rendering uses SwiftShader; it is not a hardware performance benchmark or native Windows qualification.

`npm test` passed **12/12** tests:

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

`npm run build` passed. Twelve dependency licence texts are retained, including exact-upstream fallback files for the two React Three packages whose npm distributions omit them. Runtime dependencies and transitive closure are recorded by `package-lock.json`; the release package bundles its dependency closure while consuming the existing host `dsh-tools` peer.

The extension-store suite passed **70/70** tests with the new catalog/probe records. The DeepBlend metadata adapter and Blender version-probe regression passed **2/2** tests. Normal commit hooks passed lint, notice generation, whitespace and vendor manifest checks.

An independent source review identified the malformed-URL crash and unfinished-source export failure; both were fixed and verified. Interactive browser previews provide origin separation, opaque iframe sandboxing and CSP subresource restrictions. They are not a complete network sandbox: self-navigation remains possible. Automated render/model export adds independent request interception.

Packed-install, native host lifecycle, live configured DeepSeek calls, profile installation, and signed public-catalog publication are separate release-worker checks. Their artifact-bound receipts must identify the exact archive hashes; this implementation report does not substitute for those receipts.
