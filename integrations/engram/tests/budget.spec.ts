import { describe, expect, it } from 'vitest'
import { RECALL_PER_ITEM_CHARS, RECALL_TOTAL_CHARS, enforceBudget, truncateItem } from '../src/retrieve/budget.ts'

describe('truncateItem single-item truncation', () => {
  it('returns short text unchanged', () => {
    // Intentionally non-English test data: a short CJK string only verifies length-based behavior.
    expect(truncateItem('短条目')).toBe('短条目')
    expect(truncateItem('a'.repeat(RECALL_PER_ITEM_CHARS))).toBe('a'.repeat(RECALL_PER_ITEM_CHARS))
  })

  it('truncates over-length text and appends an ellipsis', () => {
    // Intentionally non-English test data: repeated CJK characters exercise over-length truncation.
    const text = '长'.repeat(RECALL_PER_ITEM_CHARS + 100)
    const out = truncateItem(text)
    expect(out).toHaveLength(RECALL_PER_ITEM_CHARS + 1)
    expect(out.endsWith('…')).toBe(true)
  })

  it('honors a custom limit', () => {
    expect(truncateItem('abcdef', 3)).toBe('abc…')
  })
})

describe('enforceBudget total-budget filling', () => {
  it('returns lines unchanged in order when everything fits', () => {
    const lines = ['第一行', '第二行', '第三行']
    expect(enforceBudget(lines, 100)).toEqual(lines)
  })

  it('skips lines that do not fit and counts them, appending a notice line at the end', () => {
    const lines = ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)]
    const out = enforceBudget(lines, 90)
    expect(out).toEqual([lines[0], `(2 additional memories not shown: narrow the query or reduce limit and retry)`])
  })

  it('continues trying shorter later lines when one does not fit', () => {
    const lines = ['x'.repeat(90), '短行', 'y'.repeat(90)]
    const out = enforceBudget(lines, 100)
    expect(out).toEqual([lines[0], '短行', `(1 additional memories not shown: narrow the query or reduce limit and retry)`])
  })

  it('returns an empty array for empty input (no notice line)', () => {
    expect(enforceBudget([], 100)).toEqual([])
  })

  it('uses the protocol-defined default budgets', () => {
    expect(RECALL_TOTAL_CHARS).toBe(4800)
    expect(RECALL_PER_ITEM_CHARS).toBe(1200)
  })
})
