# BharatCode 3D Studio

Version 0.1.1 local Linux artifact and actual in-app qualification are recorded in [`QUALIFICATION-0.1.1-linux-x64.md`](./QUALIFICATION-0.1.1-linux-x64.md). The earlier [`QUALIFICATION-linux-x64.md`](./QUALIFICATION-linux-x64.md) is the preserved 0.1.0 record.

Optional native Three.js and Babylon.js toolkit. Open **3D Studio** in the sidebar or use the `three_*` and `babylon_*` tools from a workspace chat.

## Create, inspect, render, export

1. Call `three_project_create` or `babylon_project_create` with a title. The default is a lit, animated sculpture with an orbit camera.
2. Read `*_project_get`. Edit the full JS/TS/TSX module through `*_project_update`, supplying its exact `expectedRevision`.
3. Call `*_preview` for an interactive local URL. In the app, select the saved scene in 3D Studio. The initial workspace follows the active chat; saved scenes are filtered to the selected workspace. Drag to orbit and scroll to zoom. Play, pause or seek to a precise animation time. Use the source editor for manual changes; save or discard a draft before switching scenes or exporting.
4. Call `*_render` for an actual PNG, image attachment and mesh metrics. The UI exposes width, height and animation time for frame renders and model exports. Rendering reports initialization errors; a successful compile alone does not prove a visible scene.
5. Call `*_export`: `glb` for a 3D model, `source` for an editable project ZIP, `viewer` for a bundled offline HTML ZIP. Babylon supports `babylon` native JSON. Outputs include absolute paths and source revision. The page also provides download buttons.

The scene module exports `async createScene({canvas,width,height})`. Three returns `{scene,camera,renderer,update(timeSeconds),dispose()}`; Babylon returns `{scene,engine,update(timeSeconds),dispose()}`. `update` and `dispose` are optional. Keep animation deterministic relative to its supplied time. The preview starts animation automatically. Render/export freeze at the requested `time` (default zero).

Available imports: `three` and addons, `react`, `react-dom`, `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier`, `@babylonjs/core`, `@babylonjs/loaders`, `@babylonjs/serializers`. All are exact-pinned. GPU backend is WebGL for these starter scenes. No path tracing is claimed. A source ZIP preserves the editable module and manifest; a viewer ZIP additionally contains a self-contained `index.html` and bundled `app.js` and can open without a development server.

## Runtime and boundaries

Node 24+ and an installed Chromium are required. The plugin discovers existing Playwright Chromium or common Linux Chrome executables, or accepts an explicit `browserPath` in plugin configuration. It never downloads a browser at startup. Rendering uses headless Chromium with SwiftShader for portable qualification; interactive previews use the user's browser GPU. Render size is 64–4096 pixels per side, time 0–86400 seconds, deadline 45 seconds. Source limit is 1 MiB. Compiled preview limit is 32 MiB and model export limit 64 MiB.

Projects live beneath the profile's `bc-3d-toolkit/projects`, segregated by registered workspace. Each edit creates an immutable revision. Stale edits, traversal and symlink directories are rejected. Source runs on a separate token-protected loopback origin, never in Node. Only the bundled library imports are accepted. Preview CSP restricts fetches and subresources; headless rendering independently intercepts all non-preview traffic. Remote assets, arbitrary local files and project-selected dependency installs are not supported; embed small assets as data URLs or generate geometry in code. Extend asset ingestion separately rather than bypassing these boundaries.

Interactive previews execute generated browser JavaScript on a separate origin. CSP restricts fetches and subresources, while the app iframe also uses an opaque sandbox. Browser self-navigation is not blocked by CSP: this is not a complete network sandbox for hostile code. Automated renders and model exports additionally intercept browser requests and allow only the exact snapshot files.

`npm ci --ignore-scripts --legacy-peer-deps`, `npm test`, and `npm run build` verify the package. Link the host-provided `@deepseek-ai/dsh-tools` peer for development; the optional extension uses BharatCode's existing tool runtime. Tests use real Chromium for both engines. Native packed-install, lifecycle and live model qualification are recorded separately by release qualification.

An offline viewer preserves procedural animation. PNG and model exports capture a chosen time; they do not bake procedural animation tracks into GLB. Use DeepBlend Studio for complete rendered MP4 delivery.
