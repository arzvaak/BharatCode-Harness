# Project Palace Follows Workspace Switch (Panel Display + Tool by Session cwd)

Motivation: The panel's "project" scope has always been **the plugin process directory's** single database (at `apply()` time
`resolveProjectIdentity(process.cwd())` is computed once and fixed), so: ① switching workspaces in the GUI does not change the project palace;
② the UI never displays "which workspace the current project palace belongs to"; ③ `engram_save/search` default project also lands in the process directory,
inconsistent with auto-ingest (which already judges the palace per-item by session cwd).

## Design

1. **Three-level source, zero state** (`src/project/registry.ts`): host `ctx.workspaceRegistry.list()`
   (web profile already loaded, dsh-web-app's peer) provides canonical path + title; next is cwd
   seen in the `sessionPersistence` header (databases created by history backfill can also be claimed); finally the plugin process directory as fallback. Computed fresh each time
   `directory → database name`, no additional registry file maintained — after a workspace is renamed/deleted the list automatically follows. Deduplicated by database name,
   so multiple worktrees of the same repository share one project palace.
2. **API parameterization** (`src/routes.ts`): new `GET /api/engram/workspaces` (list + process default item,
   if the database file does not exist do not open, do not create an empty database); all project scope GETs accept `?project=<dbName>`, POST accepts
   body `project`; default = process directory fallback (backward compatible); unknown selector throws `UnknownProjectError` →
   unified 404 `{error:"unknown project"}`, the panel falls back to "follow current workspace" based on this.
3. **Tool by session cwd** (`src/tools/create.ts`): `ToolDeps` adds `resolveProjectStore(cwd)`;
   inside `createEngramTools` use **AsyncLocalStorage** to expose the execution-time session cwd to the facade `deps` —
   `openStore('project')` is converted to `resolveProjectStore(execSessionCwd.getStore())`, all handlers
   and closure helpers do not need to change call sites one by one; ALS is used instead of a module-level variable, avoiding concurrent session cross-contamination.
   `sessionCwdOf(exec)` gets `exec.agent.session.header.cwd`, if it cannot be obtained, falls back to the process directory.
4. **Old naming migration** (`src/project/identity.ts`): cwd fallback naming changed from "cwd hex first 24 bits (only covers the first 12
   characters, same-prefix directories collide)" to "cwd full sha256 first 24 bits"; `migrateProjectDb`'s migration condition no longer
   limits the origin source (as long as `dbName !== legacyDbName`), at startup/first open rename the old database; if old and new coexist, leave untouched and
   warn (the old truncated name may be shared by multiple same-prefix directories, attribution can only be by hand).
5. **Close databases on uninstall**: `ctx.effect`'s disposer closes all cached database connections (if not closed on windows the .db is locked,
   after uninstall the directory cannot be deleted); also fixes the long-standing EBUSY cleanup failure in the composition test.
6. **client half**: The panel reads `ctx.workspaces` / `ctx.sessions` (optional services) to compute "current workspace",
   `library.project` = `'follow' | dbName` persists the selection; `api()` is the only request exit, automatically injects the selector for project scope
   (GET assembles query / POST supplements body), the right side of the Header three-grid displays
   `Project · Follow <workspace title>`, under project scope provides a workspace dropdown (including memory count).

## Impact Scope

- host: `src/project/registry.ts` (new), `src/project/identity.ts`, `src/routes.ts`,
  `src/index.ts` (list assembly / routing dependencies / decay scheduling covers each workspace / close databases on uninstall), `src/tools/create.ts`.
- client: `src/client/EngramPanel.tsx`, `src/client/index.ts`, `src/client/locales.ts`,
  `src/client/panel.module.css`.
- Tests: `tests/registry.spec.ts` (new), `tests/identity.spec.ts` (migration and collision),
  `tests/tools.spec.ts` (session cwd affiliation), `tests/composition.spec.ts` (`/workspaces` + `?project=` full chain).

## Not Doing

- No new config switch (policy built-in; process directory fallback is the old behavior).
- No sidecar registry file: a deleted workspace's database can only display the hash name, deal with it when needed.
- Profile injection still only reads the personal database (not touched this time).
