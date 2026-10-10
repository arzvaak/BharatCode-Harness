# Ingest Scope Routing (Real-time + History Backfill Per-item Palace Judgment)

Motivation: Real-time auto-ingest hardcodes the scope to `user` (`ingestPreviousTurn` always `openStore('user')` + `scope: 'user'`),
so project decisions/conventions get stuffed into the personal palace, and are carried to every project via profile injection — contradicting "personal preferences follow the person, project conventions follow the repository".
History backfill already splits databases per session cwd, but uses one policy for the whole session, so personal preferences that are general across projects are still pinned into the project database.

## Design

1. **Extraction judges the palace**: Add `scope` (`project|user`) to `INGEST_SYSTEM` output items. Criteria: only related to the current project/repository
   (technical selection, project conventions, architecture decisions, facts about that project itself) → `project`; unrelated to a specific project, general across projects
   (personal preferences, habits, the user's own experiences, general facts) → `user`; **when unsure, use project**.
2. **Default policy by session affiliation**: A session with cwd defaults to `project` (lands in that cwd's project database), the model can mark obviously cross-project entries as `user`
   to land in the personal database; **a session without cwd can only enter the personal database, so per-item judgment is turned off** — otherwise `scope: 'project'` written into user.db
   would be invisible when search filters by scope (database split and scope marker must be consistent).
3. **Routing is three flat fields** (`IngestWriteRouting`): `writeScope` (fallback scope), `perCandidateScope` (whether to adopt the model value),
   `resolveStore(scope)` (resolve database by scope). Assembled by `ingestWriteRouting(cwd, openProjectStore, openScopeStore)`,
   the three real-time paths (previous round / disposed final round / pending replay) and history backfill share the same implementation.
4. **History backfill same policy**: Candidate sessions assemble routing by cwd (has cwd → default project + per-item judgment; no cwd → user and no judgment).
5. **Idempotency key decoupled from write landing point**: `ingest-done` / `ingest-pending` are session-level, unified and fixed in the user database
   (`openAuditStore`, fallback `openStore()` by default). Otherwise after writing into the project database, pending replay (`listAuditDetails` only in user database)
   would miss → same (session, round) duplicate ingest; after unification, real-time and backfill also share one key. `estimateHistoryBackfill`'s
   "already ingested" count is accordingly changed to only query the user database (estimation still does not create empty databases).
6. **Deduplication nearby**: Embedding neighbor deduplication (`findContradictions`) changed to operate on the target database — same database same scope judgment, no cross-database neighbors.
7. **Source of cwd for pending replay**: The new dsh's `sessionPersistence` only has handle-style `open(id,'read')`; the handle's
   `header.cwd` is that session's project affiliation (this session uses `agent.session.header.cwd`). The adapter layer
   `makeSessionResolver` returns `{ events, cwd }`, if cwd cannot be obtained it degrades to the personal palace policy (no error, just one less project routing).

## What Not to Do

- No config switch (callers uniformly go through the new policy; old behavior not configurable fallback).
- Do not change profile injection: injection still only reads the personal database (project database memories rely on `engram_search` recall), not touched this time.
- Do not migrate historical keys: done keys previously written in the project database become orphans, history backfill may re-ingest the same (session, round) once (one-time).

## Impact Scope

- `src/ingest/hook.ts`: prompt adds `scope`; `IngestDeps` adds `perCandidateScope` / `resolveStore` / `openAuditStore`;
  write loop picks database by candidate scope; done/pending keys go through the audit database; `IngestWriteRouting` + `ingestWriteRouting` newly added;
  `ReplayIngestDeps.resolveEvents` → `resolveSession` (with cwd) + `resolveStore`.
- `src/ingest/history.ts`: `CandidateSession.routing` replaces `writeScope`/`storeKey`; `resolveExistingStore` deleted;
  estimation queries the user database; ingest passes `openAuditStore: openUserStore` + routing.
- `src/index.ts`: `sessionCwd` / `makeSessionResolver` (handle header gets cwd); `preStep` adds `openStoreForProjectCwd`
  parameter and assembles routing by session cwd; disposed path same policy; `openProjectStoreIfExists` deleted.
- Tests: `ingest.spec` (routing tri-state, model scope adopt/fallback, audit key landing point, replay lands in project database by cwd),
  `history.spec` (keys in user database, backfill adopts model scope), `composition.spec` (handle with header, fake agent with session.header).
