/**
 * Refurbishment checklist: scan active memories for merge, demotion, review, or split suggestions.
 * Preview only; UI and engram_audit_refurb present suggestions for individual user confirmation.
 * @module @kenz1117/dsh-engram/refurb
 */

import type { EngramScope, MemoryRecord } from './types.ts'

/** Proposed refurbishment action. */
export type RefurbAction = 'merge' | 'demote' | 'review' | 'split'

/** One refurbishment suggestion. */
export interface RefurbSuggestion {
  readonly action: RefurbAction
  /** Primary memory identifier to focus after confirmation. */
  readonly primaryId: string
  /** Candidate duplicate identifiers for merging. */
  readonly candidates: readonly string[]
  readonly scope: EngramScope
  /** Concise English explanation for the agent or user. */
  readonly reason: string
  /** Suggestion confidence from 0 to 1; higher values indicate stronger recommendations. */
  readonly confidence: number
}

/** Tunable refurbishment thresholds with historical defaults. */
export interface RefurbOptions {
  /** Minimum active count, default eight; small inventories otherwise produce excessive noise. */
  readonly minActive: number
  /** Importance threshold for demotion, default 0.2. */
  readonly demoteBelow: number
  /** Access age threshold in days, default sixty. */
  readonly staleDays: number
  /** Duplicate-title window option, default zero; matching uses same-scope, same-kind prefixes. */
  readonly duplicateTitleWindow: number
}

/** Default thresholds. */
export const DEFAULT_REFURB_OPTIONS: RefurbOptions = {
  minActive: 8,
  demoteBelow: 0.2,
  staleDays: 60,
  duplicateTitleWindow: 0,
}

/**
 * Generate rule-based suggestions from active memories.
 * Compare duplicates only within a scope; cross-scope merges require higher-level decisions.
 * Return no suggestions below minActive to avoid excessive noise in small inventories.
 */
export function gatherRefurbSuggestions(
  records: readonly MemoryRecord[],
  options: RefurbOptions = DEFAULT_REFURB_OPTIONS,
): readonly RefurbSuggestion[] {
  const suggestions: RefurbSuggestion[] = []
  const now = Date.now()
  const active = records.filter(r => r.status === 'active')
  // Skip small inventories where placard rules would flag almost every memory.
  if (active.length < options.minActive) return []
  const byScope = new Map<EngramScope, MemoryRecord[]>()
  for (const record of active) {
    const list = byScope.get(record.scope) ?? []
    list.push(record)
    byScope.set(record.scope, list)
  }
  // Rule 1: low importance and stale access suggest demotion.
  for (const record of active) {
    const daysSinceAccess = (now - record.lastAccessedAt) / 86_400_000
    if (record.importance < options.demoteBelow && daysSinceAccess > options.staleDays) {
      suggestions.push({
        action: 'demote',
        primaryId: record.id,
        candidates: [],
        scope: record.scope,
        reason: `Importance ${record.importance.toFixed(2)} < ${options.demoteBelow} and no access for ${Math.floor(daysSinceAccess)} days; consider archiving.`,
        confidence: 0.7,
      })
    }
  }
  // Rule 2: repeated content prefixes within the same scope and kind suggest merging.
  for (const [scope, list] of byScope) {
    const byKind = new Map<string, MemoryRecord[]>()
    for (const record of list) {
      const bucket = byKind.get(record.kind) ?? []
      bucket.push(record)
      byKind.set(record.kind, bucket)
    }
    for (const [, items] of byKind) {
      if (items.length < 2) continue
      const seen = new Set<string>()
      for (const record of items) {
        const key = record.content.slice(0, 20)
        if (seen.has(key)) continue
        seen.add(key)
        const dupes = items.filter(other => other.id !== record.id && other.content.startsWith(key))
        if (dupes.length > 0) {
          suggestions.push({
            action: 'merge',
            primaryId: record.id,
            candidates: dupes.map(d => d.id),
            scope,
            reason: `Shares its first 20 characters with ${dupes.length} memories; consider distilling and merging.`,
            confidence: 0.6,
          })
        }
      }
    }
  }
  // Rule 3: never accessed with importance at least 0.7 suggests review.
  for (const record of active) {
    if (record.accessCount === 0 && record.importance >= 0.7) {
      suggestions.push({
        action: 'review',
        primaryId: record.id,
        candidates: [],
        scope: record.scope,
        reason: `Importance ${record.importance.toFixed(2)}, but never visited; it may be overlooked. Consider reviewing.`,
        confidence: 0.5,
      })
    }
  }
  // Rule 4: content longer than 400 characters suggests splitting.
  for (const record of active) {
    if (record.content.length > 400) {
      suggestions.push({
        action: 'split',
        primaryId: record.id,
        candidates: [],
        scope: record.scope,
        reason: `Content length ${record.content.length} > 400; consider splitting into independent memories.`,
        confidence: 0.6,
      })
    }
  }
  // Rule 5: missing placards or scores below 0.5 need unique, distinctive, date-anchored captions.
  for (const record of active) {
    const score = record.imageryScore
    if (score !== undefined && score >= 0.5) continue
    const slot = record.slot === undefined ? '' : `${record.slot.room}#${record.slot.index} `
    suggestions.push({
      action: 'review',
      primaryId: record.id,
      candidates: [],
      scope: record.scope,
      reason: score === undefined
        ? `${slot}Missing placard: every marker should be unique, distinctive, and date anchored. Add one using the placard parameter of engram_update.`
        : `${slot}Placard score ${score.toFixed(2)} < 0.5; rewrite it to be unique, distinctive, and date anchored.`,
      confidence: 0.4,
    })
  }
  return suggestions
}