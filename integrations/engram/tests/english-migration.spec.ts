import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openEngramStore } from '../src/store/sqlite.ts'

it('does not rank legacy vectors as semantic neighbors of English-model vectors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'engram-english-migration-'))
  const store = await openEngramStore(join(dir, 'user.db'))
  try {
    await store.write({ scope: 'user', kind: 'fact', content: 'Legacy vector', embedding: new Float32Array(512).fill(1) })
    expect((await store.nearestNeighbor(new Float32Array(384).fill(1)))?.similarity).toBe(0)
    const current = await store.write({ scope: 'user', kind: 'fact', content: 'Current English vector', embedding: new Float32Array(384).fill(1) })
    expect((await store.nearestNeighbor(new Float32Array(384).fill(1)))?.record.id).toBe(current.id)
  } finally {
    await store.close()
  }
})
