import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { RankBoostOptions } from '../src/store/sqlite.ts'
import type { MemoryId } from '../src/types.ts'

/**
 * Fixtures: A has higher term frequency (ranks first under pure RRF) but was last
 * accessed 40 days ago with an access count of 0; B has low term frequency but was
 * accessed recently with an access count of 30. When boost is active, B should overtake A.
 */
let path: string
let a: MemoryId
let b: MemoryId

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'engram-rank-'))
  path = join(dir, 'user.db')
  const store = await openEngramStore(path)
  // CJK test data is intentional: the FTS layer 2-gram tokenizes Chinese, so the
  // repeated bigram 端口 (port) is what drives the term-frequency ordering under test.
  a = (await store.write({ scope: 'user', kind: 'fact', content: '端口 端口 配置' })).id
  b = (await store.write({ scope: 'user', kind: 'fact', content: '端口 改动' })).id
  await store.close()
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path)
  db.prepare('UPDATE nodes SET last_accessed_at = ? WHERE id = ?').run(Date.now() - 40 * 86_400_000, a)
  db.prepare('UPDATE nodes SET access_count = 30 WHERE id = ?').run(b)
  db.close()
})

const searchOrder = async (boost: RankBoostOptions): Promise<MemoryId[]> => {
  const store = await openEngramStore(path, boost)
  const result = await store.search({ text: '端口', scopes: ['user'] }, undefined)
  await store.close()
  return result.hits.map(hit => hit.record.id)
}

describe('search ranking boost', () => {
  it('weights of 0 degrade to the current pure RRF ordering', async () => {
    expect(await searchOrder({ recencyWeight: 0, proofWeight: 0, decayAfterDays: 30 })).toEqual([a, b])
    expect(await searchOrder({ recencyWeight: 0, proofWeight: 0, decayAfterDays: 30 })).toEqual([a, b])
  })

  it('recency factor: fresh entry overtakes', async () => {
    expect(await searchOrder({ recencyWeight: 1, proofWeight: 0, decayAfterDays: 30 })).toEqual([b, a])
  })

  it('proof factor: high access count overtakes', async () => {
    expect(await searchOrder({ recencyWeight: 0, proofWeight: 1, decayAfterDays: 30 })).toEqual([b, a])
  })

  it('no boost by default (openEngramStore without options keeps the legacy ordering)', async () => {
    const store = await openEngramStore(path)
    const result = await store.search({ text: '端口', scopes: ['user'] }, undefined)
    await store.close()
    expect(result.hits.map(hit => hit.record.id)).toEqual([a, b])
  })
})
