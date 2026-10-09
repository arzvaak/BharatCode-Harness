/**
 * Shared pre-write disposition rules for explicit saves and automatic ingestion.
 * Cosine similarity and memory kind determine acceptance, merging, or deferral.
 * An optional Jev judge resolves ambiguous cases and confirms contradiction candidates.
 * Callers handle empty or duplicate content drops; this module handles database-dependent decisions.
 * Restatements reinforce existing memories; suspected conflicts retain links for later review.
 * @module @kenz1117/dsh-engram/write-disposition
 */

import type { EngramKind, MemoryRecord } from './types.ts'
import type { EngramStore } from './store/interface.ts'
import { recordJevObservation } from './jev/observe.ts'

/** Four possible write dispositions. */
export type WriteDisposition = 'accept' | 'merge' | 'drop' | 'defer'

/** Same-kind merge threshold, aligned with consolidation defaults. */
export const MERGE_COSINE = 0.92
/** Similarity threshold for suspected corrections or conflicts requiring deferral. */
export const DEFER_COSINE = 0.88

/** Database-dependent decisions; callers handle drop decisions separately. */
export type WriteDecision =
  | { readonly disposition: 'accept' }
  | { readonly disposition: 'merge'; readonly into: MemoryRecord; readonly similarity: number }
  | { readonly disposition: 'defer'; readonly neighbor: MemoryRecord; readonly similarity: number }

/** Binary state question corresponding to a Jev Noul judgment. */
export interface JudgeQuestion {
  /** Identifier used to associate an answer probability with its question. */
  readonly id: string
  /** English natural-language instructions for the judge. */
  readonly instructions: string
}

/** Question identifiers mapped to probabilities from zero to one. */
export type JudgeAnswers = Readonly<Record<string, number>>

/**
 * Optional memory judge backed by the Jev System One model.
 * Assembly supplies thresholds; failed asks fall back to rule-based decisions.
 */
export interface MemoryJudge {
  /** Probability threshold for merging ambiguous restatements. */
  readonly deferMergeAbove: number
  /** Probability threshold below which distinct memories are accepted. */
  readonly deferAcceptBelow: number
  /** Minimum probability for creating a contradicts edge. */
  readonly contradictMinProbability: number
  /** Ask questions about the supplied state in parallel. */
  ask(state: string, questions: readonly JudgeQuestion[]): Promise<JudgeAnswers>
}

/** Both judge and content are required for ambiguous-band adjudication. */
export interface DecideWriteOptions {
  /** Undefined selects rule-only decisions. */
  readonly judge?: MemoryJudge
  /** Incoming content compared against the nearest memory. */
  readonly content?: string
}

/**
 * Resolve the ambiguous band through Jev.
 * Return merge or accept for confident answers; otherwise retain deferral.
 */
async function resolveBand(
  judge: MemoryJudge,
  neighbor: MemoryRecord,
  similarity: number,
  kind: EngramKind,
  content: string,
): Promise<WriteDecision | undefined> {
  const startedAt = Date.now()
  try {
    const answers = await judge.ask(
      `Memory A:\n${neighbor.content}\n\nMemory B:\n${content}`,
      [{
        id: 'same_memory',
        instructions: `Are Memory A and Memory B the same fact, i.e. restatements of one identical statement (both are "${kind}" memories)? Answer true only for genuine restatements.`,
      }],
    )
    const p = answers['same_memory']
    recordJevObservation({
      at: startedAt,
      site: 'band',
      question: 'same_memory',
      answered: p !== undefined,
      probability: p,
      elapsedMs: Date.now() - startedAt,
      error: undefined,
      verdict: p === undefined
        ? 'fallback'
        : p >= judge.deferMergeAbove ? 'merge' : p <= judge.deferAcceptBelow ? 'accept' : 'defer',
    })
    if (p === undefined) return undefined
    if (p >= judge.deferMergeAbove) return { disposition: 'merge', into: neighbor, similarity }
    if (p <= judge.deferAcceptBelow) return { disposition: 'accept' }
    return undefined
  } catch (error) {
    // Judge failures retain rule-based deferral without interrupting ingestion.
    recordJevObservation({
      at: startedAt,
      site: 'band',
      question: 'same_memory',
      answered: false,
      probability: undefined,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      verdict: 'fallback',
    })
    return undefined
  }
}

/**
 * Decide how to handle incoming memory content.
 * Missing vectors or similarity below DEFER_COSINE result in acceptance.
 * Same-kind similarity at or above MERGE_COSINE results in merging.
 * Other sufficiently similar candidates enter judge adjudication when available.
 * Uncertain or failed judgments retain deferral, as does rule-only operation.
 * @param store - Target memory database.
 * @param kind - Incoming memory kind; cross-kind similarity cannot trigger rule-based merging.
 * @param embedding - Incoming vector; undefined results in acceptance.
 * @param options - Optional judge and incoming content for adjudication.
 */
export async function decideWrite(
  store: EngramStore,
  kind: EngramKind,
  embedding: Float32Array | undefined,
  options: DecideWriteOptions = {},
): Promise<WriteDecision> {
  if (embedding === undefined) return { disposition: 'accept' }
  const nearest = await store.nearestNeighbor(embedding)
  if (nearest === undefined || nearest.similarity < DEFER_COSINE) return { disposition: 'accept' }
  if (nearest.similarity >= MERGE_COSINE && nearest.record.kind === kind) {
    return { disposition: 'merge', into: nearest.record, similarity: nearest.similarity }
  }
  const { judge, content } = options
  if (judge !== undefined && content !== undefined) {
    const verdict = await resolveBand(judge, nearest.record, nearest.similarity, kind, content)
    if (verdict !== undefined) return verdict
  }
  return { disposition: 'defer', neighbor: nearest.record, similarity: nearest.similarity }
}

/**
 * Confirm contradiction candidates individually using Jev probability thresholds.
 * @param judge - Optional-model judgment adapter.
 * @param incoming - Incoming memory contents.
 * @param candidates - Candidates from ingestion deferral or tool contradiction search.
 * @returns Confirmed candidates; undefined on failure preserves the original all-edge fallback.
 */
export async function confirmContradictions(
  judge: MemoryJudge,
  incoming: string,
  candidates: readonly MemoryRecord[],
): Promise<readonly MemoryRecord[] | undefined> {
  try {
    const verdicts = await Promise.all(candidates.map(async candidate => {
      const startedAt = Date.now()
      try {
        const answers = await judge.ask(
          `Memory A:\n${candidate.content}\n\nMemory B:\n${incoming}`,
          [{
            id: 'contradicts',
            instructions: 'Do Memory A and Memory B state facts that cannot both be true at the same time (a genuine contradiction)?',
          }],
        )
        const p = answers['contradicts']
        recordJevObservation({
          at: startedAt,
          site: 'contradiction',
          question: 'contradicts',
          answered: p !== undefined,
          probability: p,
          elapsedMs: Date.now() - startedAt,
          error: undefined,
          verdict: p === undefined ? 'fallback' : p >= judge.contradictMinProbability ? 'confirm' : 'reject',
        })
        return p !== undefined && p >= judge.contradictMinProbability ? candidate : undefined
      } catch (error) {
        // Any candidate failure triggers whole-operation fallback; record it before rethrowing.
        recordJevObservation({
          at: startedAt,
          site: 'contradiction',
          question: 'contradicts',
          answered: false,
          probability: undefined,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          verdict: 'fallback',
        })
        throw error
      }
    }))
    return verdicts.filter(c => c !== undefined)
  } catch {
    // Candidate failures were logged above; preserve the all-edge fallback contract.
    return undefined
  }
}

/**
 * Reinforce a merge target and record the write-merge audit note.
 * @returns Reinforced memory; throw if concurrent deletion removed the target.
 */
export async function applyMerge(
  store: EngramStore,
  decision: WriteDecision & { readonly disposition: 'merge' },
  content: string,
): Promise<MemoryRecord> {
  const note = JSON.stringify({ content: content.slice(0, 40), similarity: Number(decision.similarity.toFixed(4)) })
  const record = await store.reinforce(decision.into.id, note)
  if (record === undefined) throw new Error(`write-disposition: merge target ${decision.into.id} does not exist`)
  return record
}
