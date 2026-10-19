# DeepBlend 0.15.0 English edition for BharatCode

Upstream: [pearjelly/deep-blend v0.15.0](https://github.com/pearjelly/deep-blend/releases/tag/v0.15.0), source `467a83991d8353ffcc3db9446e3a9d22f65cb236`.

Original bundle SHA-256: `b67542e9cd6108a5c3a1182672e3cde05bd7e40b3b4e9316b24fd72515cff05a`.

`adapt.mjs` adds the exact BharatCode host version `0.2.0-rc.2` to the bundle engine range, preset app-boot peer, and tool dsh-tools peer. It validates every source manifest before changes, preserves other fields, and is idempotent. It does not broaden support to untested hosts or change Blender code. Apply `english.mjs` after this metadata adaptation to produce the BharatCode English edition. The adapted artifact must have its own hash and qualification evidence; upstream's original hash never describes the modified archive.

Blender 5.2.1 is required by this upstream release. Configure an explicit installed `blenderPath` in the provider row when it is outside the normal executable search path. Use the upstream workbench, recipes, project/revision tools, rendered previews, final renders and export operations. FFmpeg/ffprobe are needed for MP4 encoding. User content remains separate from installation files.

Run `node --test integrations/deepblend/test/adapter.test.mjs`. Release preparation, packed installation, lifecycle/workflow qualification, runtime installation and publication are delegated to the Luna Max release worker. Qualification evidence belongs alongside the pinned archive receipt; passing metadata tests alone does not qualify DeepBlend.

## English workflow and animation delivery

`english.mjs` translates the four bundled recipe descriptions, parameters, scene titles and goals; it rebinds each recipe input SHA-256 to its translated SceneSpec bytes. Geometry, materials, camera settings and timing remain unchanged. Recipe package digests consequently change; create projects using the freshly returned recipe digest. Existing revisions and locked recipes stay intact. Known upstream Chinese display text in those older records is translated for display without rewriting saved scene history.

The edition uses English workbench copy, accessible labels, host fallback messages, preset descriptions and model guidance. Delivery defaults to the final render profile and explains that empty range fields render the whole project timeline. Verified completed jobs expose playable MP4s and download links in Jobs and chat tool cards. These URLs address the immutable per-job encoded video, so a newer render cannot silently replace an older job's playback.

For a full animation, inspect the project's animation tracks and timing first. A frame range alone does not create motion. Add or preserve intended keyframes, inspect different frames, render the complete range, poll the job to completion and call `blender_export`. Verify the delivery manifest, decoded frame count, frame rate, duration and motion. The regular DeepBlend preset includes this guidance; it never asks the model to substitute a single-frame delivery for an animation.

Run the implementation checks with:

```sh
node --test integrations/deepblend/test/*.test.mjs
BC_DEEPBLEND_PACKAGE=/path/to/extracted/package node --test integrations/deepblend/test/*.test.mjs
```

The second command additionally exercises the real pinned compiled UI, including English rendering under a Chinese document locale, final profile defaults and the immutable video controls. Release preparation applies `node integrations/deepblend/adapt.mjs /path/to/verified/package`, then `node integrations/deepblend/english.mjs /path/to/verified/package`; it must produce a new archive hash and new installed-package qualification evidence.
