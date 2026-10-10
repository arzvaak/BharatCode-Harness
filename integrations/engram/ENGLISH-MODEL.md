# English embedding model

The English fork uses `onnx-community/granite-embedding-small-english-r2-ONNX` with q8 weights, mean pooling, normalized 384-dimensional vectors, and local inference. First use downloads the model; subsequent runs use the local cache.

## Verification

Run `ENGRAM_E2E=1 pnpm test` to include the real model download and inference test. Explicit opt-in fails on network/model errors instead of silently skipping. The test checks dimensions, finite values, normalization, and English semantic similarity.

## Existing memory databases

Legacy 512-dimensional vectors are not comparable with the new model. Retrieval and consolidation reject mismatched dimensions. Existing memory text is not changed automatically.

Stop Harness before rebuilding vectors. First inspect the dry-run report:

```sh
node scripts/reembed-after-english.mjs /path/to/engram
```

Back up the database directory, then run during a maintenance window:

```sh
node scripts/reembed-after-english.mjs /path/to/engram --apply --maintenance-window
```

The migration only updates missing or wrong-size vectors and guards against concurrent text changes. It does not translate stored memory text. Databases do not record embedding model identity, so a vector with the expected size is not proof that it came from Granite; the script reports this limitation and leaves already-384-dimensional vectors unchanged.

The full English translation is maintained directly on main and preserves the fork's v0.7.15 features, including the beliefs UI. Build both current host and client bundles with `pnpm bundle`, then validate the English surfaces with `pnpm check:english`. No older bundles are substituted for current source.

## Complete English package

`pnpm check:english` checks the UI source, compiled client and source map, package manifest, icon assets, and both READMEs. `node scripts/audit-english.mjs` reports remaining source-language locations for review without echoing their contents. Legacy persisted identifiers and multilingual input handling must be assessed separately rather than rewritten blindly.

`npm pack` runs the prepack gate: typechecking, source syntax validation, translation-guard mutation checks, the regression suite, rebuilding both current bundles, and English-surface checks. Set `ENGRAM_E2E=1` when packing to require fresh English-model download and inference too. The archive includes source, regression tests, documentation, scripts, and build configuration alongside the bundles. The package gate also checks that embedded client source-map contents match current source, rejecting stale UI artifacts. The complete English publication must include the built `lib` artifacts on GitHub main for consumers who need the bundle rather than source alone.

For the isolated standalone-page browser smoke test, set `PLAYWRIGHT_MODULE` to an installed Playwright `index.mjs`, then run `node scripts/test-english-page.mjs`. This test does not replace verification of an installed Harness runtime or migrate stored memories.

## BharatCode Workspace ownership

Registered projects use the stable host Workspace ID, hashed into the existing project database filename format. Two workspaces remain isolated even when they share a Git origin. Titles and directory moves do not change a Workspace ID database. Tools, ingestion, historical backfill, and the project panel resolve registered canonical paths to this same ID. Unregistered directories retain legacy origin/cwd resolution.

Existing origin/cwd databases are preserved; they are not silently merged into a registered workspace. Review and export old records before explicitly assigning them to the intended workspace. Keep user scope for cross-project personal preferences and shared scope only for intentionally shared memory. Project knowledge evidence and Engram memory remain separate stores.

For strictly offline vector migration, copy the stopped database and cached models into an isolated directory, then use `--offline` with the preview or `--apply --maintenance-window` command. Offline mode disables remote models and fails if the cache is absent. The migration backs up original database files before changing vectors and preserves stored text.
