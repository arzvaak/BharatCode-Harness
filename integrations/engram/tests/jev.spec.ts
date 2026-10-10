import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askNoul, createMemoryJudge, testJevConnection } from '../src/jev/client.ts'
import { clearJevObservations, listJevObservations, recordJevObservation } from '../src/jev/observe.ts'
import { confirmContradictions, decideWrite } from '../src/write-disposition.ts'
import type { ResolvedJevConfig } from '../src/config.ts'
import type { EngramStore } from '../src/store/interface.ts'
import type { JudgeQuestion, MemoryJudge } from '../src/write-disposition.ts'
import type { MemoryId, MemoryRecord } from '../src/types.ts'

/** Jev config fixture for enabled scenarios. */
const jevConfig: ResolvedJevConfig = {
  enabled: true,
  apiKey: 'test-key',
  baseUrl: 'https://jev.test',
  model: 'jev-test',
  timeoutMs: 3000,
  deferMergeAbove: 0.85,
  deferAcceptBelow: 0.15,
  contradictMinProbability: 0.8,
}

/** MemoryRecord fixture: the four-state decision only reads id/kind/content; the rest falls to defaults. */
function makeRecord(content: string, id = 'm-neighbor'): MemoryRecord {
  return {
    id: id as MemoryId,
    scope: 'user',
    kind: 'fact',
    content,
    importance: 0.5,
    confidence: 0.5,
    status: 'active',
    createdAt: 0,
    lastAccessedAt: 0,
    accessCount: 0,
    sourceSessionId: null,
    sourceRound: null,
    sourceSeq: null,
  }
}

/**
 * Fake judge: answers every question id with a fixed probability; if answer is an
 * Error, ask throws (simulating a network failure). calls records the state and
 * questions of each ask so test assertions can check question content and count.
 */
function fakeJudge(answer: number | Error): MemoryJudge & { calls: { state: string; questions: readonly JudgeQuestion[] }[] } {
  const calls: { state: string; questions: readonly JudgeQuestion[] }[] = []
  return {
    deferMergeAbove: 0.85,
    deferAcceptBelow: 0.15,
    contradictMinProbability: 0.8,
    ask: async (state, questions) => {
      calls.push({ state, questions })
      if (answer instanceof Error) throw answer
      return Object.fromEntries(questions.map(question => [question.id, answer]))
    },
    calls,
  }
}

/** Stub global fetch: returns a fixed JSON payload and status, and the mock for request-shape assertions. */
function stubFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('askNoul', () => {
  it('POSTs state/questions to {baseUrl}/v1/systemone and parses noul probabilities', async () => {
    const fetchMock = stubFetch({ answers: { same_memory: { noul: 0.7 } } })
    const answers = await askNoul(jevConfig, 'state text', [{ id: 'same_memory', instructions: 'same fact?' }])
    expect(answers).toEqual({ same_memory: 0.7 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('https://jev.test/v1/systemone')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body as string) as { model: string; state: string; questions: Record<string, { type: string; instructions: string }> }
    expect(body.model).toBe('jev-test')
    expect(body.state).toBe('state text')
    expect(body.questions.same_memory).toEqual({ type: 'noul', instructions: 'same fact?' })
  })

  it('short-circuits an empty question list without sending a request', async () => {
    const fetchMock = stubFetch({ answers: {} })
    const answers = await askNoul(jevConfig, 'state text', [])
    expect(answers).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws on non-2xx', async () => {
    stubFetch({ error: 'nope' }, 503)
    await expect(askNoul(jevConfig, 's', [{ id: 'q', instructions: 'i' }])).rejects.toThrow(/HTTP 503/)
  })

  it('throws when the response lacks answers', async () => {
    stubFetch({})
    await expect(askNoul(jevConfig, 's', [{ id: 'q', instructions: 'i' }])).rejects.toThrow(/missing answers/)
  })

  it('throws when noul is not a number or out of range', async () => {
    stubFetch({ answers: { q: { noul: 'high' } } })
    await expect(askNoul(jevConfig, 's', [{ id: 'q', instructions: 'i' }])).rejects.toThrow(/noul probability/)
    stubFetch({ answers: { q: { noul: 1.5 } } })
    await expect(askNoul(jevConfig, 's', [{ id: 'q', instructions: 'i' }])).rejects.toThrow(/noul probability/)
  })
})

describe('createMemoryJudge', () => {
  it('passes the three thresholds and timeout through from config', () => {
    const judge = createMemoryJudge(jevConfig)
    expect(judge.deferMergeAbove).toBe(0.85)
    expect(judge.deferAcceptBelow).toBe(0.15)
    expect(judge.contradictMinProbability).toBe(0.8)
  })
})

describe('decideWrite defer band Jev verdict', () => {
  /** Defer band store fixture: nearest-neighbor similarity 0.9 falls between DEFER_COSINE(0.88) and MERGE_COSINE(0.92). */
  function bandStore(neighbor: MemoryRecord, similarity = 0.9): EngramStore {
    return { nearestNeighbor: async () => ({ record: neighbor, similarity }) } as unknown as EngramStore
  }
  const embedding = new Float32Array(4).fill(0.5)

  it('probability >= deferMergeAbove: merge into the nearest neighbor', async () => {
    const judge = fakeJudge(0.9)
    const neighbor = makeRecord('user works in hangzhou')
    const decision = await decideWrite(bandStore(neighbor), 'fact', embedding, { judge, content: 'user lives in hangzhou' })
    expect(decision).toEqual({ disposition: 'merge', into: neighbor, similarity: 0.9 })
    expect(judge.calls).toHaveLength(1)
    // The asked state is a Memory A/B comparison: A is the existing entry, B the new content
    // (calls length 1 already asserted; use optional chaining for safe indexed access).
    expect(judge.calls[0]?.state).toContain('user works in hangzhou')
    expect(judge.calls[0]?.state).toContain('user lives in hangzhou')
  })

  it('probability <= deferAcceptBelow: accept as new', async () => {
    const judge = fakeJudge(0.1)
    const decision = await decideWrite(bandStore(makeRecord('A')), 'fact', embedding, { judge, content: 'B' })
    expect(decision).toEqual({ disposition: 'accept' })
  })

  it('middle-band probability: keeps defer pending manual review', async () => {
    const judge = fakeJudge(0.5)
    const neighbor = makeRecord('A')
    const decision = await decideWrite(bandStore(neighbor), 'fact', embedding, { judge, content: 'B' })
    expect(decision).toEqual({ disposition: 'defer', neighbor, similarity: 0.9 })
  })

  it('judge.ask throws: silently degrades back to defer (never loses manual review)', async () => {
    const judge = fakeJudge(new Error('network down'))
    const neighbor = makeRecord('A')
    const decision = await decideWrite(bandStore(neighbor), 'fact', embedding, { judge, content: 'B' })
    expect(decision).toEqual({ disposition: 'defer', neighbor, similarity: 0.9 })
  })

  it('no judge injected: pure-rule defer (same behavior as before Jev was wired in)', async () => {
    const neighbor = makeRecord('A')
    const decision = await decideWrite(bandStore(neighbor), 'fact', embedding)
    expect(decision).toEqual({ disposition: 'defer', neighbor, similarity: 0.9 })
  })

  it('similarity >= MERGE_COSINE, same kind: pure-rule merge directly, judge never asked', async () => {
    const judge = fakeJudge(new Error('should not be asked'))
    const neighbor = makeRecord('A')
    const decision = await decideWrite(bandStore(neighbor, 0.95), 'fact', embedding, { judge, content: 'B' })
    expect(decision).toEqual({ disposition: 'merge', into: neighbor, similarity: 0.95 })
    expect(judge.calls).toHaveLength(0)
  })
})

describe('confirmContradictions', () => {
  it('keeps candidates whose probability >= contradictMinProbability', async () => {
    const judge = fakeJudge(0.9)
    const candidate = makeRecord('contradiction candidate A', 'm-a')
    const confirmed = await confirmContradictions(judge, 'new content', [candidate])
    expect(confirmed).toEqual([candidate])
  })

  it('probability below the threshold: everything filtered out', async () => {
    const judge = fakeJudge(0.3)
    const confirmed = await confirmContradictions(judge, 'new content', [makeRecord('A', 'm-a')])
    expect(confirmed).toEqual([])
  })

  it('judge throws: returns undefined (caller degrades to full edge creation)', async () => {
    const judge = fakeJudge(new Error('network down'))
    const confirmed = await confirmContradictions(judge, 'new content', [makeRecord('A', 'm-a')])
    expect(confirmed).toBeUndefined()
  })

  it('empty candidates: no question sent, returns an empty array', async () => {
    const judge = fakeJudge(0.9)
    const confirmed = await confirmContradictions(judge, 'new content', [])
    expect(confirmed).toEqual([])
    expect(judge.calls).toHaveLength(0)
  })
})

describe('verdict observation instrumentation', () => {
  beforeEach(() => { clearJevObservations() })

  /** Defer band store fixture (same shape as the decideWrite describe): similarity 0.9 lands in the defer band. */
  function bandStore(neighbor: MemoryRecord): EngramStore {
    return { nearestNeighbor: async () => ({ record: neighbor, similarity: 0.9 }) } as unknown as EngramStore
  }
  const embedding = new Float32Array(4).fill(0.5)

  it('the three defer-band verdicts are recorded as merge/accept/defer respectively', async () => {
    await decideWrite(bandStore(makeRecord('A')), 'fact', embedding, { judge: fakeJudge(0.9), content: 'B' })
    await decideWrite(bandStore(makeRecord('A')), 'fact', embedding, { judge: fakeJudge(0.1), content: 'B' })
    await decideWrite(bandStore(makeRecord('A')), 'fact', embedding, { judge: fakeJudge(0.5), content: 'B' })
    expect(listJevObservations().map(o => o.verdict)).toEqual(['merge', 'accept', 'defer'])
    const first = listJevObservations()[0]
    expect(first?.site).toBe('band')
    expect(first?.question).toBe('same_memory')
    expect(first?.answered).toBe(true)
    expect(first?.probability).toBe(0.9)
    expect(first?.error).toBeUndefined()
    expect(typeof first?.elapsedMs).toBe('number')
  })

  it('a missing defer-band answer is recorded as a fallback (answered=false)', async () => {
    const noAnswerJudge: MemoryJudge = {
      deferMergeAbove: 0.85,
      deferAcceptBelow: 0.15,
      contradictMinProbability: 0.8,
      ask: async () => ({}),
    }
    const decision = await decideWrite(bandStore(makeRecord('A')), 'fact', embedding, { judge: noAnswerJudge, content: 'B' })
    expect(decision).toEqual({ disposition: 'defer', neighbor: makeRecord('A'), similarity: 0.9 })
    const last = listJevObservations().at(-1)
    expect(last?.verdict).toBe('fallback')
    expect(last?.answered).toBe(false)
    expect(last?.probability).toBeUndefined()
  })

  it('a throwing defer-band judge records a fallback carrying the error message', async () => {
    await decideWrite(bandStore(makeRecord('A')), 'fact', embedding, { judge: fakeJudge(new Error('network down')), content: 'B' })
    const last = listJevObservations().at(-1)
    expect(last?.verdict).toBe('fallback')
    expect(last?.error).toBe('network down')
  })

  it('contradiction confirmation records confirm/reject respectively', async () => {
    await confirmContradictions(fakeJudge(0.9), 'new content', [makeRecord('A', 'm-a')])
    await confirmContradictions(fakeJudge(0.3), 'new content', [makeRecord('B', 'm-b')])
    expect(listJevObservations().map(o => o.verdict)).toEqual(['confirm', 'reject'])
    const first = listJevObservations()[0]
    expect(first?.site).toBe('contradiction')
    expect(first?.question).toBe('contradicts')
  })

  it('a throwing contradiction confirmation records a fallback and the overall degradation contract is unchanged', async () => {
    const confirmed = await confirmContradictions(fakeJudge(new Error('boom')), 'new content', [makeRecord('A', 'm-a')])
    expect(confirmed).toBeUndefined()
    const last = listJevObservations().at(-1)
    expect(last?.verdict).toBe('fallback')
    expect(last?.error).toBe('boom')
  })
})

describe('observe ring buffer', () => {
  beforeEach(() => { clearJevObservations() })

  /** Observation fixture: at increments to distinguish order; the other fields are fixed. */
  function makeObservation(at: number): Parameters<typeof recordJevObservation>[0] {
    return { at, site: 'band', question: 'same_memory', answered: true, probability: 0.5, elapsedMs: 1, error: undefined, verdict: 'defer' }
  }

  it('reads in order; drops the oldest beyond 50 entries', () => {
    for (let at = 0; at < 55; at += 1) recordJevObservation(makeObservation(at))
    const all = listJevObservations()
    expect(all).toHaveLength(50)
    expect(all[0]?.at).toBe(5)
    expect(all.at(-1)?.at).toBe(54)
  })

  it('returns a copy; external mutations do not affect the buffer', () => {
    recordJevObservation(makeObservation(1))
    const copy = [...listJevObservations()]
    copy.pop()
    expect(listJevObservations()).toHaveLength(1)
  })
})

describe('testJevConnection', () => {
  it('success returns ok and the ping probability', async () => {
    stubFetch({ answers: { ping: { noul: 0.42 } } })
    const result = await testJevConnection(jevConfig)
    expect(result.ok).toBe(true)
    expect(result.probability).toBe(0.42)
    expect(result.error).toBeUndefined()
    expect(typeof result.elapsedMs).toBe('number')
  })

  it('failure does not throw; error carries the reason', async () => {
    stubFetch({}, 401)
    const result = await testJevConnection(jevConfig)
    expect(result.ok).toBe(false)
    expect(result.probability).toBeUndefined()
    expect(result.error).toContain('HTTP 401')
  })
})
