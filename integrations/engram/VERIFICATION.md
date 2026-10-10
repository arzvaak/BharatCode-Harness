# English Engram integration verification

Source: reviewed local `engram-publish` v0.7.15; MIT license retained. English UI, settings, tool help, model prompts, runtime errors, exported prose, docs, icons, and bundles rebuilt from current source. Schema, locale IDs, tool names, input sanitization, and persisted room identifiers remain compatible. The 10 residual source-language lines are deliberate legacy room/slug identifiers or multilingual recognition and redaction patterns.

- `npm pack` prepack passed: source typecheck, parse gate, translation mutation guard, 476 tests passed, one online model E2E opt-in skipped, host/client rebuild, English surface and package checks.
- Stable registered Workspace ID hashes isolate projects independently of Git origins; titles and directory moves preserve ownership. Session tools and historical backfill use the registered canonical path. Legacy stores remain untouched for reviewed reassignment.
- Backup containment: traversal and absolute/nested filenames, symlink/hardlink/directory/extension tar entries rejected before writes; checksums/sizes validated; exclusive creation prevents duplicate/symlink overwrite. Eleven hostile extraction regressions and round-trip restore pass.
- Real cached Granite q8 offline inference verified on a synthetic DB copy: 512D original backed up, finite normalized 384D replacement, unchanged text. No remote model access; synthetic fixture cleaned after proof.
- Local artifact: `kenz1117-dsh-engram-0.7.15.tgz`. Live combined GUI verification belongs to the main integration preview.

## Preview incident repair

The main combined preview initially opened the original default user DB, adding migration12 observations table/index and changing schema metadata. Original desktop plugin supports schema11. Under explicit repair authorization, a native secure schema12 SQLite snapshot was preserved; the live DB required schema12 plus an empty observations table before restoring only schema metadata to11. Observations table/index were retained, existing node data were not rewritten. Node count15 and full-row digest matched before/after; integrity_check passed. The installed original schema11 store implementation successfully opened a secure copy after repair and read all15 nodes. Project/shared DBs were untouched. Secure snapshots are excluded from source/package and located under `/home/sushi/.local/share/bharatcode-plugin-preview-20261008/backups` with actual native directory0700/file0600 permissions.


## Shutdown lifecycle qualification

Startup/scheduled consolidation, session-end belief reflection, final-turn ingestion and summary, pre-step pending replay, auxiliary audit writes, and panel-started history backfill join the shutdown tracker. Unload cancels cancellable work and drains tracked jobs before SQLite connections close. Four focused lifecycle tests pass: delayed startup consolidation, real Loader active session reflection delayed inside its SQLite read, delayed final ingestion, and consolidation cancellation while embedding is unresolved. The regression fixtures first demonstrated premature closure, then verified cancellation, awaited disposal, zero SQLite accesses after close, and no finalized-statement or session-end exception warnings. Source typecheck, syntax, rebuild, English surface, and package gates pass. This qualification uses temporary databases only; no live user database was accessed.
