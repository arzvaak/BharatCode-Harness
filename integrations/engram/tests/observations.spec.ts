/**
 * observations consolidated-belief table (schema v12) store-layer tests:
 * CRUD, evidence-union dedup, three-state transitions, ordering and vector neighbor.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'
import { asMemoryId, asObservationId, EngramError } from '../src/types.ts'

let dir: string
let store: EngramStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-observations-'))
  store = await openEngramStore(join(dir, 'user.db'))
})
afterEach(async () => {
  await store.close()
})

describe('observations CRUD', () => {
  it('create: evidence dedup, correct proof_count, initially active', async () => {
    const created = await store.createObservation({
      scope: 'user',
      belief: 'The project standardizes on pnpm',
      // Deliberately duplicated once; the store must dedupe on write.
      sourceIds: [asMemoryId('a'), asMemoryId('a'), asMemoryId('b')],
    })
    expect(created.status).toBe('active')
    expect(created.proofCount).toBe(2)
    expect(created.sourceIds.map(String)).toEqual(['a', 'b'])
    expect(created.lastValidatedAt).toBe(created.createdAt)
  })

  it('create: empty evidence fails loudly', async () => {
    await expect(store.createObservation({ scope: 'user', belief: 'No evidence', sourceIds: [] }))
      .rejects.toBeInstanceOf(EngramError)
  })

  it('refine: merges evidence union, updates belief, stale back to active', async () => {
    const observation = await store.createObservation({
      scope: 'user', belief: 'Old phrasing', sourceIds: [asMemoryId('a')],
    })
    await store.markObservationStale(observation.id)
    expect((await store.listObservations({ status: 'stale', limit: 10 }))).toHaveLength(1)

    const refined = await store.refineObservation(observation.id, 'New phrasing', [asMemoryId('a'), asMemoryId('c')])
    expect(refined?.status).toBe('active')
    expect(refined?.belief).toBe('New phrasing')
    expect(refined?.proofCount).toBe(2)
    expect(refined?.sourceIds.map(String).sort()).toEqual(['a', 'c'])
    expect(refined?.lastValidatedAt).toBeGreaterThanOrEqual(observation.createdAt)
  })

  it('refine/markStale/confirm/refute: nonexistent id returns undefined', async () => {
    expect(await store.refineObservation(asObservationId('ghost'), 'x', [])).toBeUndefined()
    expect(await store.markObservationStale(asObservationId('ghost'))).toBeUndefined()
    expect(await store.confirmObservation(asObservationId('ghost'))).toBeUndefined()
    expect(await store.refuteObservation(asObservationId('ghost'))).toBeUndefined()
  })

  it('confirm back to active; refuted terminal state excluded from neighbors', async () => {
    const observation = await store.createObservation({
      scope: 'user', belief: 'To be validated', sourceIds: [asMemoryId('a')], embedding: new Float32Array([1, 0]),
    })
    await store.markObservationStale(observation.id)
    expect((await store.confirmObservation(observation.id))?.status).toBe('active')
    await store.refuteObservation(observation.id)
    expect((await store.listObservations({ limit: 10 }))[0]?.status).toBe('refuted')
    // Refuted is excluded from neighbor candidates even with an embedding.
    expect(await store.nearestObservation(new Float32Array([1, 0]))).toBeUndefined()
  })

  it('list: status filter + proof_count descending', async () => {
    const weak = await store.createObservation({ scope: 'user', belief: 'Weak evidence', sourceIds: [asMemoryId('a')] })
    const strong = await store.createObservation({
      scope: 'user', belief: 'Strong evidence', sourceIds: [asMemoryId('b'), asMemoryId('c'), asMemoryId('d')],
    })
    const listed = await store.listObservations({ status: 'active', limit: 10 })
    expect(listed.map(item => String(item.id))).toEqual([String(strong.id), String(weak.id)])
    await store.refuteObservation(weak.id)
    expect(await store.listObservations({ status: 'active', limit: 10 })).toHaveLength(1)
  })

  it('nearestObservation: returns highest-cosine same-store belief', async () => {
    await store.createObservation({
      scope: 'user', belief: 'x direction', sourceIds: [asMemoryId('a')], embedding: new Float32Array([1, 0]),
    })
    await store.createObservation({
      scope: 'user', belief: 'y direction', sourceIds: [asMemoryId('b')], embedding: new Float32Array([0, 1]),
    })
    const nearest = await store.nearestObservation(new Float32Array([0.9, 0.1]))
    expect(nearest?.record.belief).toBe('x direction')
    expect(nearest?.similarity).toBeGreaterThan(0.9)
  })
})
