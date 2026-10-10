















import { parseJsonArray } from '../llm/client.ts'
import type { LlmRoute } from '../llm/client.ts'
import type { EngramEmbedder } from '../embedder/interface.ts'
import type { EngramStore } from '../store/interface.ts'
import type { EngramScope, MemoryId, ObservationId } from '../types.ts'
import { asMemoryId, asObservationId } from '../types.ts'


const REFLECT_POOL = 300

const REFLECT_MAX_INPUT = 30

const REFLECT_MAX_STALE = 5

const REFLECT_STALE_EVIDENCE_LIMIT = 6

const REFLECT_EVIDENCE_SLICE = 120

const REFLECT_MAX_TOKENS = 900

const REFLECT_MERGE_THRESHOLD = 0.9

const REFLECT_STALE_THRESHOLD = 0.86

const REFLECT_SYSTEM = [
  'Two sections follow: [Memories to consolidate] contains newly written memories; [Beliefs to review] contains earlier beliefs with their original evidence.',
  'Consolidate and review the evidence. Output only a JSON array with one of these actions per item:',
  '1. {"action":"form","belief":"one sentence conclusion, pattern, or stable preference","sourceIds":["memory id"]}. At least one source ID is required, all from the memories section. Combine supporting memories; do not create beliefs for trivial individual memories.',
  '2. {"action":"refine","observationId":"belief id","belief":"updated wording","sourceIds":["new evidence id"]}. Use when evidence extends or limits a belief. IDs must come from the memories section; an empty list is allowed for wording improvements.',
  '3. {"action":"still","observationId":"belief id"}. Use when new evidence leaves the belief valid.',
  '4. {"action":"refute","observationId":"belief id","reason":"reason citing evidence"}. Use when new evidence contradicts and invalidates the belief.',
  'Observation IDs must come from the beliefs section. Return [] when nothing warrants consolidation or review. Output no text outside JSON.',
].join('\n')


export interface ReflectRequestEventData {
  readonly route: LlmRoute
  readonly scope: EngramScope
  readonly candidateCount: number
  readonly staleCount: number
  readonly maxTokens: number
}


export interface ReflectOutcome {
  
  readonly pool: number
  
  readonly candidates: number
  
  readonly staleReviewed: number
  
  readonly formed: number
  
  readonly refined: number
  
  readonly confirmed: number
  
  readonly refuted: number
  
  readonly skipped: number
}


export interface ReflectDeps {
  readonly store: EngramStore
  
  readonly embedder: EngramEmbedder | undefined
  readonly scope: EngramScope
  
  readonly call: (params: { route: LlmRoute; system: string; userText: string; maxTokens: number; purpose: string; signal: AbortSignal }) => Promise<string>
  readonly logRequest: (data: ReflectRequestEventData) => void
  readonly route: LlmRoute
  readonly signal: AbortSignal
}





export async function reflectObservations(deps: ReflectDeps): Promise<ReflectOutcome> {

  const outcome = {
    pool: 0, candidates: 0, staleReviewed: 0, formed: 0, refined: 0, confirmed: 0, refuted: 0, skipped: 0,
  } satisfies ReflectOutcome

  deps.signal.throwIfAborted()
  const pool = await deps.store.topActive(deps.scope, REFLECT_POOL)
  deps.signal.throwIfAborted()
  outcome.pool = pool.length
  const known = await deps.store.listObservations({ limit: 1000 })
  deps.signal.throwIfAborted()
  const evidenced = new Set<string>()
  for (const observation of known) {
    if (observation.status === 'refuted') continue
    for (const sourceId of observation.sourceIds) evidenced.add(String(sourceId))
  }
  const candidates = pool.filter(record => !evidenced.has(String(record.id))).slice(0, REFLECT_MAX_INPUT)


  if (deps.embedder !== undefined && candidates.length > 0) {
    const vectors = await deps.embedder.embed(candidates.map(record => record.content))
    deps.signal.throwIfAborted()
    const staleMarks = new Set<string>()
    for (const vector of vectors) {
      if (vector === undefined) continue
      const nearest = await deps.store.nearestObservation(vector)
      if (nearest !== undefined
        && nearest.record.status === 'active'
        && nearest.similarity >= REFLECT_STALE_THRESHOLD) {
        staleMarks.add(String(nearest.record.id))
      }
    }
    for (const id of staleMarks) {
      try {
        await deps.store.markObservationStale(asObservationId(id))
      } catch {
        
      }
    }
  }

  deps.signal.throwIfAborted()
  const stale = (await deps.store.listObservations({ status: 'stale', limit: REFLECT_MAX_STALE }))
  outcome.candidates = candidates.length
  outcome.staleReviewed = stale.length
  if (candidates.length === 0 && stale.length === 0) return outcome

  const candidateIds = new Set(candidates.map(record => String(record.id)))
  const staleIds = new Set(stale.map(observation => String(observation.id)))
  const sections: string[] = []
  if (candidates.length > 0) {
    const lines = candidates.map(record => `[${String(record.id)}] (${record.kind}, importance ${record.importance.toFixed(2)}) ${record.content}`)
    sections.push(`[Memories to consolidate]\n${lines.join('\n')}`)
  }
  if (stale.length > 0) {
    const blocks: string[] = []
    for (const observation of stale) {
      const evidenceRecords = await deps.store.getMany(observation.sourceIds.slice(0, REFLECT_STALE_EVIDENCE_LIMIT))
      const evidence = evidenceRecords
        .map(record => `  - ${record.content.slice(0, REFLECT_EVIDENCE_SLICE)}`)
        .join('\n')
      blocks.push(`[${String(observation.id)}] evidence ${String(observation.proofCount)} items: ${observation.belief}\n${evidence}`)
    }
    sections.push(`[Beliefs to review]\n${blocks.join('\n')}`)
  }
  const userText = sections.join('\n\n')
  deps.logRequest({
    route: deps.route,
    scope: deps.scope,
    candidateCount: candidates.length,
    staleCount: stale.length,
    maxTokens: REFLECT_MAX_TOKENS,
  })
  const raw = await deps.call({
    route: deps.route,
    system: REFLECT_SYSTEM,
    userText,
    maxTokens: REFLECT_MAX_TOKENS,
    purpose: 'engram-reflect',
    signal: deps.signal,
  })
  deps.signal.throwIfAborted()
  const parsed = parseJsonArray(raw)
  if (parsed === undefined || parsed.length === 0) return outcome

  for (const item of parsed) {
    deps.signal.throwIfAborted()
    const action = item as { action?: unknown; belief?: unknown; sourceIds?: unknown; observationId?: unknown; reason?: unknown }
    try {
      if (action.action === 'form') {
        const formResult = await applyForm(deps, action, candidateIds)
        if (formResult === 'refined') outcome.refined += 1
        else outcome.formed += 1
      } else if (action.action === 'refine') {
        const observationId = requireObservationId(action.observationId, staleIds)
        if (observationId === undefined) { outcome.skipped += 1; continue }
        if (typeof action.belief !== 'string' || action.belief.trim() === '') { outcome.skipped += 1; continue }
        const sourceIds = requireCandidateIds(action.sourceIds, candidateIds)
        if (sourceIds === undefined) { outcome.skipped += 1; continue }
        await refineWithEmbedding(deps, observationId, action.belief.trim(), sourceIds)
        outcome.refined += 1
      } else if (action.action === 'still') {
        const observationId = requireObservationId(action.observationId, staleIds)
        if (observationId === undefined) { outcome.skipped += 1; continue }
        await deps.store.confirmObservation(observationId)
        outcome.confirmed += 1
      } else if (action.action === 'refute') {
        const observationId = requireObservationId(action.observationId, staleIds)
        if (observationId === undefined) { outcome.skipped += 1; continue }
        await deps.store.refuteObservation(observationId)
        outcome.refuted += 1
      } else {
        outcome.skipped += 1
      }
    } catch {

      outcome.skipped += 1
    }
  }

  deps.signal.throwIfAborted()
  try {
    await deps.store.audit('reflect', 'AUX', JSON.stringify({
      scope: deps.scope,
      pool: outcome.pool,
      candidates: outcome.candidates,
      staleReviewed: outcome.staleReviewed,
      formed: outcome.formed,
      refined: outcome.refined,
      confirmed: outcome.confirmed,
      refuted: outcome.refuted,
      skipped: outcome.skipped,
    }))
  } catch {
    
  }
  return outcome
}


async function applyForm(
  deps: ReflectDeps,
  action: { belief?: unknown; sourceIds?: unknown },
  candidateIds: ReadonlySet<string>,
): Promise<'formed' | 'refined'> {
  if (typeof action.belief !== 'string' || action.belief.trim() === '') throw new Error('form: belief is missing')
  const sourceIds = requireCandidateIds(action.sourceIds, candidateIds)
  if (sourceIds === undefined || sourceIds.length === 0) throw new Error('form: sourceIds are out of bounds or empty')
  const belief = action.belief.trim()

  if (deps.embedder !== undefined) {
    const vectors = await deps.embedder.embed([belief])
    deps.signal.throwIfAborted()
    const vector = vectors[0]
    if (vector !== undefined) {
      const nearest = await deps.store.nearestObservation(vector)
      if (nearest !== undefined && nearest.similarity >= REFLECT_MERGE_THRESHOLD) {
        await deps.store.refineObservation(nearest.record.id, belief, sourceIds, vector)
        return 'refined'
      }
      await deps.store.createObservation({ scope: deps.scope, belief, sourceIds, embedding: vector })
      return 'formed'
    }
  }
  await deps.store.createObservation({ scope: deps.scope, belief, sourceIds })
  return 'formed'
}


async function refineWithEmbedding(
  deps: ReflectDeps,
  observationId: ObservationId,
  belief: string,
  sourceIds: readonly MemoryId[],
): Promise<void> {
  if (deps.embedder !== undefined) {
    const vectors = await deps.embedder.embed([belief])
    deps.signal.throwIfAborted()
    const vector = vectors[0]
    if (vector !== undefined) {
      await deps.store.refineObservation(observationId, belief, sourceIds, vector)
      return
    }
  }
  await deps.store.refineObservation(observationId, belief, sourceIds)
}


function requireObservationId(raw: unknown, staleIds: ReadonlySet<string>): ObservationId | undefined {
  if (typeof raw !== 'string' || !staleIds.has(raw)) return undefined
  return asObservationId(raw)
}





function requireCandidateIds(raw: unknown, candidateIds: ReadonlySet<string>): readonly MemoryId[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const ids: MemoryId[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || !candidateIds.has(item)) return undefined
    ids.push(asMemoryId(item))
  }
  return ids
}
