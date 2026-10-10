/**
 * Belief-consolidation reflectObservations tests: idempotent sampling, the four
 * form/refine/still/refute action checks, and the stale-freshness scan triggered
 * by new-evidence neighbors.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reflectObservations } from '../src/consolidation/reflect.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'
import type { EngramEmbedder } from '../src/embedder/interface.ts'
import { asMemoryId } from '../src/types.ts'

let dir: string
let store: EngramStore

const ROUTE = { provider: 'deepseek', model: 'deepseek-v4-flash' }
const SIGNAL = new AbortController().signal

/** Builds a fake embedder that returns fixed vectors (used for freshness scans / neighbor merges). */
function fakeEmbedder(vectors: readonly Float32Array[]): EngramEmbedder {
  return {
    model: 'fake-embedder',
    embed: async (texts: readonly string[]) => texts.map((_, index) => vectors[index % vectors.length]!),
    close: async () => undefined,
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-reflect-'))
  store = await openEngramStore(join(dir, 'user.db'))
})
afterEach(async () => {
  await store.close()
})

describe('reflectObservations', () => {
  it('empty store: no candidates, no stale — the LLM is not called', async () => {
    const call = vi.fn(async () => '[]')
    const outcome = await reflectObservations({
      store, embedder: undefined, scope: 'user', call, logRequest: () => undefined, route: ROUTE, signal: SIGNAL,
    })
    expect(outcome.candidates).toBe(0)
    expect(call).not.toHaveBeenCalled()
  })

  it('form: new evidence is consolidated into an active belief with an evidence chain (no neighbor merge without embeddings)', async () => {
    // Intentionally non-English test data: memory content and the LLM belief string
    // are fed to the store as-is; the behavior under test does not depend on the language.
    const a = await store.write({ scope: 'user', kind: 'fact', content: '构建用 pnpm', importance: 0.8 })
    const b = await store.write({ scope: 'user', kind: 'fact', content: '装依赖也用 pnpm', importance: 0.7 })
    const outcome = await reflectObservations({
      store,
      embedder: undefined,
      scope: 'user',
      call: async () => JSON.stringify([
        { action: 'form', belief: '项目包管理统一用 pnpm', sourceIds: [String(a.id), String(b.id)] },
      ]),
      logRequest: () => undefined,
      route: ROUTE,
      signal: SIGNAL,
    })
    expect(outcome.formed).toBe(1)
    const observations = await store.listObservations({ status: 'active', limit: 10 })
    expect(observations).toHaveLength(1)
    expect(observations[0]!.belief).toBe('项目包管理统一用 pnpm')
    expect(observations[0]!.proofCount).toBe(2)
    // The original memories stay active (consolidation adds an abstraction layer; it does not archive the evidence).
    expect((await store.get(a.id))?.status).toBe('active')
    expect((await store.get(b.id))?.status).toBe('active')
  })

  it('idempotent: memories already serving as belief evidence are excluded from candidates; a second run does not call the LLM', async () => {
    // Intentionally non-English test data: the memory content and belief are fixtures only.
    const a = await store.write({ scope: 'user', kind: 'fact', content: '一条已巩固的记忆' })
    const call = vi.fn(async () => JSON.stringify([
      { action: 'form', belief: '已巩固信念', sourceIds: [String(a.id)] },
    ]))
    const first = await reflectObservations({
      store, embedder: undefined, scope: 'user', call, logRequest: () => undefined, route: ROUTE, signal: SIGNAL,
    })
    expect(first.formed).toBe(1)
    const secondCall = vi.fn(async () => '[]')
    const second = await reflectObservations({
      store, embedder: undefined, scope: 'user', call: secondCall, logRequest: () => undefined, route: ROUTE, signal: SIGNAL,
    })
    expect(second.candidates).toBe(0)
    expect(secondCall).not.toHaveBeenCalled()
  })

  it('form with out-of-bounds sourceIds skips the action', async () => {
    // Intentionally non-English test data: the candidate memory content is a fixture only.
    await store.write({ scope: 'user', kind: 'fact', content: '候选记忆' })
    const outcome = await reflectObservations({
      store,
      embedder: undefined,
      scope: 'user',
      call: async () => JSON.stringify([
        { action: 'form', belief: '非法信念', sourceIds: ['not-in-candidates'] },
      ]),
      logRequest: () => undefined,
      route: ROUTE,
      signal: SIGNAL,
    })
    expect(outcome.formed).toBe(0)
    expect(outcome.skipped).toBe(1)
    expect(await store.listObservations({ limit: 10 })).toHaveLength(0)
  })

  it('the three stale-belief actions: refine merges evidence back to active, still keeps it, refute negates it', async () => {
    // Three pre-existing beliefs (written directly to the store as active), each marked stale.
    // Intentionally non-English test data: belief strings are fixtures only.
    const toRefine = await store.createObservation({ scope: 'user', belief: '待细化', sourceIds: [asMemoryId('old-1')] })
    const toConfirm = await store.createObservation({ scope: 'user', belief: '仍成立', sourceIds: [asMemoryId('old-2')] })
    const toRefute = await store.createObservation({ scope: 'user', belief: '已过时', sourceIds: [asMemoryId('old-3')] })
    await store.markObservationStale(toRefine.id)
    await store.markObservationStale(toConfirm.id)
    await store.markObservationStale(toRefute.id)
    // One fresh piece of evidence for refine to reference.
    // Intentionally non-English test data: the evidence content is a fixture only.
    const fresh = await store.write({ scope: 'user', kind: 'fact', content: '新的限定条件' })

    const outcome = await reflectObservations({
      store,
      embedder: undefined,
      scope: 'user',
      call: async () => JSON.stringify([
        { action: 'refine', observationId: String(toRefine.id), belief: '细化后的表述', sourceIds: [String(fresh.id)] },
        { action: 'still', observationId: String(toConfirm.id) },
        { action: 'refute', observationId: String(toRefute.id), reason: '新证据表明相反' },
      ]),
      logRequest: () => undefined,
      route: ROUTE,
      signal: SIGNAL,
    })
    expect(outcome.refined).toBe(1)
    expect(outcome.confirmed).toBe(1)
    expect(outcome.refuted).toBe(1)

    const refined = (await store.listObservations({ status: 'active', limit: 10 }))
      .find(item => String(item.id) === String(toRefine.id))
    expect(refined?.belief).toBe('细化后的表述')
    expect(refined?.proofCount).toBe(2)
    const refuted = (await store.listObservations({ status: 'refuted', limit: 10 }))
      .find(item => String(item.id) === String(toRefute.id))
    expect(refuted?.belief).toBe('已过时')
  })

  it('an action whose observationId is out of bounds (not in this stale set) is skipped', async () => {
    // Intentionally non-English test data: the candidate memory content is a fixture only.
    await store.write({ scope: 'user', kind: 'fact', content: '候选' })
    const outcome = await reflectObservations({
      store,
      embedder: undefined,
      scope: 'user',
      call: async () => JSON.stringify([
        { action: 'still', observationId: 'ghost-id' },
      ]),
      logRequest: () => undefined,
      route: ROUTE,
      signal: SIGNAL,
    })
    expect(outcome.confirmed).toBe(0)
    expect(outcome.skipped).toBe(1)
  })

  it('freshness scan: when new evidence is a neighbor of an active belief at the threshold, the belief is marked stale and fed into the re-review section', async () => {
    // The pre-existing belief lies along the x-axis; the new evidence also lies along the x-axis
    // (cosine = 1 >= the 0.86 stale threshold).
    // Intentionally non-English test data: the belief and evidence content are fixtures only.
    const observation = await store.createObservation({
      scope: 'user', belief: '既有信念', sourceIds: [asMemoryId('old-x')], embedding: new Float32Array([1, 0]),
    })
    await store.write({ scope: 'user', kind: 'fact', content: '一条近邻新证据' })
    const embedder = fakeEmbedder([new Float32Array([1, 0]), new Float32Array([1, 0])])

    let userText = ''
    const outcome = await reflectObservations({
      store,
      embedder,
      scope: 'user',
      call: async (params) => {
        userText = params.userText
        return JSON.stringify([{ action: 'still', observationId: String(observation.id) }])
      },
      logRequest: () => undefined,
      route: ROUTE,
      signal: SIGNAL,
    })
    expect(outcome.staleReviewed).toBe(1)
    // Host-generated section header from reflect.ts (currently emitted in Chinese by src).
    expect(userText).toContain('[Beliefs to review]')
    expect(userText).toContain(String(observation.id))
    // After still, the belief returns to active.
    expect((await store.listObservations({ status: 'active', limit: 10 }))).toHaveLength(1)
  })
})
