/**
 * Propose an introductory palace tour on the first session turn.
 * Prioritize relevant user/project memory kinds and importance multiplied by confidence,
 * providing up to five candidates and an invitation for the opening response.
 * This is guidance for the opening decision, not a memory write.
 * @module @kenz1117/dsh-engram/tour-proposal
 */

import type { EngramScope, MemoryRecord } from './types.ts'

/** Palace-entry proposal. */
export interface TourProposal {
  /** Opening invitation generated from the current palace state. */
  readonly greeting: string
  /** Suggested memories ordered by priority, at most five. */
  readonly suggestedStops: readonly MemoryRecord[]
  /** Current active-memory count used to tailor the invitation. */
  readonly activeCount: number
  /** Whether the palace is empty and should invite the first memory. */
  readonly empty: boolean
}

/**
 * Build a palace-entry proposal.
 * @param scope - Memory scope; shared scope is handled separately.
 * @param records - Scope records ordered by importance multiplied by confidence.
 * @param focusKind - Optional current-input theme; matching kinds take priority.
 */
export function buildTourProposal(
  scope: EngramScope,
  records: readonly MemoryRecord[],
  focusKind?: string,
): TourProposal {
  const active = records.filter(r => r.status === 'active')
  const empty = active.length === 0
  const limit = Math.min(5, Math.max(1, active.length))
  const scored = [...active].sort((a, b) => {
    // Prioritize matching kinds, then importance multiplied by confidence.
    const focusBoost = (record: MemoryRecord): number => focusKind !== undefined && record.kind === focusKind ? 1 : 0
    const scoreA = focusBoost(a) * 1000 + a.importance * a.confidence * 100
    const scoreB = focusBoost(b) * 1000 + b.importance * b.confidence * 100
    return scoreB - scoreA
  }).slice(0, limit)

  const greeting = empty
    ? `[${scope}] The palace is empty. Start with a first memory, such as a fact or preference, to anchor future conversations.`
    : `[${scope}] The palace contains ${active.length} active memories. Suggested opening tour: ${scored.map((r, i) => `Stop ${i + 1}: "${r.content.slice(0, 24)}${r.content.length > 24 ? '…' : ''}"`).join('; ')}.`

  return { greeting, suggestedStops: scored, activeCount: active.length, empty }
}