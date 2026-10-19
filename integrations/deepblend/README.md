# DeepBlend 0.15.0 host adaptation

Upstream: [pearjelly/deep-blend v0.15.0](https://github.com/pearjelly/deep-blend/releases/tag/v0.15.0), source `467a83991d8353ffcc3db9446e3a9d22f65cb236`.

Original bundle SHA-256: `b67542e9cd6108a5c3a1182672e3cde05bd7e40b3b4e9316b24fd72515cff05a`.

`adapt.mjs` adds the exact BharatCode host version `0.2.0-rc.2` to the bundle engine range, preset app-boot peer, and tool dsh-tools peer. It validates every source manifest before changes, preserves other fields, and is idempotent. It does not broaden support to untested hosts or change Blender code. The adapted artifact must have its own hash and qualification evidence; upstream's original hash never describes the modified archive.

Blender 5.2.1 is required by this upstream release. Configure an explicit installed `blenderPath` in the provider row when it is outside the normal executable search path. Use the upstream workbench, recipes, project/revision tools, rendered previews, final renders and export operations. FFmpeg/ffprobe are needed for MP4 encoding. User content remains separate from installation files.

Run `node --test integrations/deepblend/test/adapter.test.mjs`. Release preparation, packed installation, lifecycle/workflow qualification, runtime installation and publication are delegated to the Luna Max release worker. Qualification evidence belongs alongside the pinned archive receipt; passing metadata tests alone does not qualify DeepBlend.
