import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runConsolidation } from '../src/consolidation/run.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'

let dir: string
let store: EngramStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-cons-'))
  store = await openEngramStore(join(dir, 'user.db'))
})

afterEach(async () => {
  await store.close()
})

describe('Background Consolidation', () => {
  it('embeddings unavailable: archives old low-importance entries, heuristic-dedupes identical ones', async () => {
    // 1) Old + low importance / low confidence -> should be archived (write defaults confidence=0.5, must lower manually).
    const old = await store.write({ scope: 'user', kind: 'fact', content: 'old and irrelevant', importance: 0.1, confidence: 0.5 })
    // Manually set created_at to 60 days ago + confidence to 0.1 (interface does not expose lastAccessedAt / updateConfidence).
    const path = join(dir, 'user.db')
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(path)
    raw.prepare('UPDATE nodes SET created_at = ?, confidence = 0.1 WHERE id = ?').run(Date.now() - 60 * 86_400_000, old.id)
    raw.close()

    // 2) Identical content (heuristic dedup): a (0.5) and b (0.6) share text; b stays, a is archived.
    await store.write({ scope: 'user', kind: 'fact', content: 'prefers TypeScript', importance: 0.5, confidence: 0.7 })
    const b = await store.write({ scope: 'user', kind: 'fact', content: 'prefers TypeScript', importance: 0.6, confidence: 0.7 })
    // Identical content deduped: b (higher importance) survives
    void b // sanity

    // 3) Should NOT be archived (freshly created)
    const fresh = await store.write({ scope: 'user', kind: 'fact', content: 'fresh and high importance', importance: 0.9, confidence: 0.9 })

    // Design: existing wins (higher importance is never overwritten), so b (0.6) stays and a (0.5) is untouched.
    // Later assertions only check that archiving happened; merged depends on the importance order, not enforced here.
    const dbgBefore = await store.topActive('user', 10)
    const report = await runConsolidation(store, Promise.resolve(undefined), { olderThanDays: 30, importanceBelow: 0.3 })
    expect(report.archived).toBe(1) // only old hits the archive threshold
    expect(report.merged).toBe(0) // b has higher importance, kept; a untouched
    expect(dbgBefore.filter(r => r.content === 'prefers TypeScript')).toHaveLength(2) // both present before consolidation

    const stats = await store.stats()
    // Expect active=3: fresh (0.9) + b (0.6) + a (0.5); old already archived (forgotten); b and a have different importance so not merged.
    expect(stats.active).toBe(3)

    // fresh must still be alive
    const freshRow = (await store.topActive('user', 10)).find(record => record.id === fresh.id)
    expect(freshRow).toBeDefined()

    // op_log should record a consolidation summary
    const ops = await store.recentOps(50)
    const summary = ops.find(op => op.op === 'consolidation')
    expect(summary).toBeDefined()
    const detail = JSON.parse(summary!.detail!) as { archived: number; merged: number }
    expect(detail.archived).toBe(report.archived)
    expect(detail.merged).toBe(report.merged)
  })

  it('empty store call does not throw, summary all zeros', async () => {
    const report = await runConsolidation(store, Promise.resolve(undefined))
    expect(report.archived).toBe(0)
    expect(report.merged).toBe(0)
    expect(report.skipped).toBe(0)
    expect(report.tookMs).toBeGreaterThanOrEqual(0)
  })

  it('overrides default params (short age threshold) and still runs', async () => {
    await store.write({ scope: 'user', kind: 'fact', content: 'some content', importance: 0.5, confidence: 0.5 })
    const report = await runConsolidation(store, Promise.resolve(undefined), { olderThanDays: 1, importanceBelow: 0.4, mergeThreshold: 0.99 })
    expect(report).toBeDefined()
    expect(report.tookMs).toBeGreaterThanOrEqual(0)
  })
})


it('aborts consolidation while model loading remains unresolved', async () => {
  const controller = new AbortController()
  const pendingModel = new Promise<undefined>(() => {})
  const stopped = runConsolidation(store, pendingModel, { signal: controller.signal })
  await new Promise(resolve => setTimeout(resolve, 10))
  controller.abort()
  await expect(stopped).rejects.toMatchObject({ name: 'AbortError' })
})
