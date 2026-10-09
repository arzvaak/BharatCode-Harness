/**
 * Aggregate recent operation metrics locally from op_log; no telemetry is sent externally.
 * Exposed through /api/engram/telemetry for the overview and activity-log panels.
 * @module @kenz1117/dsh-engram/telemetry/aggregate
 */

import type { EngramStore } from '../store/interface.ts'

/** Default aggregation window in days; routes may override it through a query parameter. */
const DEFAULT_WINDOW_DAYS = 7

/** Aggregated metric snapshot. */
export interface TelemetrySnapshot {
  readonly windowDays: number
  readonly sinceMs: number
  readonly untilMs: number
  readonly counts: {
    readonly ingestRequests: number
    readonly ingestDones: number
    readonly searches: number
    readonly writes: number
    readonly updates: number
    readonly forgets: number
    readonly restores: number
    readonly distillRequests: number
    readonly compressRequests: number
    readonly searchRewrites: number
    readonly consumptions: number
    readonly consolidations: number
  }
  /** Active memory counts and signal ratios for each scope. */
  readonly scopes: ReadonlyArray<{
    readonly scope: 'user' | 'project' | 'shared'
    readonly active: number
    readonly total: number
    readonly signalRatio: number
  }>
}

/** Count operations in one store within the requested time window. */
async function countByOp(store: EngramStore, sinceMs: number): Promise<Record<string, number>> {
  const ops = await store.recentOps(100_000)
  const counts: Record<string, number> = {}
  for (const op of ops) {
    if (op.at < sinceMs) continue
    counts[op.op] = (counts[op.op] ?? 0) + 1
  }
  return counts
}

/** Aggregate operation metrics and scope status across the selected stores.
 * @param scopeFilter - Restrict aggregation to one scope; undefined includes all three stores. */
export async function aggregateTelemetry(
  openStore: (scope: 'user' | 'project' | 'shared') => Promise<EngramStore>,
  windowDays: number = DEFAULT_WINDOW_DAYS,
  scopeFilter?: 'user' | 'project' | 'shared',
): Promise<TelemetrySnapshot> {
  const untilMs = Date.now()
  const sinceMs = untilMs - windowDays * 86_400_000
  const scopes: Array<'user' | 'project' | 'shared'> = scopeFilter !== undefined
    ? [scopeFilter]
    : ['user', 'project', 'shared']
  const countsAgg = {
    ingestRequests: 0, ingestDones: 0, searches: 0, writes: 0, updates: 0,
    forgets: 0, restores: 0, distillRequests: 0, compressRequests: 0,
    searchRewrites: 0, consumptions: 0, consolidations: 0,
  }
  // Build a mutable local array that satisfies the readonly TelemetrySnapshot['scopes'] result.
  type ScopeView = TelemetrySnapshot['scopes'][number]
  const scopeViews: ScopeView[] = []
  for (const scope of scopes) {
    try {
      const store = await openStore(scope)
      const [counts, stats] = await Promise.all([countByOp(store, sinceMs), store.stats()])
      countsAgg.ingestRequests += counts['ingest-request'] ?? 0
      countsAgg.ingestDones += counts['ingest-done'] ?? 0
      countsAgg.searches += counts['search-rewrite-request'] ?? 0
      countsAgg.writes += counts['write'] ?? 0
      countsAgg.updates += counts['update'] ?? 0
      countsAgg.forgets += counts['forget'] ?? 0
      countsAgg.restores += counts['restore'] ?? 0
      countsAgg.distillRequests += counts['distill-request'] ?? 0
      countsAgg.compressRequests += counts['compress-request'] ?? 0
      countsAgg.searchRewrites += counts['search-rewrite-request'] ?? 0
      countsAgg.consumptions += (counts['outcome-report'] ?? 0)
      countsAgg.consolidations += counts['consolidation'] ?? 0
      scopeViews.push({ scope, active: stats.active, total: stats.total, signalRatio: stats.signalRatio })
    } catch {
      // A shared store may not exist yet; skip it without affecting other scopes.
    }
  }
  return {
    windowDays,
    sinceMs,
    untilMs,
    counts: countsAgg,
    scopes: scopeViews,
  }
}
