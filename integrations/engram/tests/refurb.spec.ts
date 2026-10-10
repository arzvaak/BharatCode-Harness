/**
 * Refurb list scan: the minActive early exit and the rule hits (demote / split / placard review).
 * Only the fields the scan actually reads are set; the rest fall back to MemoryRecord test-double defaults.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_REFURB_OPTIONS, gatherRefurbSuggestions } from '../src/refurb.ts'
import type { EngramKind, MemoryRecord } from '../src/types.ts'

/** An active memory test double: by default triggers no rule (placard present, recently accessed, short content). */
function memory(id: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: id as unknown as MemoryRecord['id'],
    scope: 'user',
    kind: 'fact' as EngramKind,
    content: `memory ${id}`,
    importance: 0.5,
    confidence: 0.8,
    status: 'active',
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    accessCount: 2,
    sourceSessionId: null,
    sourceRound: null,
    sourceSeq: null,
    imageryScore: 0.9,
    ...overrides,
  }
}

/** A set of memories that trigger no rule, enough to reach minActive. */
function fillers(count: number): MemoryRecord[] {
  return Array.from({ length: count }, (_, index) => memory(`f${String(index)}`))
}

describe('refurb list scan', () => {
  it('produces no suggestions when active count is below minActive (small-store noise guard)', () => {
    // These entries would hit the placard discipline rule if scanned — after the early exit the result must be empty, which is what gives the test its discriminating power.
    const small = Array.from(
      { length: DEFAULT_REFURB_OPTIONS.minActive - 1 },
      (_, index) => memory(`m${String(index)}`, { imageryScore: 0.2 }),
    )
    expect(gatherRefurbSuggestions(small)).toHaveLength(0)
  })

  it('reaches minActive and suggests a placard per entry under the placard discipline', () => {
    const records = Array.from(
      { length: DEFAULT_REFURB_OPTIONS.minActive },
      (_, index) => memory(`m${String(index)}`, { imageryScore: 0.2 }),
    )
    const suggestions = gatherRefurbSuggestions(records)
    expect(suggestions).toHaveLength(DEFAULT_REFURB_OPTIONS.minActive)
    expect(suggestions.every(suggestion => suggestion.action === 'review')).toBe(true)
  })

  it('suggests demotion for a low-importance entry long unaccessed', () => {
    const stale = memory('old', { importance: 0.1, lastAccessedAt: Date.now() - 200 * 86_400_000 })
    const suggestions = gatherRefurbSuggestions([stale, ...fillers(DEFAULT_REFURB_OPTIONS.minActive - 1)])
    expect(suggestions.map(suggestion => suggestion.action)).toEqual(['demote'])
    expect(suggestions[0]?.primaryId).toBe('old')
  })

  it('suggests splitting overlong content and reviewing a high-importance entry never accessed', () => {
    const long = memory('long', { content: 'x'.repeat(401) })
    const buried = memory('buried', { importance: 0.8, accessCount: 0 })
    const suggestions = gatherRefurbSuggestions([long, buried, ...fillers(DEFAULT_REFURB_OPTIONS.minActive - 2)])
    expect(suggestions.map(suggestion => suggestion.action).sort()).toEqual(['review', 'split'])
  })
})
