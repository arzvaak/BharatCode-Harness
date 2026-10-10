/**
 * Distill related memories through an auxiliary LLM into higher-level skills or facts.
 * Archive merged records with supersedes links and inherit their average confidence.
 * Explicitly triggered through engram_distill.
 * @module @kenz1117/dsh-engram/flywheel/distill
 */

import { parseJsonArray } from '../llm/client.ts'
import type { LlmRoute } from '../llm/client.ts'
import type { EngramEmbedder } from '../embedder/interface.ts'
import type { EngramStore } from '../store/interface.ts'
import type { EngramScope, MemoryId } from '../types.ts'
import { asMemoryId } from '../types.ts'

/** Input cap bounds context for a single auxiliary call. */
const DISTILL_MAX_INPUT = 30
/** Distillation output token limit. */
const DISTILL_MAX_TOKENS = 900

const DISTILL_SYSTEM = [
  'The following are long-term memories. Combine entries expressing the same theme or an inferable rule into a higher-level memory.',
  'Output only a JSON array. Each item has {"content": "one-sentence distilled rule", "kind": "skill or fact", "importance": 0.7, "supersedes": ["input record id", "..."]}.',
  'Select supersedes identifiers only from the input, with at least one per group. Omit entries that cannot be combined. If no combination is possible, output [].',
  'Do not output anything outside the JSON array.',
].join('\n')

/** Logged payload for an auxiliary distillation request. */
export interface DistillRequestEventData {
  readonly route: LlmRoute
  readonly scope: EngramScope
  readonly userText: string
  readonly maxTokens: number
}

/** Distillation result summary. */
export interface DistillOutcome {
  /** Number of input records. */
  readonly input: number
  /** Number of distilled outputs. */
  readonly distilled: number
  /** Number of archived source records. */
  readonly superseded: number
}

/** Dependencies for distillation. */
export interface DistillDeps {
  readonly store: EngramStore
  readonly embedder: EngramEmbedder | undefined
  readonly scope: EngramScope
  /** Auxiliary call constructed using ctx.llm.stream in index.ts. */
  readonly call: (params: { route: LlmRoute; system: string; userText: string; maxTokens: number; purpose: string; signal: AbortSignal }) => Promise<string>
  readonly logRequest: (data: DistillRequestEventData) => void
  readonly route: LlmRoute
  readonly signal: AbortSignal
}

/**
 * Execute one distillation pass.
 * @returns Summary; LLM/parse errors propagate to tools and a failed group write aborts the pass.
 */
export async function distillMemories(deps: DistillDeps): Promise<DistillOutcome> {
  const rows = await deps.store.topActive(deps.scope, DISTILL_MAX_INPUT)
  if (rows.length < 2) return { input: rows.length, distilled: 0, superseded: 0 }

  const lines = rows.map(record => `[${record.id}] (${record.kind}, importance ${record.importance.toFixed(2)}) ${record.content}`)
   const userText = `Memory records:\n${lines.join('\n')}`
  deps.logRequest({ route: deps.route, scope: deps.scope, userText, maxTokens: DISTILL_MAX_TOKENS })
  const raw = await deps.call({
    route: deps.route,
    system: DISTILL_SYSTEM,
    userText,
    maxTokens: DISTILL_MAX_TOKENS,
    purpose: 'engram-distill',
    signal: deps.signal,
  })
  const parsed = parseJsonArray(raw)
  if (parsed === undefined || parsed.length === 0) return { input: rows.length, distilled: 0, superseded: 0 }

  const validIds = new Set(rows.map(record => String(record.id)))
  const byId = new Map(rows.map(record => [String(record.id), record]))
  let distilled = 0
  let superseded = 0
  for (const item of parsed) {
    const candidate = item as { content?: unknown; kind?: unknown; importance?: unknown; supersedes?: unknown }
    if (typeof candidate.content !== 'string' || candidate.content.trim() === '') continue
    if (!Array.isArray(candidate.supersedes) || candidate.supersedes.length === 0) continue
    // Sources must belong to this input and remain active, preventing repeated archival within a batch.
    const oldIds: MemoryId[] = []
    for (const rawId of candidate.supersedes) {
      if (typeof rawId !== 'string' || !validIds.has(rawId)) continue
      const row = await deps.store.get(asMemoryId(rawId))
      if (row !== undefined && row.status === 'active') oldIds.push(asMemoryId(rawId))
    }
    if (oldIds.length === 0) continue
    const kind = candidate.kind === 'skill' || candidate.kind === 'fact' ? candidate.kind : 'skill'
    const importance = typeof candidate.importance === 'number' && Number.isFinite(candidate.importance)
      ? Math.min(1, Math.max(0, candidate.importance))
      : 0.7
    // Inherit average confidence and average source embeddings when an embedder is available.
    const confidences = oldIds
      .map(oldId => byId.get(String(oldId))?.confidence ?? 0.5)
      .filter(value => value > 0)
    const confidence = confidences.length === 0 ? 0.5 : confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    let embedding: Float32Array | undefined
    if (deps.embedder !== undefined) {
      const vectors: Float32Array[] = []
      for (const oldId of oldIds) {
        const vector = (await deps.embedder.embed([byId.get(String(oldId))?.content ?? '']))[0]
        if (vector !== undefined) vectors.push(vector)
      }
      if (vectors.length > 0) {
        const average = new Float32Array(vectors[0]!.length)
        for (const vector of vectors) {
          for (let i = 0; i < vector.length; i++) average[i] = (average[i] ?? 0) + vector[i]! / vectors.length
        }
        embedding = average
      }
    }
    await deps.store.supersedeMany(
      {
        scope: deps.scope,
        kind,
        content: candidate.content.trim(),
        importance,
        confidence,
        ...(embedding === undefined ? {} : { embedding }),
      },
      oldIds,
    )
    distilled += 1
    superseded += oldIds.length
  }
  return { input: rows.length, distilled, superseded }
}
