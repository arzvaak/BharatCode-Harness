# dsh-engram History Conversation Backfill Implementation Plan (Historical Conversations → Memory Palace)

Motivation: The plugin's prior ingest only covered the **current session** (first-step ingest of the previous round + end-of-session backfill of the last round + pending replay). Historical conversation content the user accumulated before switching models/cleanup could not enter the palace — those "preferences, decisions, and experiences discussed before" are the most valuable part of long-term memory.

Prerequisite investigation (harness side, verified against source code):
- `sessionPersistence.list()` returns **snapshots** of all persisted sessions (`{ header, revision, eventCount?, sizeBytes? }`, header contains `id` / `createdAt` / `cwd` / `parentSession` / `isSeeded` / `origin` …), **no pagination, no filtering**.
- Log reads go through a **read-only handle**: `sessionPersistence.open(id, 'read')` → `handle.read()` (returns `{ eventState, events }`) → `handle.close()`. The earlier `load(id)` has been removed in the newer dsh — the plugin's history backfill and pending replay both read through this [index.ts persistenceService / makeEventResolver](../../src/index.ts) adapter layer.
- Session directory naming `root/<project>/<encoded id>/session.jsonl.zstd`, escaping and validation are handled by the provider: **using the service interface is more stable than walking directories yourself**.
- There is no existing capability to "batch-export all sessions"; cross-session search (`sessionQuery`) exists but is workspace-limited and that package is not mounted by default, so it is not used as a dependency.

## User Choices (Three Decisions Shaping the Design)

1. **Data scope**: dsh's own historical sessions (not external platform export files).
2. **Scope**: **database per session cwd** — historical sessions are written into their own project's database, avoiding cross-project database mixing.
3. **Cost**: conservative defaults — time window 7 days, single session ≤20 rounds, total rounds per run hard cap 200; estimate first then execute; no background auto-run.

Supplementary requirements: the panel has a **standalone tab**; **import rules are selected by the user in the panel**.

## Key Design

1. **Reuse the real-time ingest pipeline**: the inner layer directly calls `ingestPreviousTurn({ slice: <turn> })`, extraction/redaction/anti-echo/idempotency keys are all reused; only the outer layer of "enumerate sessions → filter → iterate round by round → quota → progress" is added. For this, three switches were added to `IngestDeps`: `throttle` (historical rounds are also throttled), `writeScope` (record a scope marker when writing to the project database), `history` (writes do not schedule review).
2. **Writes do not schedule review** (mandatory): `WriteInput.initialReviewAt` extended to `number | null`, `null` = explicitly not entering SM-2 scheduling — otherwise one backfill of 200 entries would directly flood tomorrow's "today's review queue". Stall positions are still scheduled (position index is retained).
3. **Database per cwd**: store cache key changed from scope to **database filename**, added `openStoreForProjectCwd(cwd)`; `dbNameForCwd` is cached and also runs the old-database rename migration once for historical cwds.
4. **Estimation is zero side-effect**: the estimation phase only opens **existing** database files (`existsSync` check) to look up idempotency keys, does not create empty databases because of estimation.
5. **Idempotent continuation**: the `(sessionId, turn)` done key ensures a re-run only fills in incomplete rounds; after pause/crash, restarting resumes.
6. **In-process job**: the panel starts a background task (singleton), HTTP only polls status; tool invocation runs synchronously to completion (constrained by the caller's signal), suitable for small batches or estimation first.

## Task Breakdown (All Completed)

- **T1 storage layer**: `openDb(dbName)` + `openStore(scope)` + `openStoreForProjectCwd(cwd)` (including cwd→dbName cache and old database migration).
- **T2 write period**: `initialReviewAt: number | null` (`null` = not scheduled), write-period automation judges by "only undefined goes to default".
- **T3 config**: `historyBackfillDays` / `historyBackfillMaxTurnsPerSession` / `historyBackfillMaxTotalTurns` / `historyBackfillIncludeSubagents` / `historyBackfillIncludeSeeded` / `historyBackfillIncludeNoCwd`, with range validation; `ResolvedHistoryRules` aggregates, total rounds cap is a hard ceiling (can only be lowered per run).
- **T4 ingest core `src/ingest/history.ts`**: `listHistorySessions` (filter subagents/seeded/no-cwd/out-of-window), `estimateHistoryBackfill` (candidates/in-rule rounds/pending rounds/exclusion counts/truncation flag), `runHistoryBackfill` (per session per round + progress callback + continue on failure + cancel).
- **T5 tool `engram_ingest_history`**: `dryRun` defaults to true (estimate only), only explicit false executes; rule parameters can be overridden per run.
- **T6 routing**: `GET /api/engram/history-backfill` (estimation, rules via query), `POST .../start`, `POST .../cancel`, `GET .../status`; the `history` interface is injected via `RouteDeps`.
- **T7 panel**: standalone tab "History Backfill" — rule area (time window / rounds per session / total rounds cap / three filter switches, all persisted), estimation area, execution area (start/pause + progress bar + skip and failure counts + first 3 failure details), polling every 1.5 seconds while running.
- **T8 tests**: `tests/history.spec.ts` (14 cases: rule merge and hard cap, filter counts, rounds truncation, estimation deducting already-ingested, per-cwd database writes, no review scheduling, re-run idempotency, single-round failure continue, cancel, corrupted log skip, low-activity throttling); composition test adds the full chain "estimate → start → poll to end" (session persistence injected with a stub, LLM stub offline → assert failure only counts, does not interrupt); tool count updated to 16.
- **T9 docs**: README bilingual (features, tool table 16, 6 new config keys, new tab description); this file.

## Anticipated Failure Causes and Countermeasures (Implemented During Development)

| Failure cause | Countermeasure |
|---|---|
| Environment lacks `sessionPersistence` (headless etc.) | Service is injected optionally; estimation returns `unavailable`, tool returns a readable explanation, panel shows unavailable and disables the start button |
| Single session log corrupted / encoding mismatch | `load` errors are swallowed and counted into `skipped.unreadable`, does not affect other sessions |
| LLM rate limiting / timeout | That round is recorded in `failures` and continues; done keys ensure re-run only fills in failed rounds |
| Process exits mid-backfill | Job state is lost but each completed round has a done key → re-estimation shows already-ingested, naturally resumes |
| Cost runaway | Estimation first (zero cost) + total rounds hard cap + must explicitly click/pass `dryRun=false`; no auto mode |
| Cross-project content miswrite | Database per session cwd; no-cwd sessions are skipped by default (if collected, explicitly marked as "can only enter the personal palace") |
| Historical entries flood the review queue | Backfill writes `initialReviewAt: null`, not entering SM-2 scheduling |

## Known Boundaries (Left for Later)

- The title is not in `SessionHeader`, so the panel cannot filter by title (needs `sessionQuery.readTitleSnapshots`, an optional capability); currently filters by time window and cwd.
- If the database corresponding to a historical cwd has never been opened on this machine, backfill will create a new database file for it (expected: that session does indeed belong to that project).
- Estimation and execution are two independent requests, both re-read the log; when there are many sessions, estimation itself has IO cost (limited concurrency of 4).

## Corrections After Real Run (Exposed by the First Real Backfill)

User's first run: 13 sessions / 55 rounds → 1 written, 45 rounds skipped, 5 rounds failed, failure reason was
`pi-ai provider "zai" has no configured model "glm-4.5-air"`. Based on this, three places were fixed:

1. **Auxiliary calls prefer reusing the currently available route** (`src/index.ts`): historical logs' `request/header` record the provider/model of that time, which may already be unavailable in the current environment. For this, `preStep` records the route resolved for the current session into `preStepState.route` at each round's first step, and the history backfill's `routeOverride` takes `config override ?? preStepState.route` — i.e., backfill "with the model you are using now". The composition test verifies with a zai/glm-4.5-air historical log + a deepseek current session: the auxiliary call goes through deepseek, does not fall back to zai.
2. **Skip reason distribution** (`src/ingest/history.ts`): `HistoryRunProgress.skipReasons` counts separately by the ingest pipeline's skip enums (low-activity / chitchat / capture-forbidden / no-user-content / already-ingested / no-route-in-log / unparsable), shown in both the panel and tool output — "few writes" is thus explainable (mostly throttling skips, not failures).
3. **Failure details readable**: session ids were originally truncated to the first 8 chars displayed as `session-` (no information), changed to show the last 12 chars; and when there are failures, give an actionable hint about row route being unavailable (configure provider/model, or first run a round with the target model then retry; completed rounds are automatically skipped).
