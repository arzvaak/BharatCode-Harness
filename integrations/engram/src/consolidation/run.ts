/**
 * Background consolidation inspects memories after sessions or on scheduled triggers.
 * Retire stale low-priority active records and merge similar records of the same kind,
 * retaining supersedes links and source-record history.
 *
 * Without embeddings use retirement and prefix heuristics; with embeddings use cosine
 * similarity at the configured threshold. Record a summary in op_log for auditing.
 *
 * @module @kenz1117/dsh-engram/consolidation/run
 */

import type { EngramEmbedder } from '../embedder/interface.ts'
import type { EngramStore } from '../store/interface.ts'
import type { MemoryRecord } from '../types.ts'

/** Shared operation-log marker for consolidation. */
const CONSOLIDATION_OP = 'consolidation'

/** Consolidation settings; defaults use thirty days and importance below 0.3. */
export interface ConsolidateOptions {
  readonly olderThanDays?: number
  readonly importanceBelow?: number
  /** Cosine merge threshold from 0 to 1 when embeddings are available. */
  readonly mergeThreshold?: number
  /** Scope defaults to user for backward compatibility. */
  /** Host unload cancels background work before SQLite is closed. */
  readonly signal?: AbortSignal
  readonly scope?: 'user' | 'project' | 'shared'
  /**
   * Optional seed identifiers for the merge phase; omitted means scan the entire scope.
   * Controls phase two only; phase-one retirement still scans all records.
   * Same-kind candidates outside the seed set may be considered for merging.
   */
  readonly mergeCandidateIds?: readonly string[]
}

/** Consolidation summary returned to callers and recorded in the operation log. */
export interface ConsolidateReport {
  readonly archived: number
  readonly merged: number
  readonly skipped: number
  readonly tookMs: number
}

/** Default parameters. */
const DEFAULTS: Required<Omit<ConsolidateOptions, 'scope' | 'mergeCandidateIds' | 'signal'>> = {
  olderThanDays: 30,
  importanceBelow: 0.3,
  mergeThreshold: 0.92,
}

/** Stop waiting for model loading or inference when the plugin unloads. */
async function whileActive<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return pending
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Asynchronous consolidation; individual operation failures contribute to skipped counts. */
export async function runConsolidation(
  store: EngramStore,
  embedder: Promise<EngramEmbedder | undefined>,
  opts: ConsolidateOptions = {},
): Promise<ConsolidateReport> {
  const start = Date.now()
  const options = { ...DEFAULTS, ...opts }
  const scope: 'user' | 'project' | 'shared' = options.scope ?? 'user'
  options.signal?.throwIfAborted()
  const stats = await store.stats()
  options.signal?.throwIfAborted()
  const records = await store.topActive(scope, Math.max(stats.active, 0))
  options.signal?.throwIfAborted()
  const archivedIds = new Set<string>()
  let archived = 0
  let merged = 0
  let skipped = 0
  const now = Date.now()
  const ageCutoff = options.olderThanDays * 86_400_000

  // Phase 1: retire low-priority stale records.
  for (const record of records) {
    options.signal?.throwIfAborted()
    if (record.importance >= options.importanceBelow) continue
    // Use creation age and decayed confidence as the low-access proxy.
    // Retire only after ageCutoff and when confidence is below 0.3.
    if (now - record.createdAt < ageCutoff) continue
    if (record.confidence >= 0.3) continue
    try {
      await store.forget(record.id)
      archivedIds.add(record.id)
      archived += 1
    } catch {
      skipped += 1
    }
  }

  // Phase 2: compare similar records within kind buckets.
  // Optional mergeCandidateIds define seed records for comparisons.
  const emb = await whileActive(embedder, options.signal)
  options.signal?.throwIfAborted()
  const buckets = new Map<string, MemoryRecord[]>()
  for (const record of records) {
    options.signal?.throwIfAborted()
    if (archivedIds.has(record.id)) continue
    const list = buckets.get(record.kind) ?? []
    list.push(record)
    buckets.set(record.kind, list)
  }
  const seedIds = options.mergeCandidateIds !== undefined
    ? new Set(options.mergeCandidateIds)
    : null
  for (const list of buckets.values()) {
    options.signal?.throwIfAborted()
    if (list.length < 2) continue
    // In restricted mode, skip buckets with no seed record.
    if (seedIds !== null && !list.some(record => seedIds.has(record.id))) continue
    if (emb === undefined) {
      // Without embeddings, compare identical sixty-character prefixes.
      // A more important current record supersedes the existing record; otherwise retain it.
      const seen = new Map<string, MemoryRecord>()
      for (const record of list) {
        options.signal?.throwIfAborted()
        const key = record.content.slice(0, 60)
        const existing = seen.get(key)
        if (existing === undefined) {
          seen.set(key, record)
        } else if (record.importance > existing.importance) {
          await store.supersedeMany(
            { scope, kind: record.kind, content: record.content, importance: record.importance, confidence: record.confidence },
            [existing.id],
          ).catch(() => { skipped += 1 })
          merged += 1
          seen.set(key, record)
        }
        // Keep the existing winner unchanged.
      }
      continue
    }
    // With embeddings, merge pairs meeting the cosine threshold.
    // Restricted mode starts from seeds and considers related records within the bucket.
    const vectors = new Map<string, Float32Array>()
    for (const record of list) {
      options.signal?.throwIfAborted()
      // In restricted mode, calculate vectors only for seed identifiers.
      if (seedIds !== null && !seedIds.has(record.id)) continue
      try {
        const vec = (await whileActive(emb.embed([record.content]), options.signal))[0]
        options.signal?.throwIfAborted()
        if (vec !== undefined) vectors.set(record.id, vec)
      } catch {
        skipped += 1
      }
    }
    const arr = list.filter(record => vectors.has(record.id))
    const visited = new Set<string>()
    for (let i = 0; i < arr.length; i += 1) {
      options.signal?.throwIfAborted()
      const a = arr[i]!
      if (visited.has(a.id)) continue
      const dupes: MemoryRecord[] = []
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]!
        if (visited.has(b.id)) continue
        // A restricted-mode candidate must have a comparable vector.
        const bVec = vectors.get(b.id)
        if (bVec === undefined) continue
        const sim = cosine(vectors.get(a.id)!, bVec)
        if (sim >= options.mergeThreshold) dupes.push(b)
      }
      if (dupes.length === 0) continue
      const ids = dupes.map(record => record.id)
      try {
        await store.supersedeMany(
          { scope, kind: a.kind, content: a.content, importance: a.importance, confidence: a.confidence },
          ids,
        )
        for (const id of ids) visited.add(id)
        visited.add(a.id)
        merged += 1
      } catch {
        skipped += 1
      }
    }
  }

  // Phase 3: audit duration and archived, merged, and skipped counts.
  options.signal?.throwIfAborted()
  const report: ConsolidateReport = { archived, merged, skipped, tookMs: Date.now() - start }
  try {
    await store.audit(
      CONSOLIDATION_OP,
      'AUX',
      JSON.stringify({ scope, archived: report.archived, merged: report.merged, skipped: report.skipped, tookMs: report.tookMs }),
    )
  } catch {
    /* An audit failure does not change the consolidation result. */
  }
  return report
}

/** Cosine similarity; mismatched dimensions and zero vectors return zero. */
function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
