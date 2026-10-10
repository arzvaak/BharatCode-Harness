import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedHistoryRules } from '../src/config.ts'
import { estimateHistoryBackfill, mergeHistoryRules, runHistoryBackfill } from '../src/ingest/history.ts'
import type { HistoryBackfillDeps, HistoryLogSource } from '../src/ingest/history.ts'
import { INGEST_DONE_OP, encodeTurnKey } from '../src/ingest/hook.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'

/** Default rules (each case overrides as needed). */
const DEFAULTS: ResolvedHistoryRules = {
  days: 7,
  maxTurnsPerSession: 20,
  maxTotalTurns: 200,
  includeSubagents: false,
  includeSeeded: false,
  includeNoCwd: false,
}

let dir: string
const stores = new Map<string, EngramStore>()

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-history-'))
  stores.clear()
})
afterEach(async () => {
  for (const store of stores.values()) await store.close()
  stores.clear()
})

/** Open (and cache) the substore for a given key. */
async function storeFor(key: string): Promise<EngramStore> {
  const existing = stores.get(key)
  if (existing !== undefined) return existing
  const created = await openEngramStore(join(dir, `${key}.db`))
  stores.set(key, created)
  return created
}

/** Long text: pushes the activity score over the throttle threshold (userChars max 3 pts + two assistant messages 2 pts = 5). Intentionally non-English test data. */
const PAD = '这是一段足够长的具体描述，用来让活动评分达到节流阈值。'.repeat(12)

/** One turn's event sequence: long user input + assistant text + tool calls/results, exceeding the throttle threshold (score 8). The CJK text below is intentionally non-English test data. */
const turnEvents = (turn: number): unknown[] => [
  { type: 'turn/start', data: { turn }, seq: turn * 100, time: Date.now() },
  { type: 'user/message', data: { content: [{ type: 'text', text: `第 ${turn} 轮：${PAD}` }] }, seq: turn * 100 + 1, time: Date.now() },
  { type: 'assistant/message', data: { content: [{ type: 'text', text: '回答一' }] }, seq: turn * 100 + 2, time: Date.now() },
  ...['read', 'grep', 'edit'].map((name, index) => ({
    type: 'tool/call', data: { callId: `call-${turn}-${index}`, name, arguments: '{}' }, seq: turn * 100 + 3 + index, time: Date.now(),
  })),
  ...Array.from({ length: 5 }, (_, index) => ({
    type: 'tool/result', data: { callId: `call-${turn}-${index % 3}`, isError: false }, seq: turn * 100 + 10 + index, time: Date.now(),
  })),
]

interface SessionFixture {
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string | undefined
  readonly isSeeded?: boolean
  readonly origin?: string
  /** Turn numbers contained in this session. */
  readonly turns: readonly number[]
  /** Throw on read (simulates a corrupted log). */
  readonly unreadable?: boolean
}

/** Stub event source: header from fixture, events generated per turns. */
function makeSource(fixtures: readonly SessionFixture[]): HistoryLogSource {
  return {
    list: async () => fixtures.map(({ id, createdAt, cwd, isSeeded, origin }) => ({ id, createdAt, cwd, isSeeded, origin })),
    load: async (id) => {
      const fixture = fixtures.find(item => item.id === id)
      if (fixture === undefined) throw new Error(`unknown session ${id}`)
      if (fixture.unreadable === true) throw new Error('corrupted log')
      return { events: fixture.turns.flatMap(turn => turnEvents(turn)) }
    },
  }
}

/** Deps wiring: route to different substores by cwd (the user store is both the landing spot for no-cwd sessions and the home of idempotency/audit keys). */
function makeDeps(source: HistoryLogSource | undefined, calls: { count: number; routes?: { provider: string; model: string }[] }): HistoryBackfillDeps {
  return {
    source,
    resolveStore: cwd => storeFor(cwd),
    openUserStore: () => storeFor('user'),
    resolveExistingUserStore: async () => stores.get('user'),
    embedder: Promise.resolve(undefined),
    mode: 'light',
    routeOverride: { provider: 'deepseek', model: 'deepseek-v4' },
    call: async (params) => {
      calls.count += 1
      calls.routes?.push(params.route)
      const content = `提炼事实 ${calls.count}` // intentionally non-English test data (LLM stub output)
      return JSON.stringify([{ kind: 'fact', content, importance: 0.6 }])
    },
    logRequest: () => undefined,
  }
}

const NOW = 1_700_000_000_000

describe('mergeHistoryRules', () => {
  it('unspecified fields fall back to config defaults', () => {
    expect(mergeHistoryRules(DEFAULTS, {})).toEqual(DEFAULTS)
  })

  it('overrides take effect, but the total-turns cap is bounded by the config hard cap (can only be lowered)', () => {
    const merged = mergeHistoryRules({ ...DEFAULTS, maxTotalTurns: 100 }, { days: 30, maxTurnsPerSession: 5, maxTotalTurns: 999 })
    expect(merged.days).toBe(30)
    expect(merged.maxTurnsPerSession).toBe(5)
    expect(merged.maxTotalTurns).toBe(100)
  })

  it('out-of-range overrides throw (same bounds as config validation)', () => {
    expect(() => mergeHistoryRules(DEFAULTS, { days: -1 })).toThrow(/days/)
    expect(() => mergeHistoryRules(DEFAULTS, { maxTurnsPerSession: 0 })).toThrow(/maxTurnsPerSession/)
    expect(() => mergeHistoryRules(DEFAULTS, { maxTotalTurns: 99999 })).toThrow(/maxTotalTurns/)
  })

  it('auxiliary model must be provided as a pair (giving only one is a config error)', () => {
    expect(() => mergeHistoryRules(DEFAULTS, { provider: 'zai' })).toThrow(/together/)
    expect(() => mergeHistoryRules(DEFAULTS, { model: 'glm-4.5-air' })).toThrow(/together/)
    expect(() => mergeHistoryRules(DEFAULTS, { provider: 'zai', model: 'glm-4.5-air' })).not.toThrow()
  })
})

describe('history backfill auxiliary model routing', () => {
  it('when unspecified, the default route is used (config override > current model)', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1] }])
    const calls: { count: number; routes?: { provider: string; model: string }[] } = { count: 0, routes: [] }
    const deps = { ...makeDeps(source, calls), now: () => NOW }
    await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    expect(calls.routes?.[0]).toEqual({ provider: 'deepseek', model: 'deepseek-v4' })
  })

  it('explicit provider/model in rules overrides the default route', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1] }])
    const calls: { count: number; routes?: { provider: string; model: string }[] } = { count: 0, routes: [] }
    const deps = { ...makeDeps(source, calls), now: () => NOW }
    await runHistoryBackfill(
      deps, DEFAULTS,
      { provider: 'zai', model: 'glm-4.5-air' },
      () => undefined,
      new AbortController().signal,
    )
    expect(calls.routes?.[0]).toEqual({ provider: 'zai', model: 'glm-4.5-air' })
  })
})

describe('estimateHistoryBackfill', () => {
  it('returns unavailable when the environment does not provide session persistence', async () => {
    const estimate = await estimateHistoryBackfill(makeDeps(undefined, { count: 0 }), DEFAULTS)
    expect(estimate.unavailable).toBeDefined()
    expect(estimate.candidates).toBe(0)
  })

  it('excludes subagent/seeded/no-cwd/out-of-window sessions per rules, counted separately', async () => {
    const source = makeSource([
      { id: 'keep', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1, 2, 3] },
      { id: 'sub', createdAt: NOW - 1000, cwd: '/repo/a', origin: 'subagent', turns: [1] },
      { id: 'seed', createdAt: NOW - 1000, cwd: '/repo/a', isSeeded: true, turns: [1] },
      { id: 'nocwd', createdAt: NOW - 1000, turns: [1] },
      { id: 'old', createdAt: NOW - 40 * 86_400_000, cwd: '/repo/a', turns: [1] },
    ])
    const deps = { ...makeDeps(source, { count: 0 }), now: () => NOW }
    const estimate = await estimateHistoryBackfill(deps, DEFAULTS)
    expect(estimate.candidates).toBe(1)
    expect(estimate.eligibleTurns).toBe(3)
    expect(estimate.skipped.subagent).toBe(1)
    expect(estimate.skipped.seeded).toBe(1)
    expect(estimate.skipped.noCwd).toBe(1)
    expect(estimate.skipped.tooOld).toBe(1)
  })

  it('per-session takes the most recent N turns; total-turns cap truncates and marks truncated', async () => {
    const source = makeSource([
      { id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1, 2, 3, 4, 5] },
      { id: 'b', createdAt: NOW - 2000, cwd: '/repo/a', turns: [1, 2, 3, 4, 5] },
    ])
    const deps = { ...makeDeps(source, { count: 0 }), now: () => NOW }
    // Per-session cap 3: each session keeps only its most recent 3 turns.
    const perSession = await estimateHistoryBackfill(deps, DEFAULTS, { maxTurnsPerSession: 3 })
    expect(perSession.eligibleTurns).toBe(6)
    // Total cap 4: only the most recent session + 1 turn of the second session fit.
    const total = await estimateHistoryBackfill(deps, DEFAULTS, { maxTotalTurns: 4 })
    expect(total.eligibleTurns).toBe(4)
    expect(total.truncated).toBe(true)
  })

  it('subtracts previously ingested turns (estimate only queries existing stores, does not create empty ones)', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1, 2] }])
    const deps = { ...makeDeps(source, { count: 0 }), now: () => NOW }
    // First estimate: target store does not exist yet → no ingested turns.
    const before = await estimateHistoryBackfill(deps, DEFAULTS)
    expect(before.pendingTurns).toBe(2)
    expect(before.alreadyIngested).toBe(0)
    // After one ingestion run, re-estimate: the 2 ingested turns should be subtracted.
    await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    const after = await estimateHistoryBackfill(deps, DEFAULTS)
    expect(after.alreadyIngested).toBe(2)
    expect(after.pendingTurns).toBe(0)
  })
})

describe('runHistoryBackfill', () => {
  it('ingests turn by turn into the project store matching the session cwd (not the current store)', async () => {
    const source = makeSource([
      { id: 'a', createdAt: NOW - 1000, cwd: '/repo/alpha', turns: [1, 2] },
      { id: 'b', createdAt: NOW - 2000, cwd: '/repo/beta', turns: [1] },
    ])
    const calls = { count: 0 }
    const deps = { ...makeDeps(source, calls), now: () => NOW }
    const progress: number[] = []
    const result = await runHistoryBackfill(deps, DEFAULTS, {}, p => { progress.push(p.turnsDone) }, new AbortController().signal)
    expect(result.state).toBe('done')
    expect(result.sessionsDone).toBe(2)
    expect(result.turnsDone).toBe(3)
    expect(result.memoriesWritten).toBe(3)
    // 3 turn ingestions + 2 session-end summaries (one per session).
    expect(calls.count).toBe(5)
    // Each lands in its own cwd's store: alpha 2, beta 1, and scope marked as project.
    const alpha = await storeFor('/repo/alpha')
    const beta = await storeFor('/repo/beta')
    const alphaRecords = await alpha.topActive('project', 10)
    expect(alphaRecords).toHaveLength(2)
    expect(alphaRecords[0]?.sourceSessionId).toBe('a')
    expect(await beta.topActive('project', 10)).toHaveLength(1)
    // Progress callback invoked (including the terminal state).
    expect(progress.length).toBeGreaterThan(0)
    // Idempotency key is pinned to the user store: shared (session, turn) key with the live path, no cross-path duplicate ingestion.
    const userStore = await storeFor('user')
    expect(await userStore.hasAudit(INGEST_DONE_OP, encodeTurnKey('a', 1))).toBe(true)
    expect(await alpha.hasAudit(INGEST_DONE_OP, encodeTurnKey('a', 1))).toBe(false)
  })

  it('backfill also honors the model per-item scope: cross-project personal preferences land in the private palace', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/alpha', turns: [1] }])
    const deps = {
      ...makeDeps(source, { count: 0 }),
      now: () => NOW,
      // The CJK content below is intentionally non-English test data (LLM stub output; the assertions echo it back).
      call: async () => JSON.stringify([
        { kind: 'decision', content: '项目约定：发布前跑全量测试', scope: 'project', importance: 0.7 },
        { kind: 'preference', content: '用户偏好简体中文回复', scope: 'user', importance: 0.8 },
      ]),
    }
    const result = await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    expect(result.memoriesWritten).toBe(2)
    // project lands in the session cwd project store, user lands in the private store.
    const alpha = await storeFor('/repo/alpha')
    expect((await alpha.topActive('project', 10)).map(record => record.content)).toEqual(['项目约定：发布前跑全量测试'])
    const userStore = await storeFor('user')
    expect((await userStore.topActive('user', 10)).map(record => record.content)).toContain('用户偏好简体中文回复')
  })

  it('backfilled entries do not enter the SM-2 review queue (otherwise a one-shot backfill would flood today\'s due reviews)', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1] }])
    const deps = { ...makeDeps(source, { count: 0 }), now: () => NOW }
    await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    const store = await storeFor('/repo/a')
    const records = await store.topActive('project', 10)
    expect(records[0]?.review).toBeUndefined()
    expect(await store.dueReviews(Date.now(), 10)).toHaveLength(0)
  })

  it('re-run is idempotent: already-completed turns are skipped, no further LLM calls', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1, 2] }])
    const calls = { count: 0 }
    const deps = { ...makeDeps(source, calls), now: () => NOW }
    await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    // 2 turn ingestions + 1 session-end summary.
    expect(calls.count).toBe(3)
    const second = await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    expect(second.memoriesWritten).toBe(0)
    expect(second.turnsSkipped).toBe(2)
    // Skip reason is explainable: on re-run both turns skip as "already ingested".
    expect(second.skipReasons['already-ingested']).toBe(2)
    // Summary is also idempotent (skipped if already present): count unchanged.
    expect(calls.count).toBe(3)
    expect(await (await storeFor('/repo/a')).topActive('project', 10)).toHaveLength(2)
  })

  it('a single turn failure is recorded and processing continues, the batch is not interrupted', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1, 2] }])
    const deps = {
      ...makeDeps(source, { count: 0 }),
      now: () => NOW,
      call: async (params: { userText: string }) => {
        // Make the auxiliary call throw on turn 2 (simulates rate-limit/timeout). '第 2 轮' is intentionally non-English test data
        // matching the turnEvents user-message prefix, so this targets exactly turn 2.
        if (params.userText.includes('第 2 轮')) throw new Error('rate limited')
        return JSON.stringify([{ kind: 'fact', content: '提炼事实', importance: 0.6 }]) // intentionally non-English test data
      },
    }
    const result = await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    expect(result.state).toBe('done')
    expect(result.turnsFailed).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]?.turn).toBe(2)
    expect(result.failures[0]?.reason).toContain('rate limited')
    // Turn 1 writes as normal.
    expect(result.memoriesWritten).toBe(1)
  })

  it('the abort signal takes effect between turns, completed portions are preserved', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1, 2, 3] }])
    const controller = new AbortController()
    const deps = {
      ...makeDeps(source, { count: 0 }),
      now: () => NOW,
      call: async () => {
        // Request abort after turn 1 completes.
        controller.abort()
        return JSON.stringify([{ kind: 'fact', content: '提炼事实', importance: 0.6 }]) // intentionally non-English test data
      },
    }
    const result = await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, controller.signal)
    expect(result.state).toBe('cancelled')
    expect(result.turnsDone).toBeLessThan(3)
  })

  it('a corrupted session log is skipped without affecting the other sessions', async () => {
    const source = makeSource([
      { id: 'bad', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1], unreadable: true },
      { id: 'good', createdAt: NOW - 2000, cwd: '/repo/a', turns: [1] },
    ])
    const deps = { ...makeDeps(source, { count: 0 }), now: () => NOW }
    const estimate = await estimateHistoryBackfill(deps, DEFAULTS)
    expect(estimate.candidates).toBe(1)
    expect(estimate.skipped.unreadable).toBe(1)
    const result = await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    expect(result.memoriesWritten).toBe(1)
  })

  it('low-activity turns are throttled and skipped (no LLM call)', async () => {
    // Short user input + no assistant message → activity score 0, below threshold. '好的' is intentionally non-English test data (a short CJK ack).
    const source: HistoryLogSource = {
      list: async () => [{ id: 'low', createdAt: NOW - 1000, cwd: '/repo/a' }],
      load: async () => ({
        events: [
          { type: 'turn/start', data: { turn: 1 }, seq: 1, time: NOW },
          { type: 'user/message', data: { content: [{ type: 'text', text: '好的' }] }, seq: 2, time: NOW },
        ],
      }),
    }
    const calls = { count: 0 }
    const deps = { ...makeDeps(source, calls), now: () => NOW }
    const result = await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    // Summary is a session-level enhancement, not affected by turn throttling: 0 turn calls, 1 summary call.
    expect(calls.count).toBe(1)
    expect(result.memoriesWritten).toBe(0)
    expect(result.turnsSkipped).toBe(1)
    // Skip reason must explain "why nothing was written".
    expect(result.skipReasons['low-activity']).toBe(1)
  })

  it('session-end generates a one-sentence summary, lands in the session primary store; re-run does not re-summarize', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/alpha', turns: [1, 2] }])
    const calls = { count: 0 }
    const deps = {
      ...makeDeps(source, calls),
      now: () => NOW,
      call: async (params: { purpose: string }) => {
        calls.count += 1
        // Summary and extraction are two kinds of calls: purpose distinguishes them, summary returns plain text (not a JSON array).
        // The CJK summary text below is intentionally non-English test data (LLM stub output; the assertion echoes it back).
        if (params.purpose === 'engram-session-summary') return `一场围绕 /repo/alpha 的会话摘要（第 ${String(calls.count)} 次调用）`
        return JSON.stringify([{ kind: 'fact', content: '提炼事实', importance: 0.6 }]) // intentionally non-English test data
      },
    }
    await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    expect(calls.count).toBe(3)
    // Summary lands in the session primary store (the project store for its cwd), not the user store.
    expect(await (await storeFor('/repo/alpha')).getSessionSummary('a')).toBe('一场围绕 /repo/alpha 的会话摘要（第 3 次调用）')
    expect(await (await storeFor('user')).getSessionSummary('a')).toBeUndefined()
    // Re-run: turns and summary already exist, no further auxiliary calls.
    await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    expect(calls.count).toBe(3)
  })

  it('a failed summary call is silently skipped: not in failures, does not block backfill', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1] }])
    const deps = {
      ...makeDeps(source, { count: 0 }),
      now: () => NOW,
      call: async (params: { purpose: string }) => {
        // Summary call throws (simulates rate-limit/timeout); turn extraction proceeds normally.
        if (params.purpose === 'engram-session-summary') throw new Error('summary rate limited')
        return JSON.stringify([{ kind: 'fact', content: '提炼事实', importance: 0.6 }]) // intentionally non-English test data
      },
    }
    const result = await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    expect(result.state).toBe('done')
    expect(result.memoriesWritten).toBe(1)
    expect(result.failures).toHaveLength(0)
    expect(await (await storeFor('/repo/a')).getSessionSummary('a')).toBeUndefined()
  })

  it('no available route in the log: even the summary is skipped (no LLM call)', async () => {
    const source = makeSource([{ id: 'a', createdAt: NOW - 1000, cwd: '/repo/a', turns: [1] }])
    const calls = { count: 0 }
    const deps = { ...makeDeps(source, calls), now: () => NOW, routeOverride: undefined }
    const result = await runHistoryBackfill(deps, DEFAULTS, {}, () => undefined, new AbortController().signal)
    // Both turn ingestion and summary depend on an available route: with no route, neither fires.
    expect(calls.count).toBe(0)
    expect(result.memoriesWritten).toBe(0)
    expect(await (await storeFor('/repo/a')).getSessionSummary('a')).toBeUndefined()
  })
})
