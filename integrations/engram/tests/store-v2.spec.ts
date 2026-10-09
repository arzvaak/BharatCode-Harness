import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openEngramStore } from '../src/store/sqlite.ts'
import { asMemoryId } from '../src/types.ts'
import type { EngramStore } from '../src/store/interface.ts'

let dir: string
let store: EngramStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-v2-'))
  store = await openEngramStore(join(dir, 'user.db'))
})
afterEach(async () => {
  await store.close()
})

describe('EngramStore v2 additions', () => {
  it('review returns the entry + supersedes chain + operation log', async () => {
    // Non-English content on purpose: exercises CJK FTS tokenization at write time.
    const old = await store.write({ scope: 'user', kind: 'fact', content: '端口 3000', sourceRound: 1, sourceSeq: 7 })
    const next = await store.update({ id: old.id, scope: 'user', kind: 'fact', content: '端口 4000' })
    const view = await store.review(next.id)
    expect(view?.record.content).toBe('端口 4000')
    expect(view?.supersedes.map(id => String(id))).toEqual([String(old.id)])
    expect(view?.record.sourceRound).toBeNull()
    const oldView = await store.review(old.id)
    expect(oldView?.supersededBy.map(id => String(id))).toEqual([String(next.id)])
    expect(oldView?.record.sourceSeq).toBe(7)
    expect(oldView?.operations.length).toBeGreaterThan(0)
    expect(oldView?.operations[0]!.op).toBe('superseded')
  })

  it('stats reports the distribution and signal ratio', async () => {
    // Single CJK characters on purpose: non-English test data (stats do not read content).
    await store.write({ scope: 'user', kind: 'fact', content: '甲' })
    await store.write({ scope: 'user', kind: 'preference', content: '乙' })
    const stale = await store.write({ scope: 'user', kind: 'episode', content: '丙' })
    await store.forget(stale.id)
    const stats = await store.stats()
    expect(stats.total).toBe(3)
    expect(stats.active).toBe(2)
    expect(stats.forgotten).toBe(1)
    expect(stats.byKind['fact']).toBe(1)
    expect(stats.byKind['episode']).toBe(1)
    expect(stats.signalRatio).toBeCloseTo(2 / 3, 5)
    expect(stats.opLogCount).toBeGreaterThan(0)
  })

  it('decay archives low-importance entries long untouched', async () => {
    const path = join(dir, 'user.db')
    // Non-English content on purpose: non-English test data (only the importance field is asserted).
    await store.write({ scope: 'user', kind: 'fact', content: '将被衰减', importance: 0.1 })
    await store.write({ scope: 'user', kind: 'fact', content: '重要性高保留', importance: 0.9 })
    // Backdate the last-access time of every entry by 40 days to simulate long inactivity;
    // also clear the review schedule auto-arranged at write time — entries in the review queue
    // are excluded from auto-decay (their fate is decided by the review outcome).
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(path)
    raw.prepare('UPDATE nodes SET last_accessed_at = ?, next_review_at = NULL').run(Date.now() - 40 * 86_400_000)
    raw.close()
    const archived = await store.decay({ importanceBelow: 0.3, olderThanDays: 30 })
    expect(archived).toBe(1)
    const survivors = await store.topActive('user', 10)
    expect(survivors.map(record => record.content)).toEqual(['重要性高保留'])
  })

  it('findContradictions reports only close high-similarity neighbors; linkEdge builds edges idempotently', async () => {
    // Non-English content on purpose: non-English test data (matched by embedding, not text).
    await store.write({ scope: 'user', kind: 'fact', content: '部署端口是 4000', embedding: new Float32Array(512).fill(0.5) })
    await store.write({ scope: 'user', kind: 'fact', content: '毫无相关的另一条', embedding: new Float32Array(512).fill(-0.5) })
    const candidates = await store.findContradictions(new Float32Array(512).fill(0.5))
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.content).toBe('部署端口是 4000')
    // Write a new entry and link a contradicts edge -> the review view groups it
    const next = await store.write({ scope: 'user', kind: 'fact', content: '部署端口改为 5000' })
    await store.linkEdge(next.id, candidates[0]!.id, 'contradicts')
    await store.linkEdge(next.id, candidates[0]!.id, 'contradicts')
    const view = await store.review(next.id)
    expect(view?.contradicts.map(id => String(id))).toEqual([String(candidates[0]!.id)])
  })

  it('supersedeMany writes new, archives old, and builds the chain in one transaction', async () => {
    // Non-English content on purpose: non-English test data (only ids and status are asserted).
    const a = await store.write({ scope: 'user', kind: 'fact', content: '碎片甲', importance: 0.4 })
    const b = await store.write({ scope: 'user', kind: 'fact', content: '碎片乙', importance: 0.6 })
    const merged = await store.supersedeMany(
      { scope: 'user', kind: 'skill', content: '甲乙合并的规律', importance: 0.8, confidence: 0.7, sourceRound: 3, sourceSeq: 12 },
      [a.id, b.id],
    )
    expect((await store.get(a.id))?.status).toBe('archived')
    expect((await store.get(b.id))?.status).toBe('archived')
    const view = await store.review(merged.id)
    expect(view?.supersedes.map(id => String(id)).sort()).toEqual([String(a.id), String(b.id)].sort())
    expect(view?.record.sourceRound).toBe(3)
    expect(view?.record.sourceSeq).toBe(12)
    // An empty list is equivalent to a plain write
    // Non-English content on purpose: non-English test data (read back as-written).
    const solo = await store.supersedeMany({ scope: 'user', kind: 'fact', content: '独立条目' }, [])
    expect(solo.content).toBe('独立条目')
  })

  it('exportAll includes entries of every status and the edges', async () => {
    // Non-English content on purpose: non-English test data (only ids/status are asserted).
    const a = await store.write({ scope: 'user', kind: 'fact', content: '导出甲' })
    const forgotten = await store.write({ scope: 'user', kind: 'fact', content: '导出乙' })
    await store.forget(forgotten.id)
    await store.linkEdge(a.id, forgotten.id, 'related')
    const data = await store.exportAll()
    expect(data.records.map(record => record.id).sort()).toEqual([a.id, forgotten.id].sort())
    expect(data.records.find(record => record.id === forgotten.id)?.status).toBe('forgotten')
    expect(data.edges).toHaveLength(1)
    expect(asMemoryId(data.edges[0]!.from)).toBe(a.id)
  })

  it('a search hit raises confidence', async () => {
    // Non-English content on purpose: '置信度' is the CJK FTS search term and the matching
    // substring of the content, so it must stay non-English for the hit to occur.
    const record = await store.write({ scope: 'user', kind: 'fact', content: '置信度提升条目', confidence: 0.5 })
    await store.search({ text: '置信度', scopes: ['user'] }, undefined)
    const bumped = await store.get(record.id)
    expect(bumped?.confidence).toBeCloseTo(0.55, 5)
  })
})

describe('EngramStore list (management view)', () => {
  it('filters and paginates by status/kind/substring, covering all statuses', async () => {
    // Non-English content on purpose: the q filter searches this exact CJK substring
    // (instr), so both the content and the query term must stay non-English.
    await store.write({ scope: 'user', kind: 'fact', content: '列表甲 fact' })
    await store.write({ scope: 'user', kind: 'preference', content: '列表乙 preference' })
    const forgotten = await store.write({ scope: 'user', kind: 'fact', content: '列表丙 forgotten' })
    await store.forget(forgotten.id)
    const all = await store.list({ scope: 'user', limit: 10, offset: 0 })
    expect(all.total).toBe(3)
    expect(all.records).toHaveLength(3)
    const onlyForgotten = await store.list({ scope: 'user', status: 'forgotten', limit: 10, offset: 0 })
    expect(onlyForgotten.records.map(r => r.id)).toEqual([forgotten.id])
    const onlyPreference = await store.list({ scope: 'user', kind: 'preference', limit: 10, offset: 0 })
    expect(onlyPreference.records.map(r => r.kind)).toEqual(['preference'])
    const byQ = await store.list({ scope: 'user', q: '列表甲', limit: 10, offset: 0 })
    expect(byQ.records.map(r => r.content)).toEqual(['列表甲 fact'])
    const paged = await store.list({ scope: 'user', limit: 1, offset: 1 })
    expect(paged.records).toHaveLength(1)
    expect(paged.total).toBe(3)
  })

  it('sort=tour orders by tour-route slot position; off-route entries go last', async () => {
    // Non-English content on purpose: non-English test data (only ids/order are asserted).
    const a = await store.write({ scope: 'user', kind: 'fact', content: '路线甲' })
    const b = await store.write({ scope: 'user', kind: 'fact', content: '路线乙' })
    const c = await store.write({ scope: 'user', kind: 'fact', content: '路线丙' })
    // All three written in the same millisecond: spread created_at explicitly so the
    // default-descending assertion is deterministic (a is the oldest, c the newest).
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(join(dir, 'user.db'))
    const base = Date.now()
    raw.prepare('UPDATE nodes SET created_at = ? WHERE id = ?').run(base - 3000, a.id)
    raw.prepare('UPDATE nodes SET created_at = ? WHERE id = ?').run(base - 2000, b.id)
    raw.prepare('UPDATE nodes SET created_at = ? WHERE id = ?').run(base - 1000, c.id)
    raw.close()
    const byTour = await store.list({ scope: 'user', sort: 'tour', limit: 10, offset: 0 })
    expect(byTour.records.map(record => record.id)).toEqual([a.id, b.id, c.id])
    // Default sort: created_at descending (the later write comes first).
    const byTime = await store.list({ scope: 'user', limit: 10, offset: 0 })
    expect(byTime.records.map(record => record.id)).toEqual([c.id, b.id, a.id])
  })
})

describe('EngramStore palace & review scheduling (schema v6)', () => {
  it('auto-slots on write: room by kind, incrementing index, registered on the tour route, due after 1 day', async () => {
    // Non-English content on purpose: non-English test data (only the slot is asserted).
    const fact = await store.write({ scope: 'user', kind: 'fact', content: '自动排桩的事实' })
    // Room name is a persisted legacy room identifier (KIND_ROOMS), kept exactly as exported.
    expect(fact.slot).toEqual({ room: '事实厅', index: 1 })
    const preference = await store.write({ scope: 'user', kind: 'preference', content: '自动排桩的偏好' })
    expect(preference.slot).toEqual({ room: '偏好阁', index: 1 })
    const secondFact = await store.write({ scope: 'user', kind: 'fact', content: '第二条事实' })
    expect(secondFact.slot).toEqual({ room: '事实厅', index: 2 })
    // The route appends in registration order: 事实厅#1, 偏好阁#1, 事实厅#2.
    const route = await store.routeList()
    expect(route.map(stop => stop.id)).toEqual([fact.id, preference.id, secondFact.id])
    expect(await store.routeHas(fact.id)).toBe(true)
    // Initial schedule: write time + 1 day (approximate assertion tolerates millisecond drift).
    expect(fact.review?.nextReviewAt).toBeGreaterThan(Date.now() + 86_400_000 - 5_000)
    expect(fact.review?.reps).toBe(0)
  })

  it('placard scoring is persisted: uniqueness, distinctness, and date are scored independently', async () => {
    const good = await store.write({
      scope: 'user',
      kind: 'fact',
      content: '端口配置',
      // Non-English caption on purpose: the date anchor "2026-09-11" plus the CJK
      // distinctness heuristic are the behavior under test (full score = 1).
      imagery: { caption: '2026-09-11 端口改为 4000 的定案', sensoryTags: [], emotionalValence: 0, provisional: false },
    })
    expect(good.imageryScore).toBe(1)
    const bad = await store.write({
      scope: 'user',
      kind: 'fact',
      // Non-English caption on purpose: too short (3 chars) to score (expects 0).
      content: '另一条',
      imagery: { caption: '端口改', sensoryTags: [], emotionalValence: 0, provisional: false },
    })
    expect(bad.imageryScore).toBe(0)
  })

  it('scheduleReview advances SM-2: consecutive perfects go 1 -> 6, a failure resets to 1 day', async () => {
    const record = await store.write({ scope: 'user', kind: 'skill', content: '复习调度目标' })
    const first = await store.scheduleReview(record.id, 5)
    expect(first?.review?.intervalDays).toBe(1)
    expect(first?.review?.reps).toBe(1)
    const second = await store.scheduleReview(record.id, 5)
    expect(second?.review?.intervalDays).toBe(6)
    expect(second?.review?.reps).toBe(2)
    const failed = await store.scheduleReview(record.id, 1)
    expect(failed?.review?.intervalDays).toBe(1)
    expect(failed?.review?.reps).toBe(0)
    // A nonexistent id returns undefined (the panel/tool reports 404 on that).
    expect(await store.scheduleReview(asMemoryId('nonexistent-id'), 5)).toBeUndefined()
  })

  it('dueReviews only collects entries that are due, most overdue first', async () => {
    const due = await store.write({ scope: 'user', kind: 'fact', content: '已到期条目' })
    const fresh = await store.write({ scope: 'user', kind: 'fact', content: '刚写入未到期条目' })
    const path = join(dir, 'user.db')
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(path)
    // Move due back 3 days and fresh forward 1 day.
    raw.prepare('UPDATE nodes SET next_review_at = ? WHERE id = ?').run(Date.now() - 3 * 86_400_000, due.id)
    raw.prepare('UPDATE nodes SET next_review_at = ? WHERE id = ?').run(Date.now() + 86_400_000, fresh.id)
    raw.close()
    const queue = await store.dueReviews(Date.now(), 10)
    expect(queue.map(record => record.id)).toEqual([due.id])
  })

  it('backfillSlots is idempotent: slots existing entries, registers the route, and does not duplicate on re-run', async () => {
    const path = join(dir, 'legacy.db')
    const legacy = await openEngramStore(path)
    const old = await legacy.write({ scope: 'user', kind: 'decision', content: '存量条目' })
    await legacy.close()
    // Clear the slot and the route to simulate a legacy DB written before v6
    // (the columns exist but hold NULL values).
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(path)
    raw.prepare('UPDATE nodes SET slot_room = NULL, slot_index = NULL').run()
    raw.exec('DELETE FROM tour_routes')
    raw.close()
    const reopened = await openEngramStore(path)
    const opened: string[] = []
    const patched = await reopened.backfillSlots(room => { opened.push(room) })
    expect(patched).toBe(1)
    const after = await reopened.get(old.id)
    // Room name is a persisted legacy room identifier (KIND_ROOMS), kept exactly as exported.
    expect(after?.slot).toEqual({ room: '决策堂', index: 1 })
    expect((await reopened.routeList()).map(stop => stop.id)).toEqual([old.id])
    // Idempotent: a re-run has no pending entries.
    expect(await reopened.backfillSlots(room => { opened.push(room) })).toBe(0)
    expect(opened).toEqual([])
    await reopened.close()
  })

  it('opening a real v5 DB (no v6 columns) migrates it to the latest schema: creates columns and indexes, keeps the data', async () => {
    const path = join(dir, 'real-v5.db')
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(path)
    // Hand-build the v5 structure: it has outcome / imagery_json but no v6 columns
    // (such as slot_room) and no tour_routes table.
    raw.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
        importance REAL NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL,
        created_at INTEGER NOT NULL, last_accessed_at INTEGER NOT NULL, access_count INTEGER NOT NULL,
        source_session_id TEXT, source_round INTEGER, source_seq INTEGER, embedding BLOB,
        outcome TEXT, imagery_json TEXT);
      CREATE TABLE edges (from_id TEXT NOT NULL, to_id TEXT NOT NULL, type TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY (from_id, to_id, type));
      CREATE TABLE op_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, op TEXT NOT NULL,
        target_id TEXT NOT NULL, detail TEXT);
      CREATE TABLE nodes_revisions (node_id TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL,
        importance REAL NOT NULL, superseded_at INTEGER NOT NULL);
      INSERT INTO meta (key, value) VALUES ('schema_version', '5');
    `)
    raw.prepare(`INSERT INTO nodes
      (id, scope, kind, content, importance, confidence, status, created_at, last_accessed_at, access_count)
      VALUES ('legacy-1', 'user', 'fact', 'v5 存量条目', 0.5, 0.5, 'active', ?, ?, 0)`)
      .run(Date.now(), Date.now())
    raw.close()
    // Opening triggers the migration: it must not throw "no such column"
    // (v6 indexes built before the columns existed were a prior regression).
    const migrated = await openEngramStore(path)
    const record = await migrated.get(asMemoryId('legacy-1'))
    expect(record?.content).toBe('v5 存量条目')
    expect(record?.slot).toBeUndefined()
    // After migration, a new write slots normally: the columns and indexes are in place.
    const fresh = await migrated.write({ scope: 'user', kind: 'fact', content: '迁移后写入' })
    // Room name is a persisted legacy room identifier (KIND_ROOMS), kept exactly as exported.
    expect(fresh.slot).toEqual({ room: '事实厅', index: 1 })
    // The legacy entry gets its slot from backfillSlots (triggered at first open by the
    // plugin layer; here we verify directly that it is idempotent and runnable).
    expect(await migrated.backfillSlots(() => { /* the test does not care about the new-room note */ })).toBe(1)
    expect((await migrated.get(asMemoryId('legacy-1')))?.slot).toEqual({ room: '事实厅', index: 2 })
    await migrated.close()
    const check = new DatabaseSync(path)
    expect((check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as unknown as { value: string }).value).toBe('12')
    const indexes = (check.prepare('PRAGMA index_list(nodes)').all() as unknown as { name: string }[]).map(row => row.name)
    expect(indexes).toContain('nodes_slot')
    expect(indexes).toContain('nodes_review_due')
    expect(indexes).toContain('nodes_kind_created')
    expect(indexes).toContain('nodes_session_created')
    check.close()
  })

  it('a v5 version number but complete columns/tables migrates idempotently (re-opening does not error)', async () => {
    const path = join(dir, 'migrate-v6.db')
    const legacy = await openEngramStore(path)
    const record = await legacy.write({ scope: 'user', kind: 'fact', content: 'v5 时代条目' })
    await legacy.close()
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(path)
    // Only downgrade the version number to simulate v5: the v6 columns/tables already
    // exist, so the migration path relies on idempotent probing to skip duplicate DDL.
    raw.prepare("UPDATE meta SET value = '5' WHERE key = 'schema_version'").run()
    raw.close()
    const migrated = await openEngramStore(path)
    expect((await migrated.get(record.id))?.content).toBe('v5 时代条目')
    await migrated.close()
    const check = new DatabaseSync(path)
    const version = (check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as unknown as { value: string }).value
    check.close()
    expect(version).toBe('12')
  })
})
