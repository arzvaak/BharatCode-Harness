/**
 * Heuristic placard quality score from 0 to 1: every marker should be distinctive.
 * Principles: unique across the library, distinguishable within its room, and date anchored.
 * Sensory and emotional imagery are not scored; those compensate for human memory limitations.
 * Persist imagery_score on save for refurbishment rules and improvement hints.
 * Pure heuristics avoid an additional LLM call for every save.
 * @module @kenz1117/dsh-engram/imagery/score
 */

/** Scores below this threshold trigger save hints and refurbishment proposals. */
export const PLACARD_LOW_THRESHOLD = 0.5

/** Date anchors: numeric dates, localized year/month forms, and relative time expressions. */
const DATE_ANCHOR = /\d{4}[-/年.]\s?\d{1,2}|[今昨]天|本周|上周|周[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]/

/** Compare the first six characters when checking whether neighboring placards are too similar. */
const DIFF_PREFIX_LEN = 6

/** Existing placard snapshot obtained from storage before saving. */
export interface PlacardContext {
  /** Existing library-wide captions for uniqueness checks. */
  readonly existingCaptions: readonly string[]
  /** Captions in the same room for differentiation checks. */
  readonly roomCaptions: readonly string[]
}

/**
 * Calculate placard quality from 0 to 1, rounded to two decimal places.
 * A valid unique caption of 4-30 characters earns 0.4; a date anchor earns 0.3;
 * a distinct six-character prefix within the room earns 0.3. Missing captions score zero.
 * @param caption - ImageryLabel caption; null or undefined means no placard.
 * @param context - Existing placard snapshot.
 * @returns Quality score from 0 to 1.
 */
export function scorePlacard(caption: string | null | undefined, context: PlacardContext): number {
  if (caption === null || caption === undefined) return 0
  const text = caption.trim()
  let score = 0
  const valid = text.length >= 4 && text.length <= 30
  if (valid && !context.existingCaptions.includes(text)) score += 0.4
  if (DATE_ANCHOR.test(text)) score += 0.3
  const prefix = text.slice(0, DIFF_PREFIX_LEN)
  const clashes = context.roomCaptions.some(other => other.slice(0, DIFF_PREFIX_LEN) === prefix)
  if (valid && !clashes) score += 0.3
  return Math.round(Math.min(1, score) * 100) / 100
}

/**
 * Improvement hint appended to engram_save output for low-quality placards.
 * @param score - Result of scorePlacard.
 * @returns English hint, or null when the score meets the threshold.
 */
export function placardImprovementHint(score: number): string | null {
  if (score >= PLACARD_LOW_THRESHOLD) return null
  return 'Placard needs improvement (unique, distinctive, date anchored): use the imagery parameter of engram_update to attach a 4-30 character caption with a date anchor and a first-six-character prefix distinct from other placards in the same room.'
}
