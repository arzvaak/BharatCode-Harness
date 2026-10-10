

















import type { ResolvedHistoryRules } from '../config.ts'
import type { EngramEmbedder } from '../embedder/interface.ts'
import type { LlmRoute, SessionEventLike } from '../llm/client.ts'
import type { EngramStore } from '../store/interface.ts'
import { INGEST_DONE_OP, encodeTurnKey, ensureSessionSummary, ingestPreviousTurn, ingestWriteRouting } from './hook.ts'
import type { IngestDeps, IngestMode, IngestWriteRouting } from './hook.ts'
import type { MemoryJudge } from '../write-disposition.ts'


export interface HistorySessionHeader {
  
  readonly id: string
  
  readonly createdAt: number
  
  readonly cwd?: string | undefined
  
  readonly isSeeded?: boolean | undefined
  
  readonly origin?: string | undefined
}


export interface HistoryLogSource {
  
  list(signal?: AbortSignal): Promise<readonly HistorySessionHeader[]>
  
  load(id: string): Promise<{ events: readonly unknown[] }>
}


export interface HistoryBackfillRules {
  readonly days?: number
  readonly maxTurnsPerSession?: number
  readonly maxTotalTurns?: number
  readonly includeSubagents?: boolean
  readonly includeSeeded?: boolean
  readonly includeNoCwd?: boolean
  
  readonly provider?: string
  
  readonly model?: string
}


export interface HistorySkipCounts {
  
  readonly subagent: number
  
  readonly seeded: number
  
  readonly noCwd: number
  
  readonly tooOld: number
  
  readonly unreadable: number
}


export interface HistoryEstimate {
  
  readonly rules: ResolvedHistoryRules
  
  readonly candidates: number
  
  readonly eligibleTurns: number
  
  readonly pendingTurns: number
  
  readonly alreadyIngested: number
  
  readonly skipped: HistorySkipCounts
  
  readonly truncated: boolean
  
  readonly unavailable?: string
}


export interface HistoryRunProgress {
  
  readonly state: 'running' | 'done' | 'cancelled' | 'failed'
  
  readonly sessionsTotal: number
  
  readonly sessionsDone: number
  
  readonly turnsPlanned: number
  
  readonly turnsDone: number
  
  readonly memoriesWritten: number
  
  readonly turnsSkipped: number
  
  readonly turnsFailed: number
  
  readonly skipReasons: Readonly<Record<string, number>>
  
  readonly currentSession?: string | undefined
}


export interface HistoryRunResult extends HistoryRunProgress {
  
  readonly failures: readonly { sessionId: string; turn: number; reason: string }[]
}


export interface HistoryBackfillDeps {
  
  readonly source: HistoryLogSource | undefined
  
  readonly resolveStore: (cwd: string) => Promise<EngramStore>
  
  readonly openUserStore: () => Promise<EngramStore>
  
  readonly resolveExistingUserStore: () => Promise<EngramStore | undefined>
  readonly embedder: Promise<EngramEmbedder | undefined>
  readonly mode: Exclude<IngestMode, 'off'>
  readonly routeOverride: LlmRoute | undefined
  readonly call: IngestDeps['call']
  readonly logRequest: IngestDeps['logRequest']
  
  readonly judge?: MemoryJudge
  
  readonly now?: () => number
}


interface CandidateSession {
  readonly header: HistorySessionHeader
  readonly events: readonly SessionEventLike[]
  
  readonly turns: readonly number[]
  
  readonly openStore: () => Promise<EngramStore>
  
  readonly routing: IngestWriteRouting
}

const DAY_MS = 86_400_000

const ESTIMATE_CONCURRENCY = 4








export function mergeHistoryRules(defaults: ResolvedHistoryRules, overrides: HistoryBackfillRules): ResolvedHistoryRules {
  const days = overrides.days ?? defaults.days
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error('historyBackfill: days must be an integer in [0, 3650] (0 = unlimited)')
  const maxTurnsPerSession = overrides.maxTurnsPerSession ?? defaults.maxTurnsPerSession
  if (!Number.isInteger(maxTurnsPerSession) || maxTurnsPerSession < 1 || maxTurnsPerSession > 500) {
    throw new Error('historyBackfill: maxTurnsPerSession must be an integer in [1, 500]')
  }
  const maxTotalTurns = overrides.maxTotalTurns ?? defaults.maxTotalTurns
  if (!Number.isInteger(maxTotalTurns) || maxTotalTurns < 1 || maxTotalTurns > 5000) {
    throw new Error('historyBackfill: maxTotalTurns must be an integer in [1, 5000]')
  }
  // Auxiliary provider and model must be supplied together; partial configuration fails loudly.
  const hasProvider = overrides.provider !== undefined && overrides.provider !== ''
  const hasModel = overrides.model !== undefined && overrides.model !== ''
  if (hasProvider !== hasModel) {
    throw new Error('historyBackfill: provider and model must be supplied together')
  }
  return {
    days,
    maxTurnsPerSession,

    maxTotalTurns: Math.min(maxTotalTurns, defaults.maxTotalTurns),
    includeSubagents: overrides.includeSubagents ?? defaults.includeSubagents,
    includeSeeded: overrides.includeSeeded ?? defaults.includeSeeded,
    includeNoCwd: overrides.includeNoCwd ?? defaults.includeNoCwd,
  }
}


function turnNumbers(events: readonly SessionEventLike[]): number[] {
  const turns: number[] = []
  for (const event of events) {
    if (event.type !== 'turn/start') continue
    const turn = (event.data as { turn?: unknown } | null)?.turn
    if (typeof turn === 'number' && Number.isFinite(turn)) turns.push(turn)
  }
  return turns
}


async function loadSession(source: HistoryLogSource, id: string): Promise<readonly SessionEventLike[] | undefined> {
  try {
    const loaded = await source.load(id)
    return loaded.events as unknown as readonly SessionEventLike[]
  } catch {

    return undefined
  }
}


interface SelectResult {
  readonly candidates: CandidateSession[]
  readonly skipped: HistorySkipCounts
  readonly truncated: boolean
}







async function selectSessions(deps: HistoryBackfillDeps, rules: ResolvedHistoryRules): Promise<SelectResult> {
  const source = deps.source
  if (source === undefined) return { candidates: [], skipped: { subagent: 0, seeded: 0, noCwd: 0, tooOld: 0, unreadable: 0 }, truncated: false }
  const now = (deps.now ?? Date.now)()
  const headers = await source.list()
  const skipped = { subagent: 0, seeded: 0, noCwd: 0, tooOld: 0, unreadable: 0 }
  
  const kept: HistorySessionHeader[] = []
  for (const header of [...headers].sort((a, b) => b.createdAt - a.createdAt)) {
    if (header.origin === 'subagent' && !rules.includeSubagents) { skipped.subagent += 1; continue }
    if (header.isSeeded === true && !rules.includeSeeded) { skipped.seeded += 1; continue }
    if ((header.cwd === undefined || header.cwd === '') && !rules.includeNoCwd) { skipped.noCwd += 1; continue }
    if (rules.days > 0 && header.createdAt < now - rules.days * DAY_MS) { skipped.tooOld += 1; continue }
    kept.push(header)
  }

  const loaded: (CandidateSession | undefined)[] = []
  for (let i = 0; i < kept.length; i += ESTIMATE_CONCURRENCY) {
    const batch = kept.slice(i, i + ESTIMATE_CONCURRENCY)
    const settled = await Promise.all(batch.map(async (header): Promise<CandidateSession | undefined> => {
      const events = await loadSession(source, header.id)
      if (events === undefined) { skipped.unreadable += 1; return undefined }

      const all = turnNumbers(events)
      const turns = all.slice(Math.max(0, all.length - rules.maxTurnsPerSession))
      if (turns.length === 0) return undefined
      const cwd = header.cwd
      if (cwd === undefined || cwd === '') {

        return { header, events, turns, openStore: deps.openUserStore, routing: { writeScope: 'user', perCandidateScope: false } }
      }
      const projectCwd = cwd
      return {
        header,
        events,
        turns,
        openStore: () => deps.resolveStore(projectCwd),

        routing: ingestWriteRouting(projectCwd, deps.resolveStore, deps.openUserStore),
      }
    }))
    loaded.push(...settled)
  }

  const candidates: CandidateSession[] = []
  let budget = rules.maxTotalTurns
  let truncated = false
  for (const candidate of loaded) {
    if (candidate === undefined) continue
    if (budget <= 0) { truncated = true; continue }
    const allowed = candidate.turns.slice(Math.max(0, candidate.turns.length - budget))
    if (allowed.length < candidate.turns.length) truncated = true
    candidates.push({ ...candidate, turns: allowed })
    budget -= allowed.length
  }
  return { candidates, skipped, truncated }
}


const UNAVAILABLE_REASON = 'Session persistence is unavailable in this environment; historical sessions cannot be backfilled'









export async function estimateHistoryBackfill(
  deps: HistoryBackfillDeps,
  defaults: ResolvedHistoryRules,
  overrides: HistoryBackfillRules = {},
): Promise<HistoryEstimate> {
  const rules = mergeHistoryRules(defaults, overrides)
  if (deps.source === undefined) {
    return { rules, candidates: 0, eligibleTurns: 0, pendingTurns: 0, alreadyIngested: 0, skipped: { subagent: 0, seeded: 0, noCwd: 0, tooOld: 0, unreadable: 0 }, truncated: false, unavailable: UNAVAILABLE_REASON }
  }
  const { candidates, skipped, truncated } = await selectSessions(deps, rules)
  const auditStore = await deps.resolveExistingUserStore()
  let eligibleTurns = 0
  let alreadyIngested = 0
  for (const candidate of candidates) {
    eligibleTurns += candidate.turns.length

    if (auditStore === undefined) continue
    for (const turn of candidate.turns) {
      if (await auditStore.hasAudit(INGEST_DONE_OP, encodeTurnKey(candidate.header.id, turn))) alreadyIngested += 1
    }
  }
  return {
    rules,
    candidates: candidates.length,
    eligibleTurns,
    pendingTurns: eligibleTurns - alreadyIngested,
    alreadyIngested,
    skipped,
    truncated,
  }
}










export async function runHistoryBackfill(
  deps: HistoryBackfillDeps,
  defaults: ResolvedHistoryRules,
  overrides: HistoryBackfillRules,
  onProgress: (progress: HistoryRunProgress) => void,
  signal: AbortSignal,
): Promise<HistoryRunResult> {
  const rules = mergeHistoryRules(defaults, overrides)
  const { candidates } = deps.source === undefined
    ? { candidates: [] as CandidateSession[] }
    : await selectSessions(deps, rules)

  const routeOverride = overrides.provider !== undefined && overrides.model !== undefined
    ? { provider: overrides.provider, model: overrides.model }
    : deps.routeOverride
  const failures: { sessionId: string; turn: number; reason: string }[] = []
  
  const progress: {
    state: HistoryRunProgress['state']
    sessionsTotal: number
    sessionsDone: number
    turnsPlanned: number
    turnsDone: number
    memoriesWritten: number
    turnsSkipped: number
    turnsFailed: number
    skipReasons: Record<string, number>
    currentSession?: string | undefined
  } = {
    state: 'running',
    sessionsTotal: candidates.length,
    sessionsDone: 0,
    turnsPlanned: candidates.reduce((sum, candidate) => sum + candidate.turns.length, 0),
    turnsDone: 0,
    memoriesWritten: 0,
    turnsSkipped: 0,
    turnsFailed: 0,
    skipReasons: {},
  }
  onProgress({ ...progress })
  for (const candidate of candidates) {
    if (signal.aborted) break
    for (const turn of candidate.turns) {
      if (signal.aborted) break
      try {
        const outcome = await ingestPreviousTurn({
          events: candidate.events,
          sessionId: candidate.header.id,
          turn,
          slice: turn,
          openStore: () => candidate.openStore(),

          openAuditStore: deps.openUserStore,
          ...candidate.routing,
          embedder: deps.embedder,
          mode: deps.mode,
          routeOverride,
          call: deps.call,
          logRequest: deps.logRequest,
          ...(deps.judge === undefined ? {} : { judge: deps.judge }),
          signal,

          throttle: true,
          history: true,
        })
        progress.memoriesWritten += outcome.written
        if (outcome.skipped !== null) {
          progress.turnsSkipped += 1
          progress.skipReasons[outcome.skipped] = (progress.skipReasons[outcome.skipped] ?? 0) + 1
        }
      } catch (error) {

        progress.turnsFailed += 1
        failures.push({ sessionId: candidate.header.id, turn, reason: error instanceof Error ? error.message : String(error) })
      }
      progress.turnsDone += 1
    }

    await ensureSessionSummary({
      events: candidate.events,
      sessionId: candidate.header.id,
      openStore: () => candidate.openStore(),
      call: deps.call,
      logRequest: deps.logRequest,
      mode: deps.mode,
      routeOverride,
      signal,

      round: candidate.turns[candidate.turns.length - 1],
    })
    progress.sessionsDone += 1
    onProgress({ ...progress, currentSession: candidate.header.id })
  }
  const state = signal.aborted ? 'cancelled' : 'done'
  onProgress({ ...progress, state })
  return { ...progress, state, failures }
}
