import { describe, expect, it } from 'vitest'
import {
  MAX_REWRITE_QUERIES, RRF_CONSTANT,
  mergeQueryResults, normalizeRewriteQueries,
} from '../src/retrieve/rewrite.ts'
import { asMemoryId } from '../src/types.ts'
import type { MemoryRecord, SearchHit } from '../src/types.ts'

/** Build a minimal MemoryRecord (fusion only reads the id). */
const record = (id: string): MemoryRecord => ({
  id: asMemoryId(id),
  scope: 'user',
  kind: 'fact',
  content: `content ${id}`,
  importance: 0.5,
  confidence: 0.5,
  status: 'active',
  createdAt: 0,
  lastAccessedAt: 0,
  accessCount: 0,
  sourceSessionId: null,
  sourceRound: null,
  sourceSeq: null,
})

const hit = (id: string, score = 1): SearchHit => ({ record: record(id), score, via: 'fts' })

describe('normalizeRewriteQueries', () => {
  it('accepts a string array and dedupes case-insensitively', () => {
    // Chinese fixtures are intentional: the behavior under test (whitespace collapse, case-insensitive dedupe, 500-char truncation) is script-independent.
    expect(normalizeRewriteQueries(['用户偏好', '用户 偏好', ' 用户偏好 '], 3)).toEqual(['用户偏好', '用户 偏好'])
  })

  it('accepts a single string input', () => {
    // Chinese fixture is intentional non-English test data (behavior under test is script-independent).
    expect(normalizeRewriteQueries('原始查询', 3)).toEqual(['原始查询'])
  })

  it('filters invalid items and truncates to the limit', () => {
    const items = ['a', 42, null, 'b', 'c', 'd', 'e']
    expect(normalizeRewriteQueries(items, MAX_REWRITE_QUERIES)).toEqual(['a', 'b', 'c'])
  })

  it('collapses whitespace, truncates to 500 chars, drops empty items', () => {
    const long = `${'x'.repeat(600)} y`
    const result = normalizeRewriteQueries([long, '   '], 3)
    expect(result[0]).toHaveLength(500)
    expect(result[0]).not.toContain(' y')
    expect(result).toHaveLength(1)
  })

  it('returns an empty array for non-string, non-array input', () => {
    expect(normalizeRewriteQueries(undefined, 3)).toEqual([])
    expect(normalizeRewriteQueries({ query: 'x' }, 3)).toEqual([])
  })
})

describe('mergeQueryResults', () => {
  it('accumulates RRF score across queries and ranks it first', () => {
    // a is rank 1 in both queries: 2/(60+1); b and c each appear in only one query.
    const merged = mergeQueryResults(
      [{ hits: [hit('a'), hit('b')] }, { hits: [hit('a'), hit('c')] }],
      8, RRF_CONSTANT, 1,
    )
    expect(merged[0]!.record.id).toBe('a')
    expect(merged).toHaveLength(3)
  })

  it('ties on fused score break by first rank, then first query index (stable)', () => {
    // b is rank 2 only in query 1, c is rank 2 only in query 2: both score 1/62, b has the smaller firstQueryIndex.
    const merged = mergeQueryResults(
      [{ hits: [hit('a'), hit('b')] }, { hits: [hit('a'), hit('c')] }],
      8, RRF_CONSTANT, 0,
    )
    expect(merged.map(h => h.record.id)).toEqual(['a', 'b', 'c'])
  })

  it('per-query floor hits are placed at the front of the results', () => {
    // d, rank 1 of query 2, has a lower fused score than a, but as a floor hit (minPerQuery=1) it is placed before a.
    const merged = mergeQueryResults(
      [{ hits: [hit('a'), hit('b'), hit('c')] }, { hits: [hit('d'), hit('e')] }],
      8, RRF_CONSTANT, 1,
    )
    expect(merged.slice(0, 2).map(h => h.record.id)).toEqual(['a', 'd'])
  })

  it('limit truncates the final results', () => {
    const merged = mergeQueryResults(
      [{ hits: [hit('a'), hit('b'), hit('c')] }, { hits: [hit('d'), hit('e')] }],
      3, RRF_CONSTANT, 1,
    )
    expect(merged).toHaveLength(3)
  })

  it('empty retrievals return an empty list', () => {
    expect(mergeQueryResults([], 8, RRF_CONSTANT, 1)).toEqual([])
    expect(mergeQueryResults([{ hits: [] }], 8, RRF_CONSTANT, 1)).toEqual([])
  })
})
