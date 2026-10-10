/**
 * Enhance retrieval with up to three complementary queries rewritten by an auxiliary LLM.
 * Fuse rankings across queries with Reciprocal Rank Fusion and reserve hits per query.
 * Rewriting is optional: unavailable or failed LLM calls fall back to the original query.
 * @module @kenz1117/dsh-engram/retrieve/rewrite
 */

import type { SearchHit } from '../types.ts'

/** Query cap bounds retrieval and reinforcement cost as marginal gains diminish. */
export const MAX_REWRITE_QUERIES = 3

/** Cross-query RRF constant, matching the scale of within-query channel fusion. */
export const RRF_CONSTANT = 60

/** Output token limit sufficient for three short queries. */
export const REWRITE_MAX_TOKENS = 200

/** Rewrite instructions require a JSON string array, not an answer to the query. */
export const REWRITE_SYSTEM = [
  `Rewrite the retrieval query into at most ${MAX_REWRITE_QUERIES} complementary search queries using synonyms, broader or narrower concepts, and alternative wording for semantic-plus-keyword search over long-term memories.`,
  'Output only a JSON string array, with no additional text. If no improvement is possible, return an array containing only the original query.',
].join('\n')

/**
 * Accept a string or array, normalize to single lines, truncate to 500 characters,
 * deduplicate case-insensitively, cap at maxQueries, and discard invalid entries.
 * @param value - Parsed model JSON output.
 * @param maxQueries - Maximum number of queries.
 * @returns Normalized queries; an empty result triggers original-query fallback.
 */
export function normalizeRewriteQueries(value: unknown, maxQueries: number): string[] {
  const items = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const queries: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    const query = item.replace(/\s+/gu, ' ').trim().slice(0, 500)
    if (query === '') continue
    const key = query.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queries.push(query)
    if (queries.length >= maxQueries) break
  }
  return queries
}

/**
 * Fuse cross-query ranks with contributions of 1/(rank+1+K), summed per memory.
 * Sort stably by fused score, best rank, and earliest query index; reserve each query
 * a bounded number of top hits at the front of the final results.
 * @param retrievals - Query results, each sorted by its own score.
 * @param limit - Maximum final result count.
 * @param rrfConstant - RRF smoothing constant.
 * @param minPerQuery - Desired reserved hits per query, bounded by the shared limit.
 * @returns Fused results retaining original hit objects.
 */
export function mergeQueryResults(
  retrievals: readonly { hits: readonly SearchHit[] }[],
  limit: number,
  rrfConstant: number,
  minPerQuery: number,
): SearchHit[] {
  const entries = new Map<string, { hit: SearchHit; score: number; firstRank: number; firstQueryIndex: number }>()
  for (const [queryIndex, retrieval] of retrievals.entries()) {
    for (const [rank, hit] of retrieval.hits.entries()) {
      const key = hit.record.id
      const add = 1 / (rank + 1 + rrfConstant)
      const existing = entries.get(key)
      if (existing === undefined) {
        entries.set(key, { hit, score: add, firstRank: rank, firstQueryIndex: queryIndex })
        continue
      }
      existing.score += add
      existing.firstRank = Math.min(existing.firstRank, rank)
      existing.firstQueryIndex = Math.min(existing.firstQueryIndex, queryIndex)
      // For repeated memories, preserve the hit with the best original score and via metadata.
      if (hit.score > existing.hit.score) existing.hit = hit
    }
  }
  const ranked = [...entries.values()].sort((a, b) =>
    b.score - a.score || a.firstRank - b.firstRank || a.firstQueryIndex - b.firstQueryIndex)
  const perQueryKeep = Math.min(minPerQuery, Math.max(1, Math.floor(Math.max(0, limit) / Math.max(1, retrievals.length))))
  const reserved = new Set(retrievals.flatMap(retrieval =>
    retrieval.hits.slice(0, perQueryKeep).map(hit => hit.record.id)))
  return [
    ...ranked.filter(entry => reserved.has(entry.hit.record.id)),
    ...ranked.filter(entry => !reserved.has(entry.hit.record.id)),
  ]
    .slice(0, Math.max(0, limit))
    .map(entry => entry.hit)
}
