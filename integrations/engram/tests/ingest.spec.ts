import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACTIVITY_THRESHOLD, INGEST_DONE_OP, INGEST_PENDING_OP, activityScore, encodeTurnKey, ensureSessionSummary, ingestFinalTurn,
  ingestPreviousTurn, ingestWriteRouting, isChitchat, forbidsCapture, lastTurnNumber, lastTurnSlice, markPendingIngest,
  parseEntityMentions, parseFactMentions, previousTurnSlice, replayPendingIngests, throttleDecision,
  turnSlice, turnSignals,
} from '../src/ingest/hook.ts'
import type { IngestRequestEventData } from '../src/ingest/hook.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'

let dir: string
let store: EngramStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-ingest-'))
  store = await openEngramStore(join(dir, 'user.db'))
})
afterEach(async () => {
  await store.close()
})

/** Session event builders (shape-aligned narrow runtime view of harness log events). */
const turnStart = (turn: number) => ({ type: 'turn/start', data: { turn }, time: Date.now(), seq: turn * 100 })
const userMsg = (text: string, seq: number) => ({
  type: 'user/message',
  data: { content: [{ type: 'text', text }] },
  time: Date.now(),
  seq,
})
const pluginMsg = (text: string, seq: number, kind: string = 'plugin:time-context') => ({
  type: 'user/message',
  // kind defaults to the v4 shape (producer-owned prefix); passing 'plugin' builds the legacy v3 shape.
  data: { source: { kind, plugin: 'time-context' }, content: [{ type: 'text', text }] },
  time: Date.now(),
  seq,
})
const assistantMsg = (text: string, seq: number) => ({
  type: 'assistant/message',
  data: { content: [{ type: 'text', text }] },
  time: Date.now(),
  seq,
})
const toolCall = (callId: string, name: string, seq: number) => ({
  type: 'tool/call', data: { callId, name, arguments: '{}' }, time: Date.now(), seq,
})
const toolResult = (callId: string, seq: number) => ({
  type: 'tool/result', data: { callId, isError: false }, time: Date.now(), seq,
})
const routeHeader = (seq: number) => ({
  type: 'request/header',
  data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } },
  time: Date.now(),
  seq,
})

/** Long padding text: pads a user message to >=150 chars (activity score userChars capped at 3). */
const PAD = '上下文填充。'.repeat(30)

/** A previous turn with "substantive activity" (activity score 6, above the ingest threshold). */
const substantiveTurn1 = () => [
  turnStart(1),
  userMsg(`我最喜欢 TypeScript。${PAD}`, 3),
  toolCall('c1', 'fs_read', 4),
  toolResult('c1', 5),
  toolCall('c2', 'web_search', 6),
  toolResult('c2', 7),
  assistantMsg('助手的完整回答', 8),
  routeHeader(9),
]

const VALID_LLM_OUTPUT = JSON.stringify([
  { content: '用户最喜欢的编程语言是 TypeScript', kind: 'preference', importance: 0.8 },
  { content: '用户在开发 dsh-engram 记忆插件', kind: 'fact', importance: 0.7 },
])

const baseDeps = (overrides?: Partial<Parameters<typeof ingestPreviousTurn>[0]>) => ({
  events: [...substantiveTurn1(), turnStart(2), userMsg('现在的问题', 200)],
  sessionId: 'sess-ingest-1',
  turn: 2,
  openStore: async () => store,
  embedder: Promise.resolve(undefined),
  mode: 'light' as const,
  routeOverride: undefined,
  call: async () => VALID_LLM_OUTPUT,
  logRequest: (_data: IngestRequestEventData) => undefined,
  signal: new AbortController().signal,
  ...overrides,
})

describe('previousTurnSlice', () => {
  it('returns empty when fewer than two turns', () => {
    expect(previousTurnSlice([turnStart(1), userMsg('x', 1)])).toHaveLength(0)
    expect(previousTurnSlice([])).toHaveLength(0)
  })

  it('slices the whole turn before the last turn/start', () => {
    const slice = previousTurnSlice([
      turnStart(1),
      userMsg('第一轮内容', 2),
      assistantMsg('第一轮回答', 3),
      turnStart(2),
      userMsg('第二轮内容', 200),
    ])
    expect(slice).toHaveLength(3)
  })
})

describe('ingestPreviousTurn', () => {
  it('light mode extracts from user messages, writes, and records source attribution', async () => {
    const logged: IngestRequestEventData[] = []
    const outcome = await ingestPreviousTurn(baseDeps({
      logRequest: data => logged.push(data),
    }))
    expect(outcome.written).toBe(2)
    expect(outcome.skipped).toBeNull()
    expect(logged).toHaveLength(1)
    expect(logged[0]!.route).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(logged[0]!.round).toBe(1)
    const rows = await store.topActive('user', 10)
    expect(rows.some(record => record.content === '用户最喜欢的编程语言是 TypeScript')).toBe(true)
    const withRound = rows.find(record => record.content === '用户在开发 dsh-engram 记忆插件')
    expect(withRound?.sourceSessionId).toBe('sess-ingest-1')
    expect(withRound?.sourceRound).toBe(1)
    expect(withRound?.sourceSeq).toBe(3)
    expect(withRound?.confidence).toBeCloseTo(0.3, 5)
  })

  it('light mode skips assistant messages and plugin-injected snapshots', async () => {
    const seen: string[] = []
    await ingestPreviousTurn(baseDeps({
      events: [
        turnStart(1),
        pluginMsg('User memory profile (dsh-engram):', 2),
        userMsg(`真实用户输入。${PAD}`, 3),
        assistantMsg('助手长回答内容', 4),
        toolCall('c1', 'fs_read', 5),
        toolResult('c1', 6),
        toolCall('c2', 'web_search', 7),
        toolResult('c2', 8),
        routeHeader(9),
        turnStart(2),
        userMsg('现在的问题', 200),
      ],
      call: async params => {
        seen.push(params.userText)
        return JSON.stringify([{ content: '一条记忆', kind: 'fact', importance: 0.5 }])
      },
    }))
    expect(seen[0]).toContain('真实用户输入')
    expect(seen[0]).not.toContain('助手长回答内容')
    expect(seen[0]).not.toContain('User memory profile')
  })

  it('eager mode includes assistant messages', async () => {
    let userText = ''
    await ingestPreviousTurn(baseDeps({
      mode: 'eager',
      events: [
        turnStart(1),
        userMsg(`用户输入。${PAD}`, 2),
        assistantMsg('助手关键结论', 3),
        toolCall('c1', 'fs_read', 4),
        toolResult('c1', 5),
        toolCall('c2', 'web_search', 6),
        toolResult('c2', 7),
        routeHeader(8),
        turnStart(2),
        userMsg('现在的问题', 200),
      ],
      call: async params => {
        userText = params.userText
        return JSON.stringify([{ content: '来自助手的记忆', kind: 'fact', importance: 0.5 }])
      },
    }))
    expect(userText).toContain('助手关键结论')
  })

  it('skips when no route is found in the log', async () => {
    const outcome = await ingestPreviousTurn(baseDeps({
      events: [
        turnStart(1),
        userMsg(`内容。${PAD}`, 2),
        assistantMsg('回答内容', 3),
        toolCall('c1', 'fs_read', 4),
        toolResult('c1', 5),
        toolCall('c2', 'web_search', 6),
        toolResult('c2', 7),
        turnStart(2),
        userMsg('现在', 200),
      ],
    }))
    expect(outcome.skipped).toBe('no-route-in-log')
    expect(outcome.written).toBe(0)
  })

  it('skips when LLM output is unparseable', async () => {
    const outcome = await ingestPreviousTurn(baseDeps({ call: async () => '这不是 JSON' }))
    expect(outcome.skipped).toBe('unparseable-output')
    expect(outcome.written).toBe(0)
  })

  it('route override takes precedence over log parsing', async () => {
    const logged: IngestRequestEventData[] = []
    await ingestPreviousTurn(baseDeps({
      routeOverride: { provider: 'zai', model: 'glm-5.2' },
      logRequest: data => logged.push(data),
    }))
    expect(logged[0]!.route).toEqual({ provider: 'zai', model: 'glm-5.2' })
  })

  it('duplicate content in the same batch is written only once', async () => {
    const outcome = await ingestPreviousTurn(baseDeps({
      call: async () => JSON.stringify([
        { content: '同一条记忆', kind: 'fact', importance: 0.5 },
        { content: '同一条记忆', kind: 'fact', importance: 0.5 },
      ]),
    }))
    expect(outcome.written).toBe(1)
  })

  it('tier cap applies: light allows at most 2', async () => {
    const outcome = await ingestPreviousTurn(baseDeps({
      mode: 'light',
      call: async () => JSON.stringify([
        { content: '甲', kind: 'fact', importance: 0.5 },
        { content: '乙', kind: 'fact', importance: 0.5 },
        { content: '丙', kind: 'fact', importance: 0.5 },
      ]),
    }))
    expect(outcome.written).toBe(2)
  })

  it('idempotent: repeat ingest of the same (sessionId, turn) skips directly', async () => {
    const first = await ingestPreviousTurn(baseDeps())
    expect(first.written).toBe(2)
    const second = await ingestPreviousTurn(baseDeps())
    expect(second.skipped).toBe('already-ingested')
    expect(second.written).toBe(0)
    expect(await store.hasAudit(INGEST_DONE_OP, encodeTurnKey('sess-ingest-1', 1))).toBe(true)
    // The store still has only the first batch (no duplicate writes).
    expect((await store.topActive('user', 10)).length).toBe(2)
  })

  it('normal and disposed paths do not double-write: after the last turn is ingested, a resumed session skips its previous-turn ingest', async () => {
    const events = [
      turnStart(1),
      userMsg('第一轮内容', 2),
      routeHeader(3),
      turnStart(2),
      userMsg('末轮内容', 200),
    ]
    // The disposed path ingests the last turn (turn 2).
    const finalOutcome = await ingestPreviousTurn(baseDeps({ events, turn: 2, slice: 'last' }))
    expect(finalOutcome.written).toBe(2)
    // The session resumes at turn 3; the normal path's previous turn is turn 2 -> idempotent skip.
    const resumed = [...events, turnStart(3), userMsg('新一轮', 300)]
    const outcome = await ingestPreviousTurn(baseDeps({ events: resumed, turn: 3 }))
    expect(outcome.skipped).toBe('already-ingested')
    expect(outcome.written).toBe(0)
  })
})

describe('ingest throttling', () => {
  it('activityScore four-signal scoring with caps', () => {
    expect(activityScore({ userChars: 0, completedTurns: 0, toolResults: 0, toolNames: new Set() })).toBe(0)
    expect(activityScore({ userChars: 300, completedTurns: 1, toolResults: 10, toolNames: new Set(['a', 'b', 'c']) })).toBe(8)
    // userChars caps at 3 (full at 150 chars), toolResults caps at 2 (full at 10), diversity of 1-2 tools gives 1.
    expect(activityScore({ userChars: 150, completedTurns: 0, toolResults: 10, toolNames: new Set(['a', 'b']) })).toBe(6)
    expect(activityScore({ userChars: 149, completedTurns: 0, toolResults: 4, toolNames: new Set(['a']) })).toBe(3)
  })

  it('isChitchat matches pure greetings only; forbidsCapture matches explicit no-capture', () => {
    expect(isChitchat('你好')).toBe(true)
    expect(isChitchat('Hello!')).toBe(true)
    expect(isChitchat('谢谢，辛苦了')).toBe(false)
    expect(isChitchat('你好，帮我看看这个报错')).toBe(false)
    expect(forbidsCapture('这些是临时调试信息，不要记住这一轮的内容')).toBe(true)
    expect(forbidsCapture("don't save that it is sensitive")).toBe(true)
    expect(forbidsCapture('请记住我的部署端口是 4000')).toBe(false)
  })

  it('throttleDecision: low activity / chitchat / no-capture each hit the right reason; substantive turns pass', () => {
    // Low activity: short message + no tools + no assistant reply.
    const low = [turnStart(1), userMsg('我最喜欢 TypeScript', 2), turnStart(2)]
    expect(throttleDecision(low)).toBe('low-activity')
    // Chitchat: activity score is enough (assistant 1 + 10 tool results 2 + 3 tools 2 = 5), but user text is a pure greeting.
    const greeting = [
      turnStart(1),
      userMsg('你好', 2),
      assistantMsg('你好！有什么可以帮你？', 3),
      toolCall('c1', 'fs_read', 4), toolResult('c1', 5),
      toolCall('c2', 'fs_read', 6), toolResult('c2', 7),
      toolCall('c3', 'web_search', 8), toolResult('c3', 9),
      toolCall('c4', 'shell_run', 10), toolResult('c4', 11),
      toolCall('c5', 'shell_run', 12), toolResult('c5', 13),
      toolCall('c6', 'shell_run', 14), toolResult('c6', 15),
      toolCall('c7', 'web_search', 16), toolResult('c7', 17),
      toolCall('c8', 'fs_read', 18), toolResult('c8', 19),
      toolCall('c9', 'web_search', 20), toolResult('c9', 21),
      toolCall('c10', 'fs_read', 22), toolResult('c10', 23),
      turnStart(2),
    ]
    expect(throttleDecision(greeting)).toBe('chitchat')
    // No-capture: activity score is enough, user explicitly asks not to remember.
    const forbidden = [
      turnStart(1),
      userMsg(`临时调试输出，不要记住这些内容。${PAD}`, 2),
      assistantMsg('好的，已忽略。', 3),
      toolCall('c1', 'fs_read', 4), toolResult('c1', 5),
      toolCall('c2', 'web_search', 6), toolResult('c2', 7),
      turnStart(2),
    ]
    expect(throttleDecision(forbidden)).toBe('capture-forbidden')
    // Substantive turn passes.
    expect(throttleDecision(substantiveTurn1())).toBeNull()
  })

  it('integration: low-activity turn ingest skips, writes nothing, does not call the LLM', async () => {
    let called = 0
    const outcome = await ingestPreviousTurn(baseDeps({
      events: [turnStart(1), userMsg('我最喜欢 TypeScript', 2), turnStart(2), userMsg('现在的问题', 200)],
      call: async () => { called += 1; return VALID_LLM_OUTPUT },
    }))
    expect(outcome.skipped).toBe('low-activity')
    expect(outcome.written).toBe(0)
    expect(called).toBe(0)
    expect(await store.topActive('user', 10)).toHaveLength(0)
  })

  it('activity threshold constant is 5 (protocol-internal value)', () => {
    expect(ACTIVITY_THRESHOLD).toBe(5)
  })

  it('turnSignals counts user chars and tool signals, skipping plugin-injected snapshots', () => {
    const signals = turnSignals(substantiveTurn1())
    expect(signals.completedTurns).toBe(1)
    expect(signals.toolResults).toBe(2)
    expect(signals.toolNames).toEqual(new Set(['fs_read', 'web_search']))
    const withPlugin = turnSignals([pluginMsg('注入快照'.repeat(50), 1), ...substantiveTurn1()])
    expect(withPlugin.userChars).toBe(signals.userChars)
    // Legacy v3 shape kind:'plugin' is also skipped (old log replay compatibility).
    const withLegacyPlugin = turnSignals([pluginMsg('注入快照'.repeat(50), 1, 'plugin'), ...substantiveTurn1()])
    expect(withLegacyPlugin.userChars).toBe(signals.userChars)
  })
})

describe('last turn slice', () => {
  it('lastTurnSlice cuts from the last turn/start to the end of the log', () => {
    const slice = lastTurnSlice([
      turnStart(1),
      userMsg('第一轮', 2),
      turnStart(2),
      userMsg('末轮', 200),
      assistantMsg('末轮回答', 201),
    ])
    expect(slice).toHaveLength(3)
    expect(slice[0]!.type).toBe('turn/start')
    expect(lastTurnSlice([userMsg('无轮次', 1)])).toHaveLength(0)
  })

  it('turnSlice cuts a given turn up to the next turn boundary', () => {
    const events = [
      turnStart(1),
      userMsg('第一轮', 2),
      turnStart(2),
      userMsg('第二轮', 200),
      turnStart(3),
      userMsg('第三轮', 300),
    ]
    expect(turnSlice(events, 2)).toHaveLength(2)
    expect(turnSlice(events, 3)).toHaveLength(2)
    expect(turnSlice(events, 9)).toHaveLength(0)
  })

  it('treats an unavailable (undefined) event source as an empty log, no TypeError', () => {
    // After session dispose the event source is detached and the host may not be able to provide a log:
    // this used to throw a TypeError, which escaped from the fire-and-forget disposed observer
    // as an unhandled rejection and made the host fail-loud exit the process.
    expect(lastTurnSlice(undefined as never)).toHaveLength(0)
    expect(previousTurnSlice(undefined as never)).toHaveLength(0)
    expect(lastTurnNumber(undefined as never)).toBeUndefined()
    expect(turnSlice(undefined as never, 1)).toHaveLength(0)
  })
})

describe('ingestFinalTurn', () => {
  const finalEvents = [
    turnStart(1),
    userMsg('第一轮', 2),
    routeHeader(3),
    turnStart(2),
    userMsg('末轮用户输入', 200),
  ]

  it('ingests the last turn and writes the done key', async () => {
    const outcome = await ingestFinalTurn(baseDeps({ events: finalEvents, turn: 2 }))
    expect(outcome?.written).toBe(2)
    expect(await store.hasAudit(INGEST_DONE_OP, encodeTurnKey('sess-ingest-1', 2))).toBe(true)
  })

  it('on timeout/failure writes the pending key and does not throw', async () => {
    const outcome = await ingestFinalTurn(baseDeps({
      events: finalEvents,
      turn: 2,
      call: ({ signal }) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      }),
      signal: AbortSignal.timeout(50),
    }))
    expect(outcome).toBeNull()
    expect(await store.hasAudit(INGEST_PENDING_OP, encodeTurnKey('sess-ingest-1', 2))).toBe(true)
    // A repeat failure does not write a duplicate pending.
    await markPendingIngest(store, 'sess-ingest-1', 2)
    expect((await store.listAuditDetails(INGEST_PENDING_OP)).length).toBe(1)
  })

  it('no turn/start means no ingest and no pending', async () => {
    const outcome = await ingestFinalTurn(baseDeps({ events: [userMsg('孤儿消息', 1)] }))
    expect(outcome).toBeNull()
    expect((await store.listAuditDetails(INGEST_PENDING_OP)).length).toBe(0)
  })

  it('unavailable (undefined) event source returns null silently: no throw, no pending', async () => {
    // After dispose the event source is detached: neither last-turn content nor turn number can be read,
    // so a pending key cannot be built; just skip. The key contract is "no reject" —
    // an escaped rejection would make the host fail-loud exit the process.
    const outcome = await ingestFinalTurn(baseDeps({ events: undefined as never }))
    expect(outcome).toBeNull()
    expect((await store.listAuditDetails(INGEST_PENDING_OP)).length).toBe(0)
  })
})

describe('ensureSessionSummary', () => {
  const summaryEvents = [
    turnStart(1),
    userMsg('帮我排查部署失败的问题', 2),
    assistantMsg('定位到是环境变量缺失，修复后部署成功', 3),
    routeHeader(4),
  ]

  const summaryDeps = (overrides?: Partial<Parameters<typeof ensureSessionSummary>[0]>) => ({
    events: summaryEvents,
    sessionId: 'sess-ingest-1',
    openStore: async () => store,
    call: async () => '围绕部署排查修复环境变量缺失的一场会话',
    logRequest: (_data: IngestRequestEventData) => undefined,
    mode: 'light' as const,
    routeOverride: undefined,
    signal: new AbortController().signal,
    round: 1,
    ...overrides,
  })

  it('writes the summary to the store, and the request log is attached to the given round', async () => {
    const logged: IngestRequestEventData[] = []
    await ensureSessionSummary(summaryDeps({ logRequest: data => logged.push(data) }))
    expect(await store.getSessionSummary('sess-ingest-1')).toBe('围绕部署排查修复环境变量缺失的一场会话')
    expect(logged).toHaveLength(1)
    expect(logged[0]?.round).toBe(1)
    expect(logged[0]?.maxTokens).toBe(160)
    expect(logged[0]?.mode).toBe('light')
  })

  it('idempotent skip when a summary already exists; no new LLM call', async () => {
    await store.setSessionSummary('sess-ingest-1', '既有摘要')
    let calls = 0
    await ensureSessionSummary(summaryDeps({ call: async () => { calls += 1; return '新摘要' } }))
    expect(calls).toBe(0)
    expect(await store.getSessionSummary('sess-ingest-1')).toBe('既有摘要')
  })

  it('LLM failure is silent: no throw, no summary written', async () => {
    await ensureSessionSummary(summaryDeps({ call: async () => { throw new Error('限流') } }))
    expect(await store.getSessionSummary('sess-ingest-1')).toBeUndefined()
  })

  it('skips when no route is available or there is no dialogue text (only plugin-injected snapshots)', async () => {
    let calls = 0
    const counting = async (): Promise<string> => { calls += 1; return '不应发生' }
    // No routeHeader and no route override: route resolution fails, skip.
    await ensureSessionSummary(summaryDeps({ events: [turnStart(1), userMsg('你好', 2)], call: counting }))
    // Only plugin-injected snapshots: dialogue text is empty, skip.
    await ensureSessionSummary(summaryDeps({ events: [turnStart(1), pluginMsg('系统上下文', 2)], call: counting }))
    expect(calls).toBe(0)
    expect(await store.getSessionSummary('sess-ingest-1')).toBeUndefined()
  })
})

describe('ingestWriteRouting', () => {
  const openProject = async () => store
  const openScope = async () => store

  it('with cwd: default project palace, adopt per-candidate model scope, user lands in the scope-resolved store', async () => {
    const routing = ingestWriteRouting('/repo/x', openProject, openScope)
    expect(routing.writeScope).toBe('project')
    expect(routing.perCandidateScope).toBe(true)
    expect(await routing.resolveStore!('project')).toBe(store)
    expect(await routing.resolveStore!('user')).toBe(store)
  })

  it('without cwd: can only go to the personal palace, per-candidate judging is off (otherwise project-tagged writes in the user store are invisible to search)', () => {
    expect(ingestWriteRouting(undefined, openProject, openScope)).toEqual({ writeScope: 'user', perCandidateScope: false })
    expect(ingestWriteRouting('', openProject, openScope)).toEqual({ writeScope: 'user', perCandidateScope: false })
  })
})

describe('per-candidate palace (write-store routing)', () => {
  it('adopts model scope: project goes to the project store, user to the personal store; idempotency key stays fixed in the audit store', async () => {
    const projectStore = await openEngramStore(join(dir, 'routed-project.db'))
    try {
      const outcome = await ingestPreviousTurn(baseDeps({
        perCandidateScope: true,
        writeScope: 'project',
        resolveStore: async scope => (scope === 'project' ? projectStore : store),
        openAuditStore: async () => store,
        call: async () => JSON.stringify([
          { content: '项目约定：提交信息用中文', kind: 'decision', scope: 'project', importance: 0.7 },
          { content: '用户偏好简体中文回复', kind: 'preference', scope: 'user', importance: 0.8 },
        ]),
      }))
      expect(outcome.written).toBe(2)
      const project = await projectStore.topActive('project', 10)
      expect(project.map(record => record.content)).toEqual(['项目约定：提交信息用中文'])
      expect(project[0]?.scope).toBe('project')
      const personal = await store.topActive('user', 10)
      expect(personal.map(record => record.content)).toContain('用户偏好简体中文回复')
      // The idempotency key is session-level: it lands only in the audit store (here the user store), not the write store.
      expect(await store.hasAudit(INGEST_DONE_OP, encodeTurnKey('sess-ingest-1', 1))).toBe(true)
      expect(await projectStore.hasAudit(INGEST_DONE_OP, encodeTurnKey('sess-ingest-1', 1))).toBe(false)
    } finally {
      await projectStore.close()
    }
  })

  it('falls back to the default scope when the model scope is invalid (shared) or missing', async () => {
    const projectStore = await openEngramStore(join(dir, 'routed-project-2.db'))
    try {
      const outcome = await ingestPreviousTurn(baseDeps({
        perCandidateScope: true,
        writeScope: 'project',
        resolveStore: async () => projectStore,
        call: async () => JSON.stringify([
          { content: '非法 scope 的候选', kind: 'fact', scope: 'shared', importance: 0.5 },
          { content: '缺 scope 的候选', kind: 'fact', importance: 0.5 },
        ]),
      }))
      expect(outcome.written).toBe(2)
      expect(await projectStore.topActive('project', 10)).toHaveLength(2)
    } finally {
      await projectStore.close()
    }
  })

  it('when perCandidateScope is off (legacy history-backfill behavior) the model scope is ignored', async () => {
    const outcome = await ingestPreviousTurn(baseDeps({
      perCandidateScope: false,
      writeScope: 'user',
      call: async () => JSON.stringify([{ content: '模型标了 project 但被忽略', kind: 'fact', scope: 'project' }]),
    }))
    expect(outcome.written).toBe(1)
    expect((await store.topActive('user', 10)).some(record => record.content === '模型标了 project 但被忽略')).toBe(true)
  })
})

describe('replayPendingIngests', () => {
  const replayDeps = (overrides?: Partial<Parameters<typeof replayPendingIngests>[0]>) => ({
    openStore: async () => store,
    resolveSession: async () => undefined,
    resolveStore: async () => store,
    embedder: Promise.resolve(undefined),
    mode: 'light' as const,
    routeOverride: undefined,
    call: async () => VALID_LLM_OUTPUT,
    logRequest: (_data: IngestRequestEventData) => undefined,
    signal: new AbortController().signal,
    ...overrides,
  })

  const pendingEvents = [
    turnStart(1),
    userMsg('旧会话第一轮', 2),
    routeHeader(3),
    turnStart(2),
    userMsg('旧会话末轮输入', 200),
  ]

  it('replay makes up the missing ingest: writes, dequeues pending, and records the done key', async () => {
    await markPendingIngest(store, 'sess-old', 2)
    const outcome = await replayPendingIngests(replayDeps({
      resolveSession: async sessionId => (sessionId === 'sess-old' ? { events: pendingEvents } : undefined),
    }))
    expect(outcome).toEqual({ replayed: 1, kept: 0 })
    expect((await store.listAuditDetails(INGEST_PENDING_OP)).length).toBe(0)
    expect(await store.hasAudit(INGEST_DONE_OP, encodeTurnKey('sess-old', 2))).toBe(true)
    const rows = await store.topActive('user', 10)
    expect(rows.some(record => record.sourceSessionId === 'sess-old' && record.sourceRound === 2)).toBe(true)
    // Replay again: pending has been dequeued, no action.
    expect(await replayPendingIngests(replayDeps())).toEqual({ replayed: 0, kept: 0 })
  })

  it('lands in the project store per the pending session\'s own cwd (replay also does per-candidate palace)', async () => {
    const projectStore = await openEngramStore(join(dir, 'replay-project.db'))
    try {
      await markPendingIngest(store, 'sess-proj', 2)
      const outcome = await replayPendingIngests(replayDeps({
        resolveSession: async sessionId => (sessionId === 'sess-proj' ? { events: pendingEvents, cwd: '/repo/x' } : undefined),
        resolveStore: async () => projectStore,
      }))
      expect(outcome).toEqual({ replayed: 1, kept: 0 })
      // The idempotency key stays in the audit store (user store); the memory lands in that project store.
      expect(await store.hasAudit(INGEST_DONE_OP, encodeTurnKey('sess-proj', 2))).toBe(true)
      expect(await projectStore.hasAudit(INGEST_DONE_OP, encodeTurnKey('sess-proj', 2))).toBe(false)
      const rows = await projectStore.topActive('project', 10)
      expect(rows.some(record => record.sourceSessionId === 'sess-proj' && record.sourceRound === 2)).toBe(true)
    } finally {
      await projectStore.close()
    }
  })

  it('a pending whose event source is unavailable is kept for next time', async () => {
    await markPendingIngest(store, 'sess-gone', 3)
    const outcome = await replayPendingIngests(replayDeps())
    expect(outcome).toEqual({ replayed: 0, kept: 1 })
    expect((await store.listAuditDetails(INGEST_PENDING_OP)).length).toBe(1)
  })

  it('a pending that already has a done marker or has a corrupt key is dequeued directly', async () => {
    await markPendingIngest(store, 'sess-done', 1)
    await store.audit(INGEST_DONE_OP, 'sess-done', encodeTurnKey('sess-done', 1))
    await store.audit(INGEST_PENDING_OP, 'BROKEN', '没有分隔符的坏键')
    const outcome = await replayPendingIngests(replayDeps())
    expect(outcome).toEqual({ replayed: 0, kept: 0 })
    expect((await store.listAuditDetails(INGEST_PENDING_OP)).length).toBe(0)
  })
})

describe('ingest write four-state', () => {
  /** Fixed-vector pseudo embedder: registered texts get vectors from the table; unregistered texts get orthogonal one-hot vectors (starting at dimension 2; 0/1 are reserved for explicit registrations). */
  const fixedEmbedder = (table: Record<string, readonly number[]>) => {
    const dims = new Map<string, number>()
    let next = 2
    return {
      model: 'pseudo',
      embed: async (texts: readonly string[]) => texts.map(text => {
        const vector = new Float32Array(512)
        const pinned = table[text]
        if (pinned !== undefined) {
          pinned.forEach((value, index) => { vector[index] = value })
          return vector
        }
        let dim = dims.get(text)
        if (dim === undefined) { dim = next; next += 1; dims.set(text, dim) }
        vector[dim] = 1
        return vector
      }),
      close: async () => undefined,
    }
  }
  /** Helper to build a [1,0,...] vector. */
  const unitVec = (coords: readonly number[]): Float32Array => {
    const vector = new Float32Array(512)
    coords.forEach((value, index) => { vector[index] = value })
    return vector
  }

  it('restatement candidate MERGE: folded into and reinforces the existing entry, no new entry, not counted as written', async () => {
    const existing = await store.write({ scope: 'user', kind: 'preference', content: '既有偏好条目', embedding: unitVec([1, 0]) })
    const outcome = await ingestPreviousTurn(baseDeps({
      embedder: Promise.resolve(fixedEmbedder({ '用户最喜欢的编程语言是 TypeScript': [1, 0] })),
      call: async () => JSON.stringify([{ content: '用户最喜欢的编程语言是 TypeScript', kind: 'preference', importance: 0.8 }]),
    }))
    expect(outcome.merged).toBe(1)
    expect(outcome.written).toBe(0)
    expect((await store.stats()).total).toBe(1)
    const reinforced = await store.get(existing.id)
    expect(reinforced?.confidence).toBeCloseTo(0.55, 5)
    expect(reinforced?.accessCount).toBe(1)
    const ops = await store.recentOps(10)
    expect(ops.some(op => op.op === 'write-merge' && op.targetId === existing.id)).toBe(true)
  })

  it('defer-band candidate lands in the store and builds a contradicts edge (counted in written and deferred)', async () => {
    const existing = await store.write({ scope: 'user', kind: 'fact', content: '项目包管理器是 pnpm 9', embedding: unitVec([1, 0]) })
    const outcome = await ingestPreviousTurn(baseDeps({
      embedder: Promise.resolve(fixedEmbedder({ '项目包管理器升级到 pnpm 10': [0.9, Math.sqrt(0.19)] })),
      call: async () => JSON.stringify([{ content: '项目包管理器升级到 pnpm 10', kind: 'fact' }]),
    }))
    expect(outcome.written).toBe(1)
    expect(outcome.deferred).toBe(1)
    const edges = (await store.exportAll()).edges
    expect(edges.some(edge => edge.type === 'contradicts' && edge.to === existing.id)).toBe(true)
  })

  it('duplicate candidate in the same batch DROP is counted as dropped; when embedding is unavailable all are ACCEPT', async () => {
    const dup = await ingestPreviousTurn(baseDeps({
      call: async () => JSON.stringify([
        { content: '重复的事实条目', kind: 'fact' },
        { content: '重复的事实条目', kind: 'fact' },
      ]),
    }))
    expect(dup.written).toBe(1)
    expect(dup.dropped).toBe(1)
    expect(dup.merged).toBe(0)
  })

  it('merge path with entities: entities attach to the reinforced existing entry, no new memory is created', async () => {
    const existing = await store.write({ scope: 'user', kind: 'preference', content: '既有偏好条目', embedding: unitVec([1, 0]) })
    const outcome = await ingestPreviousTurn(baseDeps({
      embedder: Promise.resolve(fixedEmbedder({ '用户最喜欢的编程语言是 TypeScript': [1, 0] })),
      call: async () => JSON.stringify([
        { content: '用户最喜欢的编程语言是 TypeScript', kind: 'preference', importance: 0.8,
          entities: [{ name: 'TypeScript', kind: 'tool' }] },
      ]),
    }))
    expect(outcome.merged).toBe(1)
    expect((await store.stats()).total).toBe(1)
    const linked = (await store.entitiesOfNodes([existing.id])).get(existing.id) ?? []
    expect(linked.map(entity => entity.name)).toEqual(['TypeScript'])
  })
})

describe('parseEntityMentions (model-output boundary validation)', () => {
  it('valid mentions are kept: name trimmed, non-string and empty aliases filtered out', () => {
    expect(parseEntityMentions([
      { name: '  DeepSeek Harness  ', kind: 'project', aliases: ['DSH', '', 42, '   '] },
      { name: 'ken', kind: 'person' },
    ])).toEqual([
      { name: 'DeepSeek Harness', kind: 'project', aliases: ['DSH'] },
      { name: 'ken', kind: 'person' },
    ])
  })

  it('invalid entries are all dropped: non-array, non-object, missing name, empty name, name too long; invalid kind falls back to other', () => {
    expect(parseEntityMentions('不是数组')).toEqual([])
    expect(parseEntityMentions([null, 42, '字符串', { noName: true }])).toEqual([])
    expect(parseEntityMentions([{ name: 42 }, { name: '   ' }, { name: 'x'.repeat(81) }])).toEqual([])
    expect(parseEntityMentions([{ name: '某物', kind: 'creature' }])).toEqual([{ name: '某物', kind: 'other' }])
  })
})

describe('ingest pipeline entity linking (schema v10)', () => {
  it('accept path: candidate entities are resolved into the dictionary and linked to the new memory', async () => {
    const outcome = await ingestPreviousTurn(baseDeps({
      call: async () => JSON.stringify([
        { content: '用户在开发 dsh-engram 记忆插件', kind: 'fact', importance: 0.7,
          entities: [{ name: 'ken', kind: 'person', aliases: ['阿肯'] }, { name: 'dsh-engram', kind: 'project' }] },
      ]),
    }))
    expect(outcome.written).toBe(1)
    // Two entities land in the dictionary.
    expect((await store.listEntities({ limit: 10, offset: 0 })).total).toBe(2)
    // Reverse link lookup hits two.
    const record = (await store.topActive('user', 10))[0]!
    const linked = (await store.entitiesOfNodes([record.id])).get(record.id) ?? []
    expect(linked.map(entity => entity.name).sort()).toEqual(['dsh-engram', 'ken'])
  })

  it('when a candidate has no entities field, nothing is written to the dictionary', async () => {
    await ingestPreviousTurn(baseDeps())
    expect((await store.listEntities({ limit: 10, offset: 0 })).total).toBe(0)
    expect((await store.topActive('user', 10)).length).toBe(2)
  })

  it('entity-resolution failure is silent: the memory still lands in the store, ingest is not blocked', async () => {
    // Dictionary-layer failure (e.g. disk corruption): the resolution error is swallowed, candidate disposition is unaffected.
    const failing: EngramStore = {
      ...store,
      resolveEntities: async () => { throw new Error('实体词典故障') },
    }
    const outcome = await ingestPreviousTurn(baseDeps({
      openStore: async () => failing,
      call: async () => JSON.stringify([
        { content: '词典故障也照常落库的记忆', kind: 'fact',
          entities: [{ name: 'ken', kind: 'person' }] },
      ]),
    }))
    expect(outcome.written).toBe(1)
    expect((await store.topActive('user', 10)).some(record => record.content === '词典故障也照常落库的记忆')).toBe(true)
    expect((await store.listEntities({ limit: 10, offset: 0 })).total).toBe(0)
  })
})

describe('parseFactMentions (model-output boundary validation)', () => {
  it('valid mentions are kept: entity and content trimmed', () => {
    expect(parseFactMentions([
      { entity: '  ken  ', content: '  ken 用 vim 编辑  ' },
      { entity: 'dsh-engram', content: '存储引擎是 SQLite' },
    ])).toEqual([
      { entity: 'ken', content: 'ken 用 vim 编辑' },
      { entity: 'dsh-engram', content: '存储引擎是 SQLite' },
    ])
  })

  it('invalid entries are all dropped: non-array, non-object, missing entity/content, empty values, too long', () => {
    expect(parseFactMentions('不是数组')).toEqual([])
    expect(parseFactMentions([null, 42, '字符串', { entity: 'ken' }, { content: 'x' }])).toEqual([])
    expect(parseFactMentions([
      { entity: '   ', content: '事实内容' },
      { entity: 'ken', content: '   ' },
      { entity: 'x'.repeat(81), content: '事实内容' },
      { entity: 'ken', content: 'x'.repeat(501) },
    ])).toEqual([])
  })
})

describe('ingest pipeline fact extraction (schema v11)', () => {
  it('accept path: candidate facts are written to the fact table with a source memory, matched by normalized entity name', async () => {
    const outcome = await ingestPreviousTurn(baseDeps({
      call: async () => JSON.stringify([
        { content: '用户把 dsh-engram 的存储迁到了 SQLite', kind: 'fact', importance: 0.7,
          entities: [{ name: 'dsh-engram', kind: 'project' }],
          facts: [{ entity: 'dsh-engram', content: 'dsh-engram 的存储引擎是 SQLite' }] },
      ]),
    }))
    expect(outcome.written).toBe(1)
    const [entity] = (await store.listEntities({ q: 'dsh-engram', limit: 10, offset: 0 })).items
    const { items: facts } = await store.factsOfEntity({ entityId: entity!.entity.id, limit: 10, offset: 0 })
    expect(facts.map(fact => fact.content)).toEqual(['dsh-engram 的存储引擎是 SQLite'])
    // The source memory points back to the candidate entry that extracted this fact.
    const record = (await store.topActive('user', 10))[0]!
    expect(facts[0]?.sourceNodeId).toBe(record.id)
  })

  it('a facts.entity that does not match any entity in the batch drops the whole entry', async () => {
    await ingestPreviousTurn(baseDeps({
      call: async () => JSON.stringify([
        { content: '候选带一条孤儿事实', kind: 'fact',
          entities: [{ name: 'ken', kind: 'person' }],
          facts: [
            { entity: 'ghost', content: '幽灵事实：没有对应实体' },
            { entity: 'ken', content: 'ken 的事实：正常落表' },
          ] },
      ]),
    }))
    // The orphan fact is not written to the table, and the ghost entity does not enter the dictionary.
    expect((await store.listEntities({ limit: 10, offset: 0 })).total).toBe(1)
    const [entity] = (await store.listEntities({ q: 'ken', limit: 10, offset: 0 })).items
    const { items: facts } = await store.factsOfEntity({ entityId: entity!.entity.id, limit: 10, offset: 0 })
    expect(facts.map(fact => fact.content)).toEqual(['ken 的事实：正常落表'])
  })

  it('fact-write failure is silent: the memory still lands in the store, ingest is not blocked', async () => {
    // Fact-table failure (e.g. disk corruption): same discipline as entity resolution, only the enrichment data is skipped.
    const failing: EngramStore = {
      ...store,
      writeFacts: async () => { throw new Error('事实表故障') },
    }
    const outcome = await ingestPreviousTurn(baseDeps({
      openStore: async () => failing,
      call: async () => JSON.stringify([
        { content: '事实表故障也照常落库的记忆', kind: 'fact',
          entities: [{ name: 'ken', kind: 'person' }],
          facts: [{ entity: 'ken', content: '这条事实写不进去' }] },
      ]),
    }))
    expect(outcome.written).toBe(1)
    expect((await store.topActive('user', 10)).some(record => record.content === '事实表故障也照常落库的记忆')).toBe(true)
    // The entity is in the dictionary and the link is built; only the fact write is swallowed.
    const [entity] = (await store.listEntities({ q: 'ken', limit: 10, offset: 0 })).items
    const { total } = await store.factsOfEntity({ entityId: entity!.entity.id, limit: 10, offset: 0 })
    expect(total).toBe(0)
  })
})
