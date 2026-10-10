/**
 * Plugin Config: all deployment-variable items are centralized here; embedding defaults in the implementation is forbidden.
 * @module @kenz1117/dsh-engram/config
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'

/** Legacy store migration policy: default is automatic migration; can be set to keep the old store pending manual confirmation. */
export type LegacyMigrationPolicy = 'eager' | 'conservative'

/** Auto-ingest tier: off disables; light reads user messages only (≤2 per turn); eager reads user + assistant messages (≤5 per turn). */
export type IngestModeConfig = 'off' | 'light' | 'eager'

/** Belief consolidation tier: off allows only manual engram_reflect; suggest registers pending consolidation at session end; auto consolidates automatically after session end. */
export type ReflectModeConfig = 'off' | 'suggest' | 'auto'

/** Jev System One model sub-config: auto-adjudication of the DEFER ambiguous band and contradiction edge confirmation; when disabled by default, four-way judgment stays pure-rule. */
export interface JevConfig {
  /** Whether to enable Jev adjudication; defaults to false. When explicitly true, apiKey is required; a missing one errors at load time. */
  enabled?: boolean
  /** Jev API key (Bearer authentication). */
  apiKey?: string
  /** Jev API endpoint root URL; defaults to https://api.typesafe.ai. */
  baseUrl?: string
  /** Jev model name; defaults to jev-latest. */
  model?: string
  /** Timeout in ms for a single adjudication request; defaults to 3000. */
  timeoutMs?: number
  /** Ambiguous-band adjudication: when the Noul probability exceeds this value, judged "same entry" and auto-merged; defaults to 0.85. */
  deferMergeAbove?: number
  /** Ambiguous-band adjudication: when the Noul probability is below this value, judged "different entries" and accept passes through; defaults to 0.15. */
  deferAcceptBelow?: number
  /** Contradiction confirmation: the contradicts edge is created only when the Noul probability reaches this value; below it, edge creation is abandoned; defaults to 0.8. */
  contradictMinProbability?: number
}

/** Plugin configuration. */
export interface EngramConfig {
  /** Root directory for the two SQLite substores and the embedding model cache; defaults to `~/.dsh/engram`. */
  dbDir?: string
  /** Legacy store migration policy: default eager auto-migrates; conservative keeps the old store pending manual confirmation. */
  legacyMigration?: LegacyMigrationPolicy
  /** Whether to inject a user-level profile summary at session start; defaults to true. */
  injectProfile?: boolean
  /** Max number of profile entries to inject; defaults to 8. */
  profileTopN?: number
  /** Embedding model cache directory; defaults to `<dbDir>/models`. */
  modelCacheDir?: string
  /** Embedding model download endpoint; defaults to huggingface.co — configure a mirror in network-restricted environments (e.g. https://hf-mirror.com). */
  hfEndpoint?: string
  /** Auto-ingest tier; defaults to off (only writes to the store when explicitly enabled). */
  ingest?: IngestModeConfig
  /** Belief auto-consolidation tier; defaults to off. suggest/auto trigger after session end, reusing the provider/model auxiliary route. */
  reflect?: ReflectModeConfig
  /** The provider for the distill/ingest override route; must be provided together with model. */
  provider?: string
  /** The model for the distill/ingest override route; must be provided together with provider. */
  model?: string
  /** Decay: only archivable when the last access is older than this many days; defaults to 30. */
  decayAfterDays?: number
  /** Decay: only archivable when importance is below this value; defaults to 0.3. */
  decayImportanceBelow?: number
  /** Token budget for profile injection (estimated as ceil(len/4)); defaults to 1024. */
  injectTokenBudget?: number
  /** Profile graduated-decay budget: character count of the first entry's body; defaults to 160. */
  injectItemBudgetStart?: number
  /** Profile graduated-decay budget: per-entry decay factor (0.5-1); defaults to 0.9. */
  injectItemBudgetDecay?: number
  /** Profile graduated-decay budget: per-entry body character floor; defaults to 24. */
  injectItemBudgetFloor?: number
  /** Evidence-gate closing reminder: when the session has unassessed retrieval batches, inject a reminder before the next step starts; defaults to true. */
  assessReminder?: boolean
  /** Retrieval ranking recency factor weight (0 disables); defaults to 0.2. */
  rankRecencyWeight?: number
  /** Retrieval ranking proof factor weight (0 disables); defaults to 0.1. */
  rankProofWeight?: number
  /** Whether engram_search uses the auxiliary LLM to rewrite the query into ≤3 complementary queries before RRF fusion; defaults to true. A rewrite failure auto-degrades to a single query. */
  queryRewrite?: boolean
  /** Whether to auto-slot (room + slot number) at write time and register the fixed tour route; defaults to true. When false, slots/routes are fully specified explicitly by the caller. */
  autoSlot?: boolean
  /** Whether new memories enter the SM-2 spaced repetition schedule (first due after 1 day); defaults to true. When false, the review queue is always empty and decay behavior matches the old version. */
  reviewScheduling?: boolean
  /** History backfill default rule: time window in days, 0 = unlimited; defaults to 7. */
  historyBackfillDays?: number
  /** History backfill default rule: max turns to ingest per session; defaults to 20. */
  historyBackfillMaxTurnsPerSession?: number
  /** History backfill cap: hard cap on total turns per run (panel/tool parameters can only lower it); defaults to 200. */
  historyBackfillMaxTotalTurns?: number
  /** History backfill default rule: whether to include subagent sessions (origin=subagent); defaults to false. */
  historyBackfillIncludeSubagents?: boolean
  /** History backfill default rule: whether to include seeded sessions (isSeeded); defaults to false. */
  historyBackfillIncludeSeeded?: boolean
  /** History backfill default rule: whether to include no-cwd sessions (cannot be attributed to a project substore); defaults to false. */
  historyBackfillIncludeNoCwd?: boolean
  /** Jev System One adjudication sub-config; disabled by default (pure-rule four-way judgment, behavior matches the old version). */
  jev?: JevConfig
}

/** History backfill rules (panel/tools can adjust per run on top of the defaults; total turns are bounded by the hard cap). */
export interface ResolvedHistoryRules {
  /** Time window in days; 0 = unlimited. */
  readonly days: number
  /** Max turns to ingest per session. */
  readonly maxTurnsPerSession: number
  /** Hard cap on total turns per run. */
  readonly maxTotalTurns: number
  /** Whether to include subagent sessions. */
  readonly includeSubagents: boolean
  /** Whether to include seeded sessions. */
  readonly includeSeeded: boolean
  /** Whether to include no-cwd sessions. */
  readonly includeNoCwd: boolean
}

/** Resolved Jev sub-config (defaults applied; the implementation no longer null-checks). */
export interface ResolvedJevConfig {
  readonly enabled: boolean
  readonly apiKey: string | undefined
  readonly baseUrl: string
  readonly model: string
  readonly timeoutMs: number
  readonly deferMergeAbove: number
  readonly deferAcceptBelow: number
  readonly contradictMinProbability: number
}

/** Resolved complete config (explicit defaults are centralized in this single step; the implementation no longer does `?? default`). */
export interface ResolvedEngramConfig {
  readonly dbDir: string
  readonly legacyMigration: LegacyMigrationPolicy
  readonly injectProfile: boolean
  readonly profileTopN: number
  readonly modelCacheDir: string
  readonly hfEndpoint: string | undefined
  readonly ingest: IngestModeConfig
  readonly reflect: ReflectModeConfig
  /** Route override after pair validation; undefined = resolve the route from the session log. */
  readonly routeOverride: { readonly provider: string; readonly model: string } | undefined
  readonly decayAfterDays: number
  readonly decayImportanceBelow: number
  readonly injectTokenBudget: number
  readonly injectItemBudgetStart: number
  readonly injectItemBudgetDecay: number
  readonly injectItemBudgetFloor: number
  readonly assessReminder: boolean
  readonly rankRecencyWeight: number
  readonly rankProofWeight: number
  readonly queryRewrite: boolean
  readonly autoSlot: boolean
  readonly reviewScheduling: boolean
  /** History backfill default rules (one-shot/on-demand backfill of historical sessions → the memory palace). */
  readonly historyBackfill: ResolvedHistoryRules
  /** Jev System One adjudication sub-config (disabled by default). */
  readonly jev: ResolvedJevConfig
}

/** Set of legal config keys (unknown keys fail loudly). */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'legacyMigration', 'dbDir', 'injectProfile', 'profileTopN', 'modelCacheDir', 'hfEndpoint',
  'ingest', 'reflect', 'provider', 'model', 'decayAfterDays', 'decayImportanceBelow',
  'injectTokenBudget', 'injectItemBudgetStart', 'injectItemBudgetDecay', 'injectItemBudgetFloor',
  'rankRecencyWeight', 'rankProofWeight', 'queryRewrite',
  'autoSlot', 'reviewScheduling', 'assessReminder',
  'historyBackfillDays', 'historyBackfillMaxTurnsPerSession', 'historyBackfillMaxTotalTurns',
  'historyBackfillIncludeSubagents', 'historyBackfillIncludeSeeded', 'historyBackfillIncludeNoCwd',
  'jev',
])

const INGEST_MODES: ReadonlySet<string> = new Set(['off', 'light', 'eager'])
const REFLECT_MODES: ReadonlySet<string> = new Set(['off', 'suggest', 'auto'])

/** Schemastery validation surface (validated when cordis.yml is read). */
export const Config: z<EngramConfig> = z.object({
  dbDir: z.string(),
  legacyMigration: z.string() as unknown as z<LegacyMigrationPolicy>,
  injectProfile: z.boolean(),
  profileTopN: z.number().step(1).min(1).max(64),
  modelCacheDir: z.string(),
  hfEndpoint: z.string(),
  ingest: z.string() as unknown as z<IngestModeConfig>,
  reflect: z.string() as unknown as z<ReflectModeConfig>,
  provider: z.string(),
  model: z.string(),
  decayAfterDays: z.number().step(1).min(1).max(3650),
  decayImportanceBelow: z.number().min(0).max(1),
  injectTokenBudget: z.number().step(1).min(128).max(8192),
  injectItemBudgetStart: z.number().step(1).min(40).max(2000),
  injectItemBudgetDecay: z.number().min(0.5).max(1),
  injectItemBudgetFloor: z.number().step(1).min(8).max(200),
  rankRecencyWeight: z.number().min(0).max(2),
  rankProofWeight: z.number().min(0).max(2),
  queryRewrite: z.boolean(),
  autoSlot: z.boolean(),
  reviewScheduling: z.boolean(),
  assessReminder: z.boolean(),
  historyBackfillDays: z.number().step(1).min(0).max(3650),
  historyBackfillMaxTurnsPerSession: z.number().step(1).min(1).max(500),
  historyBackfillMaxTotalTurns: z.number().step(1).min(1).max(5000),
  historyBackfillIncludeSubagents: z.boolean(),
  historyBackfillIncludeSeeded: z.boolean(),
  historyBackfillIncludeNoCwd: z.boolean(),
  jev: z.object({
    enabled: z.boolean(),
    apiKey: z.string(),
    baseUrl: z.string(),
    model: z.string(),
    timeoutMs: z.number().step(1).min(1000).max(60000),
    deferMergeAbove: z.number().min(0.5).max(1),
    deferAcceptBelow: z.number().min(0).max(0.5),
    contradictMinProbability: z.number().min(0.5).max(1),
  }) as unknown as z<JevConfig>,
})

/**
 * Explicit resolve step: defaults land only in this single place; illegal values fail loudly.
 * @param config - The unvalidated config passed from cordis.yml.
 * @returns The fully resolved config.
 * @throws Errors on unknown keys, an invalid ingest tier, providing only one of provider/model, or decay/budget/ranking-weight/history-backfill rules out of range.
 */
export function resolveConfig(config: EngramConfig = {}): ResolvedEngramConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`dsh-engram: unknown config key "${key}"`)
  }
  if (config.legacyMigration !== undefined && config.legacyMigration !== 'eager' && config.legacyMigration !== 'conservative') {
    throw new Error('dsh-engram: legacyMigration must be one of eager|conservative')
  }
  if (config.ingest !== undefined && !INGEST_MODES.has(config.ingest)) {
    throw new Error(`dsh-engram: ingest must be one of off|light|eager, got "${String(config.ingest)}"`)
  }
  if (config.reflect !== undefined && !REFLECT_MODES.has(config.reflect)) {
    throw new Error(`dsh-engram: reflect must be one of off|suggest|auto, got "${String(config.reflect)}"`)
  }
  if (config.profileTopN !== undefined && (!Number.isInteger(config.profileTopN) || config.profileTopN < 1 || config.profileTopN > 64)) {
    throw new Error('dsh-engram: profileTopN must be an integer in [1, 64]')
  }
  const hasProvider = config.provider !== undefined
  const hasModel = config.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('dsh-engram: provider and model must be supplied together')
  }
  if (config.decayAfterDays !== undefined && (!Number.isInteger(config.decayAfterDays) || config.decayAfterDays < 1 || config.decayAfterDays > 3650)) {
    throw new Error('dsh-engram: decayAfterDays must be an integer in [1, 3650]')
  }
  if (config.decayImportanceBelow !== undefined && (config.decayImportanceBelow < 0 || config.decayImportanceBelow > 1)) {
    throw new Error('dsh-engram: decayImportanceBelow must be in [0, 1]')
  }
  if (config.injectTokenBudget !== undefined && (!Number.isInteger(config.injectTokenBudget) || config.injectTokenBudget < 128 || config.injectTokenBudget > 8192)) {
    throw new Error('dsh-engram: injectTokenBudget must be an integer in [128, 8192]')
  }
  if (config.injectItemBudgetStart !== undefined
    && (!Number.isInteger(config.injectItemBudgetStart) || config.injectItemBudgetStart < 40 || config.injectItemBudgetStart > 2000)) {
    throw new Error('dsh-engram: injectItemBudgetStart must be an integer in [40, 2000]')
  }
  if (config.injectItemBudgetDecay !== undefined && (config.injectItemBudgetDecay < 0.5 || config.injectItemBudgetDecay > 1)) {
    throw new Error('dsh-engram: injectItemBudgetDecay must be in [0.5, 1]')
  }
  if (config.injectItemBudgetFloor !== undefined
    && (!Number.isInteger(config.injectItemBudgetFloor) || config.injectItemBudgetFloor < 8 || config.injectItemBudgetFloor > 200)) {
    throw new Error('dsh-engram: injectItemBudgetFloor must be an integer in [8, 200]')
  }
  if (config.injectItemBudgetStart !== undefined && config.injectItemBudgetFloor !== undefined
    && config.injectItemBudgetFloor > config.injectItemBudgetStart) {
    throw new Error('dsh-engram: injectItemBudgetFloor must not exceed injectItemBudgetStart')
  }
  if (config.assessReminder !== undefined && typeof config.assessReminder !== 'boolean') {
    throw new Error('dsh-engram: assessReminder must be a boolean')
  }
  if (config.rankRecencyWeight !== undefined && (config.rankRecencyWeight < 0 || config.rankRecencyWeight > 2)) {
    throw new Error('dsh-engram: rankRecencyWeight must be in [0, 2]')
  }
  if (config.rankProofWeight !== undefined && (config.rankProofWeight < 0 || config.rankProofWeight > 2)) {
    throw new Error('dsh-engram: rankProofWeight must be in [0, 2]')
  }
  if (config.historyBackfillDays !== undefined && (!Number.isInteger(config.historyBackfillDays) || config.historyBackfillDays < 0 || config.historyBackfillDays > 3650)) {
    throw new Error('dsh-engram: historyBackfillDays must be an integer in [0, 3650] (0 = unlimited)')
  }
  if (config.historyBackfillMaxTurnsPerSession !== undefined
    && (!Number.isInteger(config.historyBackfillMaxTurnsPerSession) || config.historyBackfillMaxTurnsPerSession < 1 || config.historyBackfillMaxTurnsPerSession > 500)) {
    throw new Error('dsh-engram: historyBackfillMaxTurnsPerSession must be an integer in [1, 500]')
  }
  if (config.historyBackfillMaxTotalTurns !== undefined
    && (!Number.isInteger(config.historyBackfillMaxTotalTurns) || config.historyBackfillMaxTotalTurns < 1 || config.historyBackfillMaxTotalTurns > 5000)) {
    throw new Error('dsh-engram: historyBackfillMaxTotalTurns must be an integer in [1, 5000]')
  }
  const jev = config.jev
  if (jev !== undefined) {
    if (jev.enabled !== undefined && typeof jev.enabled !== 'boolean') {
      throw new Error('dsh-engram: jev.enabled must be a boolean')
    }
    if (jev.enabled === true && (jev.apiKey === undefined || jev.apiKey === '')) {
      throw new Error('dsh-engram: jev.enabled=true requires jev.apiKey')
    }
    if (jev.timeoutMs !== undefined && (!Number.isInteger(jev.timeoutMs) || jev.timeoutMs < 1000 || jev.timeoutMs > 60000)) {
      throw new Error('dsh-engram: jev.timeoutMs must be an integer in [1000, 60000]')
    }
    if (jev.deferMergeAbove !== undefined && (jev.deferMergeAbove < 0.5 || jev.deferMergeAbove > 1)) {
      throw new Error('dsh-engram: jev.deferMergeAbove must be in [0.5, 1]')
    }
    if (jev.deferAcceptBelow !== undefined && (jev.deferAcceptBelow < 0 || jev.deferAcceptBelow > 0.5)) {
      throw new Error('dsh-engram: jev.deferAcceptBelow must be in [0, 0.5]')
    }
    if (jev.contradictMinProbability !== undefined && (jev.contradictMinProbability < 0.5 || jev.contradictMinProbability > 1)) {
      throw new Error('dsh-engram: jev.contradictMinProbability must be in [0.5, 1]')
    }
    if ((jev.deferAcceptBelow ?? 0.15) >= (jev.deferMergeAbove ?? 0.85)) {
      throw new Error('dsh-engram: jev.deferAcceptBelow must be less than jev.deferMergeAbove')
    }
  }
  const dbDir = config.dbDir ?? join(homedir(), '.dsh', 'engram')
  return {
    dbDir,
    legacyMigration: config.legacyMigration ?? 'eager',
    injectProfile: config.injectProfile ?? true,
    profileTopN: config.profileTopN ?? 8,
    modelCacheDir: config.modelCacheDir ?? join(dbDir, 'models'),
    hfEndpoint: config.hfEndpoint,
    ingest: config.ingest ?? 'off',
    reflect: config.reflect ?? 'off',
    routeOverride: hasProvider && hasModel ? { provider: config.provider!, model: config.model! } : undefined,
    decayAfterDays: config.decayAfterDays ?? 30,
    decayImportanceBelow: config.decayImportanceBelow ?? 0.3,
    injectTokenBudget: config.injectTokenBudget ?? 1024,
    injectItemBudgetStart: config.injectItemBudgetStart ?? 160,
    injectItemBudgetDecay: config.injectItemBudgetDecay ?? 0.9,
    injectItemBudgetFloor: config.injectItemBudgetFloor ?? 24,
    assessReminder: config.assessReminder ?? true,
    rankRecencyWeight: config.rankRecencyWeight ?? 0.2,
    rankProofWeight: config.rankProofWeight ?? 0.1,
    queryRewrite: config.queryRewrite ?? true,
    autoSlot: config.autoSlot ?? true,
    reviewScheduling: config.reviewScheduling ?? true,
    historyBackfill: {
      days: config.historyBackfillDays ?? 7,
      maxTurnsPerSession: config.historyBackfillMaxTurnsPerSession ?? 20,
      maxTotalTurns: config.historyBackfillMaxTotalTurns ?? 200,
      includeSubagents: config.historyBackfillIncludeSubagents ?? false,
      includeSeeded: config.historyBackfillIncludeSeeded ?? false,
      includeNoCwd: config.historyBackfillIncludeNoCwd ?? false,
    },
    jev: {
      enabled: config.jev?.enabled ?? false,
      apiKey: config.jev?.apiKey,
      baseUrl: config.jev?.baseUrl ?? 'https://api.typesafe.ai',
      model: config.jev?.model ?? 'jev-latest',
      timeoutMs: config.jev?.timeoutMs ?? 3000,
      deferMergeAbove: config.jev?.deferMergeAbove ?? 0.85,
      deferAcceptBelow: config.jev?.deferAcceptBelow ?? 0.15,
      contradictMinProbability: config.jev?.contradictMinProbability ?? 0.8,
    },
  }
}
