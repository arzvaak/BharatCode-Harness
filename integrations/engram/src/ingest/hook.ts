









import type { LlmRoute, SessionEventLike } from '../llm/client.ts'
import { parseJsonArray, routeFromEvents } from '../llm/client.ts'
import type { EngramEmbedder } from '../embedder/interface.ts'
import type { EngramStore } from '../store/interface.ts'
import type { EngramEntityKind, EngramKind, EngramScope, EntityMention, FactMention, FactWriteInput, MemoryId } from '../types.ts'
import { normalizeEntityName } from '../types.ts'
import { sanitizeProtocolText } from '../security/sanitize.ts'
import { redactSecrets } from '../security/redact.ts'
import { hasRecallToolCalls, omitRecallToolResults } from '../security/recall.ts'
import { applyMerge, confirmContradictions, decideWrite } from '../write-disposition.ts'
import type { MemoryJudge } from '../write-disposition.ts'


export type IngestMode = 'off' | 'light' | 'eager'


const MODE_LIMITS: Readonly<Record<Exclude<IngestMode, 'off'>, { maxCandidates: number; confidence: number; includeAssistant: boolean }>> = {
  light: { maxCandidates: 2, confidence: 0.3, includeAssistant: false },
  eager: { maxCandidates: 5, confidence: 0.4, includeAssistant: true },
}


const INGEST_MAX_TOKENS = 600


export const INGEST_DONE_OP = 'ingest-done'

export const INGEST_PENDING_OP = 'ingest-pending'

export const FINAL_INGEST_TIMEOUT_MS = 5000


export function encodeTurnKey(sessionId: string, turn: number): string {
  return `${sessionId}#${turn}`
}


export function decodeTurnKey(detail: string): { sessionId: string; turn: number } | undefined {
  const sep = detail.lastIndexOf('#')
  if (sep <= 0) return undefined
  const turn = Number(detail.slice(sep + 1))
  if (!Number.isInteger(turn) || turn < 0) return undefined
  return { sessionId: detail.slice(0, sep), turn }
}

const INGEST_SYSTEM = [
  'Extract reusable user information worth remembering across sessions: facts, preferences, decisions, experiences, and methods.',
  'Output only a JSON array. Each item has {"content":"one complete sentence","kind":"fact|preference|decision|episode|skill","scope":"project|user","importance":0.5,"entities":[{"name":"entity name","kind":"person|project|tool|concept|other","aliases":["alias"]}],"facts":[{"entity":"entity name","content":"one objective fact"}]}. Importance must be a decimal from 0 to 1.',
  'Entities are specific people, projects, tools, or concepts in the memory. Use short proper names (at most 20 characters). Omit entities or aliases when absent.',
  'Facts describe objective state, ownership, relationships, or data. Each entity must appear in this memory entities list. Use one fact per item; omit facts when absent.',
  'Use project scope for project-specific choices, conventions, architecture, and facts. Use user scope for personal preferences, habits, experiences, and reusable cross-project facts. When uncertain, use project.',
  'Extract only explicit reusable information. Exclude greetings, temporary context, and your own answers. Return [] if there is nothing to remember.',
  'Output no text outside the JSON array.',
].join('\n')


const ENTITY_KINDS: readonly EngramEntityKind[] = ['person', 'project', 'tool', 'concept', 'other']

const ENTITY_NAME_MAX = 80

const FACT_CONTENT_MAX = 500





export function parseEntityMentions(raw: unknown): EntityMention[] {
  if (!Array.isArray(raw)) return []
  const mentions: EntityMention[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { name?: unknown; kind?: unknown; aliases?: unknown }
    if (typeof record.name !== 'string') continue
    const name = record.name.trim()
    if (name === '' || name.length > ENTITY_NAME_MAX) continue
    const kind = ENTITY_KINDS.includes(record.kind as EngramEntityKind) ? record.kind as EngramEntityKind : 'other'
    const aliases = Array.isArray(record.aliases)
      ? record.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '' && a.trim().length <= ENTITY_NAME_MAX)
      : []
    mentions.push({
      name,
      kind,
      ...(aliases.length === 0 ? {} : { aliases }),
    })
  }
  return mentions
}






export function parseFactMentions(raw: unknown): FactMention[] {
  if (!Array.isArray(raw)) return []
  const mentions: FactMention[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { entity?: unknown; content?: unknown }
    if (typeof record.entity !== 'string' || typeof record.content !== 'string') continue
    const entity = record.entity.trim()
    const content = record.content.trim()
    if (entity === '' || entity.length > ENTITY_NAME_MAX) continue
    if (content === '' || content.length > FACT_CONTENT_MAX) continue
    mentions.push({ entity, content })
  }
  return mentions
}


export interface IngestRequestEventData {
  
  readonly route: LlmRoute
  
  readonly round: number
  
  readonly userText: string
  
  readonly maxTokens: number
  
  readonly mode: Exclude<IngestMode, 'off'>
}


export interface IngestOutcome {
  
  readonly scannedEvents: number
  
  readonly candidates: number
  
  readonly written: number
  
  readonly merged: number
  
  readonly deferred: number
  
  readonly dropped: number
  
  readonly skipped: string | null
}


export interface IngestDeps {
  
  readonly events: readonly SessionEventLike[]
  
  readonly sessionId: string
  
  readonly turn: number
  
  readonly openStore: () => Promise<EngramStore>
  
  readonly embedder: Promise<EngramEmbedder | undefined>
  
  readonly mode: Exclude<IngestMode, 'off'>
  
  readonly routeOverride: LlmRoute | undefined
  
  readonly call: (params: { route: LlmRoute; system: string; userText: string; maxTokens: number; purpose: string; signal: AbortSignal }) => Promise<string>
  
  readonly logRequest: (data: IngestRequestEventData) => void
  
  readonly signal: AbortSignal
  
  readonly slice?: IngestSlice
  
  readonly throttle?: boolean
  
  readonly writeScope?: EngramScope
  
  readonly perCandidateScope?: boolean
  
  readonly resolveStore?: (scope: EngramScope) => Promise<EngramStore>
  
  readonly openAuditStore?: () => Promise<EngramStore>
  
  readonly history?: boolean
  
  readonly judge?: MemoryJudge
}


export interface IngestWriteRouting {
  
  readonly writeScope: EngramScope
  
  readonly perCandidateScope: boolean
  
  readonly resolveStore?: (scope: EngramScope) => Promise<EngramStore>
}










export function ingestWriteRouting(
  cwd: string | undefined,
  openProjectStore: (cwd: string) => Promise<EngramStore>,
  openScopeStore: (scope: EngramScope) => Promise<EngramStore>,
): IngestWriteRouting {
  if (cwd === undefined || cwd === '') return { writeScope: 'user', perCandidateScope: false }
  return {
    writeScope: 'project',
    perCandidateScope: true,
    resolveStore: scope => (scope === 'project' ? openProjectStore(cwd) : openScopeStore(scope)),
  }
}


function collectTexts(events: readonly SessionEventLike[], includeAssistant: boolean): { texts: string[]; minSeq: number | null } {
  const texts: string[] = []
  let minSeq: number | null = null
  for (const event of events) {
    if (event.type === 'user/message') {
      const data = event.data as { source?: { kind?: unknown }; content?: { type?: unknown; text?: unknown }[] } | null

      if (typeof data?.source?.kind === 'string' && data.source.kind.startsWith('plugin')) continue
      const segments = (data?.content ?? [])
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
      if (segments.length > 0) {
        texts.push(...segments)
        if (event.seq !== undefined && (minSeq === null || event.seq < minSeq)) minSeq = event.seq
      }
    } else if (includeAssistant && event.type === 'assistant/message') {
      const data = event.data as { content?: { type?: unknown; text?: unknown }[] } | null
      const segments = (data?.content ?? [])
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
      if (segments.length > 0) texts.push(...segments)
    }
  }
  return { texts, minSeq }
}


export type IngestSlice = 'previous' | 'last' | number


export const ACTIVITY_THRESHOLD = 5


const CHITCHAT_RE = /^(?:你好|您好|嗨|哈喽|hello|hi|hey|谢谢|感谢|ok|okay|好的|在吗|收到|辛苦了)[!！,.，。?？~\s]*$/iu


const NO_CAPTURE_RE = /(?:不要|别|不用|无需)(?:把这?[个件些条]?|把上一?轮|把刚才)?(?:记|存)(?:住|录|下来|进去|到记忆|进记忆)|don'?t\s+(?:remember|record|save)\s+(?:this|that|it)/i


export interface TurnSignals {
  
  readonly userChars: number
  
  readonly completedTurns: number
  
  readonly toolResults: number
  
  readonly toolNames: ReadonlySet<string>
}


function toolDiversity(distinct: number): number {
  return distinct === 0 ? 0 : distinct <= 2 ? 1 : 2
}







export function activityScore(signals: TurnSignals): number {
  return Math.min(Math.floor(signals.userChars / 50), 3)
    + signals.completedTurns
    + Math.min(Math.floor(signals.toolResults / 5), 2)
    + toolDiversity(signals.toolNames.size)
}


export function isChitchat(text: string): boolean {
  return CHITCHAT_RE.test(text.trim())
}


export function forbidsCapture(text: string): boolean {
  return NO_CAPTURE_RE.test(text)
}


export function turnSignals(events: readonly SessionEventLike[]): TurnSignals {
  let userChars = 0
  let completedTurns = 0
  let toolResults = 0
  const toolNames = new Set<string>()
  for (const event of events) {
    if (event.type === 'user/message') {
      const data = event.data as { source?: { kind?: unknown }; content?: { type?: unknown; text?: unknown }[] } | null
      if (typeof data?.source?.kind === 'string' && data.source.kind.startsWith('plugin')) continue
      for (const block of data?.content ?? []) {
        if (block?.type === 'text' && typeof block.text === 'string') userChars += block.text.length
      }
    } else if (event.type === 'assistant/message') {
      const data = event.data as { content?: { type?: unknown; text?: unknown }[] } | null
      if ((data?.content ?? []).some(block => block?.type === 'text' && typeof block.text === 'string' && block.text !== '')) {
        completedTurns = 1
      }
    } else if (event.type === 'tool/result') {
      toolResults += 1
    } else if (event.type === 'tool/call') {
      const name = (event.data as { name?: unknown } | null)?.name
      if (typeof name === 'string') toolNames.add(name)
    }
  }
  return { userChars, completedTurns, toolResults, toolNames }
}





export function throttleDecision(events: readonly SessionEventLike[]): string | null {
  const signals = turnSignals(events)
  if (activityScore(signals) < ACTIVITY_THRESHOLD) return 'low-activity'
  const texts = collectTexts(events, false).texts
  const joined = texts.join(' ')
  if (joined !== '' && isChitchat(joined)) return 'chitchat'
  if (forbidsCapture(joined)) return 'capture-forbidden'
  return null
}




function turnStarts(events: readonly SessionEventLike[] | undefined): { index: number; turn: number | undefined }[] {
  if (events === undefined) return []
  const starts: { index: number; turn: number | undefined }[] = []
  for (let i = 0; i < events.length; i++) {
    if (events[i]?.type !== 'turn/start') continue
    const turn = (events[i]!.data as { turn?: unknown } | null)?.turn
    starts.push({ index: i, turn: typeof turn === 'number' ? turn : undefined })
  }
  return starts
}


export function previousTurnSlice(events: readonly SessionEventLike[]): readonly SessionEventLike[] {
  const starts = turnStarts(events)
  if (starts.length < 2) return []
  return events.slice(starts[starts.length - 2]!.index, starts[starts.length - 1]!.index)
}


export function lastTurnSlice(events: readonly SessionEventLike[]): readonly SessionEventLike[] {
  const starts = turnStarts(events)
  if (starts.length === 0) return []
  return events.slice(starts[starts.length - 1]!.index)
}


export function lastTurnNumber(events: readonly SessionEventLike[]): number | undefined {
  const starts = turnStarts(events)
  return starts.length === 0 ? undefined : starts[starts.length - 1]!.turn
}


export function turnSlice(events: readonly SessionEventLike[], turn: number): readonly SessionEventLike[] {
  const starts = turnStarts(events)
  const position = starts.findIndex(start => start.turn === turn)
  if (position === -1) return []
  const end = position + 1 < starts.length ? starts[position + 1]!.index : events.length
  return events.slice(starts[position]!.index, end)
}






export async function ingestPreviousTurn(deps: IngestDeps): Promise<IngestOutcome> {
  const limits = MODE_LIMITS[deps.mode]
  const sliceMode = deps.slice ?? 'previous'
  let slice: readonly SessionEventLike[]
  let round: number
  if (sliceMode === 'previous') {
    slice = previousTurnSlice(deps.events)
    round = Math.max(0, deps.turn - 1)
  } else if (sliceMode === 'last') {
    slice = lastTurnSlice(deps.events)
    round = lastTurnNumber(deps.events) ?? deps.turn
  } else {
    slice = turnSlice(deps.events, sliceMode)
    round = sliceMode
  }
  if (slice.length === 0) {
    return { scannedEvents: 0, candidates: 0, written: 0, merged: 0, deferred: 0, dropped: 0, skipped: typeof sliceMode === 'number' ? 'no-such-turn' : 'no-previous-turn' }
  }

  const store = await deps.openStore()

  const auditStore = deps.openAuditStore === undefined ? store : await deps.openAuditStore()
  const doneKey = encodeTurnKey(deps.sessionId, round)
  if (await auditStore.hasAudit(INGEST_DONE_OP, doneKey)) {
    return { scannedEvents: slice.length, candidates: 0, written: 0, merged: 0, deferred: 0, dropped: 0, skipped: 'already-ingested' }
  }

  if (sliceMode === 'previous' || deps.throttle === true) {
    const throttled = throttleDecision(slice)
    if (throttled !== null) {
      return { scannedEvents: slice.length, candidates: 0, written: 0, merged: 0, deferred: 0, dropped: 0, skipped: throttled }
    }
  }

  const scoped = omitRecallToolResults(slice)
  const { texts, minSeq } = collectTexts(scoped, limits.includeAssistant)

  const cleaned = texts.map(text => redactSecrets(sanitizeProtocolText(text)))
  if (cleaned.every(text => text === '')) {
    return { scannedEvents: slice.length, candidates: 0, written: 0, merged: 0, deferred: 0, dropped: 0, skipped: 'no-user-content' }
  }

  const route = deps.routeOverride ?? routeFromEvents(deps.events)
  if (route === undefined) return { scannedEvents: slice.length, candidates: 0, written: 0, merged: 0, deferred: 0, dropped: 0, skipped: 'no-route-in-log' }

  const recallNote = hasRecallToolCalls(scoped)
    ? '(The previous turn called memory recall tools such as engram_search. Their results were omitted. Existing memories repeated by the assistant are not new information and must not be extracted.)'
    : ''
  const userText = `Extract information worth remembering from this conversation turn (JSON array):\n${JSON.stringify(cleaned)}${recallNote === '' ? '' : `\n${recallNote}`}`
  deps.logRequest({ route, round, userText, maxTokens: INGEST_MAX_TOKENS, mode: deps.mode })
  const raw = await deps.call({
    route,
    system: INGEST_SYSTEM,
    userText,
    maxTokens: INGEST_MAX_TOKENS,
    purpose: 'engram-ingest',
    signal: deps.signal,
  })
  const parsed = parseJsonArray(raw)
  if (parsed === undefined) return { scannedEvents: slice.length, candidates: 0, written: 0, merged: 0, deferred: 0, dropped: 0, skipped: 'unparseable-output' }

  const embedder = await deps.embedder
  const writtenContents: string[] = []
  let written = 0
  let merged = 0
  let deferred = 0
  let dropped = 0
  for (const item of parsed.slice(0, limits.maxCandidates)) {
    const candidate = item as { content?: unknown; kind?: unknown; scope?: unknown; importance?: unknown; entities?: unknown; facts?: unknown }
    if (typeof candidate.content !== 'string' || candidate.content.trim() === '') { dropped += 1; continue }

    const content = redactSecrets(sanitizeProtocolText(candidate.content.trim()))
    if (content === '') { dropped += 1; continue }
    const kind = (typeof candidate.kind === 'string' && ['fact', 'preference', 'decision', 'episode', 'skill'].includes(candidate.kind))
      ? candidate.kind as EngramKind
      : 'fact'

    const modelScope = candidate.scope === 'user' || candidate.scope === 'project' ? candidate.scope : undefined
    const scope: EngramScope = deps.perCandidateScope === true && modelScope !== undefined
      ? modelScope
      : deps.writeScope ?? 'user'
    const target = deps.resolveStore === undefined ? store : await deps.resolveStore(scope)
    const importance = typeof candidate.importance === 'number' && Number.isFinite(candidate.importance)
      ? Math.min(1, Math.max(0, candidate.importance))
      : 0.5



    const linkEntities = async (nodeId: MemoryId): Promise<void> => {
      const mentions = parseEntityMentions(candidate.entities)
      if (mentions.length === 0) return
      try {
        const entities = await target.resolveEntities(mentions)
        await target.linkNodeEntities(nodeId, entities.map(entity => entity.id))
        const factInputs: FactWriteInput[] = []
        const byName = new Map(entities.map(entity => [normalizeEntityName(entity.name), entity]))
        for (const mention of parseFactMentions(candidate.facts)) {
          const entity = byName.get(normalizeEntityName(mention.entity))
          if (entity === undefined) continue
          factInputs.push({ entityId: entity.id, content: mention.content, sourceNodeId: nodeId })
        }
        if (factInputs.length > 0) await target.writeFacts(factInputs)
      } catch {

      }
    }

    if (writtenContents.includes(content)) { dropped += 1; continue }


    const vector = embedder === undefined ? undefined : (await embedder.embed([content]))[0]

    const decision = await decideWrite(target, kind, vector, deps.judge === undefined ? {} : { judge: deps.judge, content })
    if (decision.disposition === 'merge') {
      await applyMerge(target, decision, content)
      await linkEntities(decision.into.id)
      writtenContents.push(content)
      merged += 1
      continue
    }
    const record = await target.write({
      scope,
      kind,
      content,
      importance,
      confidence: limits.confidence,
      sourceSessionId: deps.sessionId,
      sourceRound: round,
      ...(minSeq === null ? {} : { sourceSeq: minSeq }),
      ...(vector === undefined ? {} : { embedding: vector }),
      ...(deps.history === true ? { initialReviewAt: null } : {}),
    })
    if (decision.disposition === 'defer') {

      const neighbors = deps.judge === undefined
        ? [decision.neighbor]
        : (await confirmContradictions(deps.judge, content, [decision.neighbor])) ?? [decision.neighbor]
      for (const neighbor of neighbors) {
        await target.linkEdge(record.id, neighbor.id, 'contradicts')
      }
      deferred += 1
    }
    await linkEntities(record.id)
    writtenContents.push(content)
    written += 1
  }
  await auditStore.audit(INGEST_DONE_OP, deps.sessionId, doneKey)
  return { scannedEvents: slice.length, candidates: parsed.length, written, merged, deferred, dropped, skipped: null }
}




export async function markPendingIngest(store: EngramStore, sessionId: string, turn: number): Promise<void> {
  const key = encodeTurnKey(sessionId, turn)
  if (await store.hasAudit(INGEST_DONE_OP, key)) return
  if (await store.hasAudit(INGEST_PENDING_OP, key)) return
  await store.audit(INGEST_PENDING_OP, sessionId, key)
}









export async function ingestFinalTurn(deps: IngestDeps): Promise<IngestOutcome | null> {
  
  let round: number | undefined
  try {
    round = lastTurnNumber(deps.events)
    if (round === undefined) return null
    return await ingestPreviousTurn({ ...deps, slice: 'last' })
  } catch (error) {
    if (round !== undefined) {
      try {
        await markPendingIngest(await (deps.openAuditStore ?? deps.openStore)(), deps.sessionId, round)
      } catch {

      }
    }
    console.warn('[dsh-engram] Final-turn ingestion failed (queued for retry; conversation unaffected):', error)
    return null
  }
}


const SESSION_SUMMARY_SYSTEM = [
  'Summarize the main task and outcome of this session in one sentence (at most 60 words).',
  'Output only the summary without a prefix, quotation marks, or explanation.',
].join('\n')

const SESSION_SUMMARY_MAX_TOKENS = 160

const SESSION_SUMMARY_TEXT_LIMIT = 4000


function collectSessionText(events: readonly SessionEventLike[]): string {
  const texts: string[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      const data = event.data as { source?: { kind?: unknown }; content?: { type?: unknown; text?: unknown }[] } | null
      if (typeof data?.source?.kind === 'string' && data.source.kind.startsWith('plugin')) continue
      const segments = (data?.content ?? [])
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
      if (segments.length > 0) texts.push(...segments)
    } else if (event.type === 'assistant/message') {
      const data = event.data as { content?: { type?: unknown; text?: unknown }[] } | null
      const segments = (data?.content ?? [])
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
      if (segments.length > 0) texts.push(...segments)
    }
  }
  const cleaned = texts.map(text => redactSecrets(sanitizeProtocolText(text))).filter(text => text !== '')
  const joined = cleaned.join('\n')
  return joined.length > SESSION_SUMMARY_TEXT_LIMIT ? `${joined.slice(0, SESSION_SUMMARY_TEXT_LIMIT)}…` : joined
}


export interface SessionSummaryDeps {
  
  readonly events: readonly SessionEventLike[]
  
  readonly sessionId: string
  
  readonly openStore: () => Promise<EngramStore>
  
  readonly call: IngestDeps['call']
  
  readonly logRequest: IngestDeps['logRequest']
  
  readonly mode: Exclude<IngestMode, 'off'>
  
  readonly routeOverride: LlmRoute | undefined
  
  readonly signal: AbortSignal
  
  readonly round: number | undefined
}







export async function ensureSessionSummary(deps: SessionSummaryDeps): Promise<void> {
  if (deps.signal.aborted) return
  const route = deps.routeOverride ?? routeFromEvents(deps.events)
  if (route === undefined) return
  const dialog = collectSessionText(deps.events)
  if (dialog === '') return
  const store = await deps.openStore()
  if (await store.getSessionSummary(deps.sessionId) !== undefined) return
  const userText = `Summarize this session:\n${dialog}`
  deps.logRequest({ route, round: deps.round ?? 0, userText, maxTokens: SESSION_SUMMARY_MAX_TOKENS, mode: deps.mode })
  try {
    const raw = await deps.call({
      route,
      system: SESSION_SUMMARY_SYSTEM,
      userText,
      maxTokens: SESSION_SUMMARY_MAX_TOKENS,
      purpose: 'engram-session-summary',
      signal: deps.signal,
    })
    const summary = raw.trim()
    if (summary === '') return
    await store.setSessionSummary(deps.sessionId, summary)
  } catch {

  }
}


export interface ReplayIngestDeps {
  
  readonly openStore: () => Promise<EngramStore>
  



  readonly resolveSession: (sessionId: string) => Promise<{ events: readonly SessionEventLike[]; cwd?: string | undefined } | undefined>
  
  readonly resolveStore: (cwd: string) => Promise<EngramStore>
  
  readonly embedder: Promise<EngramEmbedder | undefined>
  
  readonly mode: Exclude<IngestMode, 'off'>
  
  readonly routeOverride: LlmRoute | undefined
  
  readonly call: IngestDeps['call']
  
  readonly logRequest: IngestDeps['logRequest']
  
  readonly judge?: MemoryJudge
  
  readonly signal: AbortSignal
}


export interface ReplayOutcome {
  
  readonly replayed: number
  
  readonly kept: number
}






export async function replayPendingIngests(deps: ReplayIngestDeps): Promise<ReplayOutcome> {
  const store = await deps.openStore()
  const pendings = await store.listAuditDetails(INGEST_PENDING_OP)
  let replayed = 0
  let kept = 0
  for (const detail of pendings) {
    const key = decodeTurnKey(detail)
    if (key === undefined || (await store.hasAudit(INGEST_DONE_OP, detail))) {
      await store.clearAudit(INGEST_PENDING_OP, detail)
      continue
    }
    const session = await deps.resolveSession(key.sessionId)
    if (session === undefined) {
      kept += 1
      continue
    }
    await ingestPreviousTurn({
      events: session.events,
      sessionId: key.sessionId,
      turn: key.turn,
      slice: key.turn,
      openStore: deps.openStore,
      openAuditStore: deps.openStore,
      ...ingestWriteRouting(session.cwd, deps.resolveStore, deps.openStore),
      embedder: deps.embedder,
      mode: deps.mode,
      routeOverride: deps.routeOverride,
      call: deps.call,
      logRequest: deps.logRequest,
      ...(deps.judge === undefined ? {} : { judge: deps.judge }),
      signal: deps.signal,
    })
    await store.clearAudit(INGEST_PENDING_OP, detail)
    replayed += 1
  }
  return { replayed, kept }
}
