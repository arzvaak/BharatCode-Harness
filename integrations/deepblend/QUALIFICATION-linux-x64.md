# DeepBlend qualification: Linux x86-64

Status: **passed for the exercised native workflow**, with the scope limits below. The native workflow qualification used DeepBlend 0.15.0 against the Cordis host and DeepSeek toolkit 0.2.0-rc.2. A separate release step later installed the exact adapted artifact into the current user's desktop profile; the already-running Electron window was not restarted, so its live bundle reload remains unverified.

## Source and adapted bundle

The qualified repository source is revision `d6e3e05bc80301e792804eb4db6126d9d81618f5`. It includes `9f674221fb` (`Report module-scope scene failures before render readiness`). The DeepBlend metadata adapter was introduced separately in `35089609afdc367699f24faf97e31490d6d0098f`; [`adapt.mjs`](./adapt.mjs) has SHA-256 `8cba93307417a9b83420c9e8004388085c26f9b85bd0c191007bb78e70574291`.

The original upstream bundle is DeepBlend 0.15.0 from source commit `467a83991d8353ffcc3db9446e3a9d22f65cb236`. Its archive SHA-256 is `b67542e9cd6108a5c3a1182672e3cde05bd7e40b3b4e9316b24fd72515cff05a` (72,526,439 bytes); the packaged source-tree hash recorded in its manifest is `61a0c9698d600698c7b3f4a05cf997094ff011eb`.

The release-prepared archive is at `$DEEPBLEND_RUNTIME/deepblend-flow/deepblend-v0.15.0-bc-0.2.0-rc.2-adapted.tgz`. Its SHA-256 is `cf0d50e66dd4a77e5ee8ed18eb5edfcd910ea94a30781b9485b5dc738a76d839` (70,876,979 bytes). The adapter adds the exact host version `0.2.0-rc.2` to three existing metadata ranges: the bundle's `engines.dsh`, the preset's `@deepseek-ai/dsh-app-boot` peer, and the tool's `@deepseek-ai/dsh-tools` peer. No implementation files are changed by this adaptation. The adapter regression test passed (1 test, 0 failures).

## Native workflow evidence

The run mounted the real Cordis runtime, DeepBlend provider and host, native `@deepseek-ai/dsh-tools`, subprocess and job services, and the real preset under an agent-scoped registry. It discovered the exact 18-tool catalog and confirmed the tools were registered for the scoped agent and hidden from the global registry. An outsider's attempt to invoke a scoped Blender tool was denied as an unknown tool.

All 18 discovered tools:

`blender_asset_ingest`, `blender_capabilities`, `blender_export`, `blender_final_render`, `blender_job_cancel`, `blender_job_status`, `blender_preview_render`, `blender_preview_views`, `blender_project_create`, `blender_project_get`, `blender_recipe_list`, `blender_recipe_parameters`, `blender_revision_restore`, `blender_scene_get`, `blender_scene_patch`, `blender_scene_validate`, `blender_visual_autofix`, `blender_visual_review`.

The 11 DeepBlend tools actually invoked were `blender_capabilities`, `blender_recipe_list`, `blender_project_create`, `blender_recipe_parameters`, `blender_scene_get`, `blender_preview_render`, `blender_scene_validate`, `blender_final_render`, `blender_job_status`, `blender_export`, and `blender_job_cancel`. The uninvoked seven were `blender_asset_ingest`, `blender_preview_views`, `blender_project_get`, `blender_revision_restore`, `blender_scene_patch`, `blender_visual_autofix`, and `blender_visual_review`. The generic DSH `job_list` tool was also exercised. This is a real workflow qualification, not a claim that every catalog tool was called.

The workflow created recipe `deepblend.glazed-cup` version 3.1.0, changed `cup-height-mm` from 105 to 110, and committed revision `r0002`. Scene validation returned zero errors. A 512×512 preview PNG and a 960×720 final-render PNG were produced and checked for PNG signatures, dimensions, and artifact hashes. The preview bytes also passed through the run's attachment service.

The Blender runtime was 5.2.1 LTS (executable SHA-256 `c2fd82553c979a7f6ba85202c487aa1173c90db588a67d74d70cc7b0c2bea01c`); the Cycles smoke render passed. The runtime's capability response listed FBX and glTF import/export support, and reported ABC, DAE, OBJ, PLY, STL, USD, and X3D unavailable.

## Export and animation limits

`blender_export` produced a verified H.264 MP4 delivery package. The qualification encoded **one frame only**: 960×720 at 24 fps, 0.041667 seconds, with one frame confirmed by `ffprobe`. Its MP4 signature, H.264 stream, and delivery manifest were verified. This is a static one-frame encoding proof; it does not qualify multi-frame animation, animation continuity, or a longer video export.

The editable scene checkpoint is a `.blend` file saved with project creation (`saveCheckpoint:true`) and retained at scene revision `r0002`; it was checked for the Blender file signature and SHA-256. This checkpoint is the editable scene deliverable. Although Blender reports glTF/FBX capabilities, the exercised DeepBlend `blender_export` interface does not expose a GLB/FBX scene-export format selector: its delivery path encodes the render frames to MP4. Therefore this qualification does not claim that DeepBlend exported GLB, glTF, or FBX.

The delivery used a pinned user-owned FFmpeg runtime under `$DEEPBLEND_RUNTIME/ffmpeg-qualification/`. It came from BtbN FFmpeg Builds tag `autobuild-2026-10-18-13-01`, asset `ffmpeg-n9.0.2-28-g669f5ab083-linux64-gpl-9.0.tar.xz`, SHA-256 `d2cc2d5446f14ff32b411e4fee488005b472023fb6554bed0ea80b7110f0b3a6`. The binaries are at `ffmpeg-n9.0.2-28-g669f5ab083-linux64-gpl-9.0/bin/ffmpeg` and `.../bin/ffprobe`; their SHA-256 values are `03e218b978410716319c1b712c7973384de6be63b80f5ad4a8a60c9e8d95f4a0` and `c2357e52b4d68261674078e1f7fbeef63c03cc2cd5ac085061c030ba74c9e4e4`, respectively. The build reports `n9.0.2-28-g669f5ab083-20261018`, includes libx264, and is GPLv3 (GPL version 3 enabled). The provenance and license record is kept beside the runtime; the FFmpeg runtime is separate from the adapted DeepBlend archive.

A bounded 48-frame render was then canceled. The managed Blender process was gone, the corresponding DSH job was killed, and the scoped registry, agent lifecycle, and Cordis root were disposed. No multi-frame render was left running.

## Desktop profile installation

The exact adapted artifact above (SHA-256 `cf0d50e66dd4a77e5ee8ed18eb5edfcd910ea94a30781b9485b5dc738a76d839`) was installed with the shipped `dsh plugin --profile desktop add` flow. The profile now has both `@deepblend/dsh-blender-bundle` 0.15.0 and `@bharatcode/3d-toolkit` 0.1.0 in its direct dependencies and bundle list. The final toolkit archive SHA-256 is `4c2caf17e43d7664e7406e9fcb0a9c87cccd85f63ce2714141555a0f025f96a4`.

The desktop profile patch explicitly selects Blender 5.2.1 at `$DEEPBLEND_RUNTIME/blender-5.2.1-linux-x64/blender` and FFmpeg/ffprobe at `$DEEPBLEND_RUNTIME/ffmpeg-qualification/ffmpeg-n9.0.2-28-g669f5ab083-linux64-gpl-9.0/bin/{ffmpeg,ffprobe}`. The runtime files and profile configuration are user-owned; existing conversations and project data were not changed. The profile package and lock files were backed up before the DeepBlend installation. The user interface process was already running and was left untouched; therefore package installation and profile configuration are verified, while a fresh app load is not. No model-selected DeepBlend call was attempted; the separate Three/Babylon model dispatch is recorded in the toolkit qualification report.

The installation evidence uses the app's `desktop` profile. Its final package manifest, lockfile, and patch hashes are retained in the local release evidence directory; no provider secrets or credentials are included in the report.

## Passed checks

The fresh release verifier passed all 17 checks: source archive hash; exact tool catalog; Blender Cycles smoke render; recipe edit committed as a revision; scene validation; preview PNG signature and dimensions; final PNG signature and dimensions; MP4 signature and `ffprobe` result; delivery manifest; editable checkpoint; pinned FFmpeg runtime; canceled subprocess gone; generic DSH job killed; resource cleanup; and SHA-256 checks for the three delivered image/video artifacts (`preview.png`, `final.png`, and `final.mp4`). The machine-readable result is in [`qualification-receipt.json`](./qualification-receipt.json).
