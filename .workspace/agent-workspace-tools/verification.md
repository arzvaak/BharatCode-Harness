# Verification

Implementation: workspace model tools and automatic source retention. Scope: model-operable workspace tools and automatic research retention; Linux local installation, without publishing a release.

- Scoped suites: 723 passed, 3 skipped in 46 files (45 passed, one skipped). Command: `vitest run packages/api/workspace-controller/tests packages/workspace/workspace/tests packages/client/ui-workspace/tests packages/web/tool-web/tests`.
- Final focused regressions: 46 passed in four files. Includes policy replacement/blocking, actual WorkspaceController composition, actual web-fetch tool, canonical session ownership, draft isolation, persisted virtual source reopening, existing/shell source recovery, extraction warnings, A-B-A file reversion, live panel refresh, pending reader preservation, and writing conflict recovery.
- Staged lint, whitespace and dependency manifest hooks passed. `pnpm run build:official` completed, including generated Remote contracts and the frontend.
- Packaged runtime smoke passed (host startup, frontend HTTP, native dependencies, Office conversion and skill CLI). Additional isolated packed-host check confirmed all seven tools, source discovery/read, writing journal persistence and private draft persistence.
- Actual AppImage Sources panel and reader showed exact recovered text in an isolated GUI profile. The frontend was reloaded once during this check; no model requests or account sign-ins were made. Writing persistence was verified via packaged tools/client tests; a native Writing-panel automation attempt did not complete because of element stability timing.
- Linux AppImage and Debian artifacts built. Debian tooling initially required libcrypt.so.1; a signature-verified Fedora libxcrypt-compat RPM was extracted under /tmp/bharatcode-builddeps, used only for the build. No system package installation was performed.
- AppImage 0.2.0-rc.2.20261012.1791802342 installed under /home/sushi/.local/share/bharatcode-linux-preview/versions. SHA-256: 45209b56eebb8332671c9fecf04053d172ad0189adcaefd5ef7f76c0bd719130. Launcher points to the new version; previous version retained. Existing user session was not restarted, so the update takes effect on the next application restart.

The screenshot's specific Harness Research project was not present in the inspected Linux profile. Its historical source files were not individually verified. Opening Sources in the new version discovers existing sources/ text files with explicit extraction/error/limit warnings. Other-platform installation and public release were not performed.
