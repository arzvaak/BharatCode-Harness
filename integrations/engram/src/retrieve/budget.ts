/**
 * Per-item and total character limits bound recalled memory context.
 * These protocol constants align with per-turn recall quotas and are not deployment settings.
 * @module @kenz1117/dsh-engram/retrieve/budget
 */

/** Maximum characters per recalled item, with an ellipsis for truncated text. */
export const RECALL_PER_ITEM_CHARS = 1200

/** Total recall-body character budget, including identifiers and metadata. */
export const RECALL_TOTAL_CHARS = 4800

/**
 * Truncate text to maxChars, appending an ellipsis when necessary.
 * @param text - Original text.
 * @param maxChars - Limit; defaults to RECALL_PER_ITEM_CHARS.
 */
export function truncateItem(text: string, maxChars: number = RECALL_PER_ITEM_CHARS): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`
}

/**
 * Greedily retain items in order; count oversized items as dropped and try later smaller items.
 * @param items - Candidates sorted by relevance.
 * @param cost - Budget cost per item, such as character count.
 * @param totalBudget - Total available budget.
 * @returns Retained items and dropped count.
 */
export function fitWithinBudget<T>(
  items: readonly T[],
  cost: (item: T) => number,
  totalBudget: number,
): { kept: T[]; dropped: number } {
  const kept: T[] = []
  let used = 0
  let dropped = 0
  for (const item of items) {
    const size = cost(item)
    if (used + size > totalBudget) {
      dropped += 1
      continue
    }
    kept.push(item)
    used += size
  }
  return { kept, dropped }
}

/**
 * Greedily fit lines in order, continuing with later shorter lines when a line does not fit.
 * Count skipped lines and append an explanatory hint.
 * @param lines - Candidate lines sorted by relevance.
 * @param totalBudget - Total character budget; defaults to RECALL_TOTAL_CHARS.
 * @returns Retained lines, with a dropped-item hint when applicable.
 */
export function enforceBudget(lines: readonly string[], totalBudget: number = RECALL_TOTAL_CHARS): string[] {
  const { kept, dropped } = fitWithinBudget(lines, line => line.length, totalBudget)
  if (dropped > 0) kept.push(`(${dropped} additional memories not shown: narrow the query or reduce limit and retry)`)
  return kept
}
