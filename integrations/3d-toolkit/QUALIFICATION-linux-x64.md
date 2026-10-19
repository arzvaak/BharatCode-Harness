# 3D Toolkit release qualification: Linux x64

The final `@bharatcode/3d-toolkit@0.1.0` artifact is qualified on Linux x64 for the tested Node 24.19 / BharatCode 0.2.0-rc.2 host. The package is optional and can run beside the existing profile bundles.

## Artifact and dependency closure

The reproducible packer is [`scripts/package-release.mjs`](./scripts/package-release.mjs). It builds from source commit `9f674221fb3f2b89d820006249a438d8462dd960` in an isolated tree, retains the exact dependency closure and all runtime licenses, excludes only vendored type/map sources and the host `@deepseek-ai/dsh-tools` peer, and fails if the expanded tar stream exceeds 256 MiB.

Artifact: `$DEEPBLEND_RUNTIME/bharatcode-3d-toolkit-0.1.0-linux-x64.tgz`

SHA-256: `4c2caf17e43d7664e7406e9fcb0a9c87cccd85f63ce2714141555a0f025f96a4`

Compressed size: 41,592,845 bytes; expanded tar stream: 171,980,800 bytes (limit 268,435,456).

The pack contains 87 bundled package manifests, 20 WASM files, and the Linux x64 esbuild executable. Node requirement is `>=24`; DSH range is `>=0.2.0-rc.2 <0.3.0`; peer `@deepseek-ai/dsh-tools` is exactly `0.2.0-rc.2`.

The exact direct runtime pins are Three 0.186.1, React Three Fiber 9.8.2, Drei 10.7.9, Rapier 2.2.0, React/React DOM 19.2.0, Babylon core/loaders/serializers 9.31.0, esbuild 0.28.2, Playwright Core 1.64.1, and fflate 0.8.2. The packer receipt records the direct pins and license checks, plus bundled package-manifest and WASM counts.

## Artifact-bound native smoke

The exact final archive was extracted into an isolated qualification directory and its `src/host.js` was mounted into the real Cordis `ToolRuntime`/`SystemPrompt` modules. The host received local qualification adapters for the application-owned profile/workspace, attachment, and preview-route services; rendering, export, tool-schema compilation, tool execution, Chromium, and lifecycle teardown all ran from the archived package closure. This verifies the archive's host integration and engines. It is not a fresh Electron profile load or a live-model completion.

All 14 tool schemas registered. The Three workflow created a project, edited it from revision 1 to 2, previewed it, rendered a 480×320 PNG attachment, and exported a 142,932-byte GLB, 314,320-byte offline-viewer ZIP, and 1,396-byte editable-source ZIP. The Babylon workflow rendered a 480×320 PNG and exported native scene JSON containing two meshes. Teardown removed the tool registrations and preview route. Sanitized result data is in [`qualification-receipt.json`](./qualification-receipt.json).

## Configured DeepSeek model dispatch

A bounded native host/model harness resolved the active desktop profile's `BHARATCODE_API_KEY` reference without recording its value, registered the configured `bharatcode/deepseek-v4.1-flash` route, offered all 14 final-archive schemas, and dispatched the model's returned calls through the real Cordis `ToolRuntime`. The model created and edited a custom blue sculpture project in both Three and Babylon, previewed both, and returned successful render calls. Both images are valid 480×320 PNGs; the retained Three render is a blue orbital sculpture and the Babylon render shows the matching scene. Tool-call names, result status, project IDs, hashes, and exact sanitized prompt are recorded in [`model-workflow-receipt.json`](./model-workflow-receipt.json).

The model-driven export step remains unverified. One continuation stopped at the local harness boundary because its scratch attachment adapter did not implement `readImageRequest`; a final bounded attempt produced both revision-2 PNGs but exceeded its intended 180-second request deadline and was terminated before any export result returned. This leaves the package's native archive export proof intact while clearly separating it from model-selected exports. A DeepBlend model-selected call was not attempted. The already-running Electron window was left open; profile reload and a visible in-app flow remain unverified.

The implementation/browser suite passed 13/13; the extension-store suite passed 70/70; the DeepBlend adapter and Blender version-probe suite passed 2/2. The tests exercised actual Chromium/SwiftShader rendering and click-driven UI downloads.

## Optional desktop profile installation

The final toolkit artifact and adapted DeepBlend 0.15.0 archive were installed with the shipped `dsh plugin --profile desktop add` flow. The profile manifest and lockfile list both packages and the bundle list includes both registrations. The profile patch pins Blender 5.2.1 and the qualified FFmpeg/ffprobe executables to user-owned paths under `$DEEPBLEND_RUNTIME`. The package manager accepted both artifacts; the package manifest, lockfile, and patch hashes are in the receipt. A profile backup was taken before modifying it.

The Electron app already had a running process and was left open to preserve active chats. The installed files and profile configuration are verified, but that window has not reloaded them. The configured model route was exercised through the native tool harness, not through the visible app window. Public catalog publication is also pending: the existing signed publisher requires a full app-release receipt and packed-core inventory, which this optional package install does not create.
