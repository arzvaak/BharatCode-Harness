import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { distillMemories } from '../src/flywheel/distill.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'

let dir: string
let store: EngramStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-distill-'))
  store = await openEngramStore(join(dir, 'user.db'))
})
afterEach(async () => {
  await store.close()
})

const ROUTE = { provider: 'deepseek', model: 'deepseek-v4-flash' }

describe('distillMemories', () => {
  it('returns immediately when fewer than 2 entries', async () => {
    await store.write({ scope: 'user', kind: 'fact', content: 'A single entry' })
    const outcome = await distillMemories({
      store,
      embedder: undefined,
      scope: 'user',
      call: async () => '[]',
      logRequest: () => undefined,
      route: ROUTE,
      signal: new AbortController().signal,
    })
    expect(outcome.distilled).toBe(0)
  })

  it('valid cluster merge: new entry active, old entries archived, supersedes chain holds', async () => {
    const a = await store.write({ scope: 'user', kind: 'fact', content: 'Build the project with pnpm', confidence: 0.6 })
    const b = await store.write({ scope: 'user', kind: 'fact', content: 'Install dependencies with pnpm', confidence: 0.4 })
    const outcome = await distillMemories({
      store,
      embedder: undefined,
      scope: 'user',
      call: async () => JSON.stringify([
        { content: 'The project uses pnpm uniformly for managing and installing dependencies', kind: 'skill', importance: 0.8, supersedes: [String(a.id), String(b.id)] },
      ]),
      logRequest: () => undefined,
      route: ROUTE,
      signal: new AbortController().signal,
    })
    expect(outcome.distilled).toBe(1)
    expect(outcome.superseded).toBe(2)
    expect((await store.get(a.id))?.status).toBe('archived')
    expect((await store.get(b.id))?.status).toBe('archived')
    const merged = await store.topActive('user', 10)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.content).toBe('The project uses pnpm uniformly for managing and installing dependencies')
    expect(merged[0]!.kind).toBe('skill')
    // Confidence inherits the cluster mean (0.6 + 0.4) / 2
    expect(merged[0]!.confidence).toBeCloseTo(0.5, 5)
  })

  it('skips a group when supersedes references ids outside the input set', async () => {
    await store.write({ scope: 'user', kind: 'fact', content: 'Entry A' })
    await store.write({ scope: 'user', kind: 'fact', content: 'Entry B' })
    const outcome = await distillMemories({
      store,
      embedder: undefined,
      scope: 'user',
      call: async () => JSON.stringify([
        { content: 'Invalid merge', kind: 'skill', importance: 0.8, supersedes: ['not-a-real-id'] },
      ]),
      logRequest: () => undefined,
      route: ROUTE,
      signal: new AbortController().signal,
    })
    expect(outcome.distilled).toBe(0)
    expect(outcome.superseded).toBe(0)
    expect(await store.topActive('user', 10)).toHaveLength(2)
  })

  it('returns 0 without throwing when the LLM output is unparseable', async () => {
    await store.write({ scope: 'user', kind: 'fact', content: 'A' })
    await store.write({ scope: 'user', kind: 'fact', content: 'B' })
    const outcome = await distillMemories({
      store,
      embedder: undefined,
      scope: 'user',
      call: async () => 'garbled output',
      logRequest: () => undefined,
      route: ROUTE,
      signal: new AbortController().signal,
    })
    expect(outcome.distilled).toBe(0)
    expect(await store.topActive('user', 10)).toHaveLength(2)
  })
})
