import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aggregateTelemetry } from '../src/telemetry/aggregate.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'

let dir: string
let user: EngramStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-tele-'))
  user = await openEngramStore(join(dir, 'user.db'))
})

afterEach(async () => {
  await user.close()
})

describe('local telemetry aggregateTelemetry', () => {
  it('empty store yields zero counts and a healthy scopes view', async () => {
    const snapshot = await aggregateTelemetry(async (scope) => {
      if (scope === 'user') return user
      // shared/project are never opened; hitting the "not created" branch does not affect the overall result.
      throw new Error(`unexpected scope ${scope}`)
    }, 7)
    expect(snapshot.windowDays).toBe(7)
    expect(snapshot.counts.writes).toBe(0)
    expect(snapshot.counts.ingestRequests).toBe(0)
    expect(snapshot.scopes).toHaveLength(1)
    expect(snapshot.scopes[0]!.scope).toBe('user')
    expect(snapshot.scopes[0]!.active).toBe(0)
  })

  it('writes and forgets are counted under writes / forgets', async () => {
    const a = await user.write({ scope: 'user', kind: 'fact', content: 'alpha', importance: 0.6 })
    await user.write({ scope: 'user', kind: 'fact', content: 'beta', importance: 0.5 })
    await user.forget(a.id)
    const snapshot = await aggregateTelemetry(async scope => scope === 'user' ? user : user, 7)
    expect(snapshot.counts.writes).toBeGreaterThanOrEqual(2) // includes the user 'write' ops
    expect(snapshot.counts.forgets).toBeGreaterThanOrEqual(1)
  })

  it('windowDays defaults to 7', async () => {
    // Note: the function itself accepts any windowDays; this only checks the default behavior.
    const snapshot = await aggregateTelemetry(async scope => scope === 'user' ? user : user)
    expect(snapshot.windowDays).toBe(7)
  })

  it('scope view correctly reflects stats', async () => {
    await user.write({ scope: 'user', kind: 'fact', content: 'alpha', importance: 0.6, confidence: 0.8 })
    const snapshot = await aggregateTelemetry(async scope => scope === 'user' ? user : user)
    expect(snapshot.scopes[0]!.active).toBe(1)
    expect(snapshot.scopes[0]!.total).toBe(1)
    expect(snapshot.scopes[0]!.signalRatio).toBeCloseTo(1.0, 1) // 1 active / 1 total
  })
})
