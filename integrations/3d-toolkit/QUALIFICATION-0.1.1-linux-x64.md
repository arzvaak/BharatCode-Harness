# 3D Toolkit 0.1.1 qualification: Linux x64

The exact `@bharatcode/3d-toolkit@0.1.1` archive was installed in the BharatCode `0.2.0-rc.2` desktop profile and exercised through the actual desktop renderer and configured DeepSeek model route `bharatcode/deepseek-v4.1-flash`.

- Source commit: `aea4dfe0a988652c75a8c73f5fc58fee5ae79699`
- Archive: `bharatcode-3d-toolkit-0.1.1-linux-x64.tgz`
- Archive SHA-256: `37e4f3f93b38e0df5d33e8693eb8d3dec85da3e872c16e71bd57af019d19a06d`
- Package build and all 15 tests passed, including the visible-size initialization and resize regression tests.
- Both app Studio panes initialized visible canvases at 723×426 with matching CSS and drawing-buffer dimensions; expected scene geometry was visible.

The 0.1.1 DeepSeek recheck reused saved projects from the earlier workflow and passed project read, render, and export calls. Three.js ran at Max effort; Babylon.js ran at Low effort. Three.js produced a 480×320 PNG, valid glTF 2.0 GLB, editable-source ZIP and offline-viewer ZIP. Babylon.js produced a 480×320 PNG, valid glTF 2.0 GLB, Babylon JSON with two meshes and two materials, editable-source ZIP and offline-viewer ZIP. Exact output hashes and tool statuses are in [`qualification-0.1.1-receipt.json`](./qualification-0.1.1-receipt.json).

The report qualifies this local Linux artifact; it does not claim a signed public catalog or public download. The prior 0.1.0 test record remains unchanged at [`QUALIFICATION-linux-x64.md`](./QUALIFICATION-linux-x64.md).
