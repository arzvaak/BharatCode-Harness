# 3D creation extensions

The user approved three workflows: updated DeepBlend for Blender modelling and renders, a Three.js toolkit, and Babylon.js game creation. Success requires model-visible tools that create editable projects, run previews, render actual pixels, and export usable files. Catalog listings alone are insufficient.

## Integration

Use the current release checkout as the base, in an isolated worktree. Preserve existing profile data and unrelated work. Keep the new browser engines together in one optional native package, `@bharatcode/3d-toolkit`, with distinct `three_*` and `babylon_*` tools. This shares project persistence, compilation, preview transport, image attachments, and export handling without duplicating services. Add one native catalog entry plus discoverable engine packs. Do not enable heavy engines at startup in the base application.

Each project owns editable JS/TS/TSX source and a JSON manifest. Engine starters expose `createScene({canvas, width, height})`, returning scene, camera/renderer or Babylon engine, plus an optional update(timeSeconds) callback. Generated code may import bundled Three.js, React Three Fiber, Drei, Rapier and Babylon packages. Compile in-process with esbuild; never execute project source in Node or install project-selected dependencies. Build revisions are immutable and served on a token-protected loopback origin separate from the host. CSP restricts fetches and subresources; it is not a complete network sandbox because browser self-navigation remains possible. Automated render/export independently intercept all browser requests and allow only snapshot files. Scope model tool access to the registered workspace of the calling session.

The browser bootstrap provides readiness/error reporting, deterministic frame stepping, scene metrics, PNG capture support, and GLB export through the actual engine exporter. A native 3D Studio page lists saved projects, embeds their isolated previews, and exposes render/export controls. Tools return durable image attachments and absolute exported file paths. Export supports GLB, editable source ZIP, and a bundled offline viewer ZIP. Babylon also supports its native scene JSON. No claim of path tracing or a guaranteed frame rate is made.

## DeepBlend

Pin the current upstream release and adapt only demonstrated host incompatibilities. Retain upstream recipes, source scenes, tools, visual feedback, render/export and cancellation. Verify an actual Blender render and export, not just package import. Qualification evidence must distinguish source tests, packed install, live host tool discovery, live model calls, and native OS support. Publish qualified status only for measured platforms with artifact-bound evidence.

## Failure handling and limits

Validate project IDs, file names, engine identity, workspace ownership, byte limits, render dimensions and time. Reject traversal, symlinks and writes outside owned project directories. Serialize project mutations; abort compilation and browser work on cancellation. Render deadlines must close browsers; extension disposal must close the preview server and active work. Report compiler/runtime/renderer errors instead of accepting a blank screenshot. Bound preview request paths and exclude source/private data from the preview origin.

## Verification

Test persistence, workspace separation, invalid paths and symlinks, failed builds, both engine renders, GLB parsing, offline export contents, cancellation, tool registration and image output. Exercise UI controls in a real browser. Use a real configured DeepSeek turn when available, and clearly record upstream/provider failure if it cannot be completed. Release preparation, packaging, qualification, installation and publishing belong to the mandated gpt-6-luna/max subagent.
