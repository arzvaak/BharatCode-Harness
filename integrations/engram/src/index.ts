/**
 * dsh-engram: the DeepSeek Harness cross-session long-term memory plugin (host half).
 * Registers the engram_ tools, injects the profile at session start (the curated block takes
 * priority over the derived profile), auto-ingests the previous turn's conversation, and
 * provides the distill/decay flywheel and auditing capabilities.
 * @module @kenz1117/dsh-engram
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'

// v4 message source type consolidation: this plugin declares no bare-name kind; the DSH v3→v4
// migration rewrites this plugin's historical sources uniformly into the `plugin:<package>` prefix
// shape (and drops the plugin field), and the write side keeps the same shape.
// Merged pattern-key declarations let the MessageSource union absorb that prefix, so no type
// assertion is needed at injection sites.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    [kind: `plugin:${string}`]: { kind: `plugin:${string}` } & ContextFormed
  }
}
import { resolveConfig } from './config.ts'
import type { EngramConfig, ResolvedEngramConfig } from './config.ts'
import { createLocalEmbedder } from './embedder/local.ts'
import type { EngramEmbedder } from './embedder/interface.ts'
import { FINAL_INGEST_TIMEOUT_MS, ensureSessionSummary, ingestFinalTurn, ingestPreviousTurn, ingestWriteRouting, lastTurnNumber, replayPendingIngests } from './ingest/hook.ts'
import { estimateHistoryBackfill, runHistoryBackfill } from './ingest/history.ts'
import type {
  HistoryBackfillDeps, HistoryBackfillRules, HistoryEstimate, HistoryLogSource, HistoryRunProgress, HistoryRunResult,
  HistorySessionHeader,
} from './ingest/history.ts'
import { runConsolidation } from './consolidation/run.ts'
import { reflectObservations } from './consolidation/reflect.ts'
import type { IngestRequestEventData } from './ingest/hook.ts'
import { parseJsonArray, routeFromEvents, streamText } from './llm/client.ts'
import type { LlmRoute, SessionEventLike } from './llm/client.ts'
import { registerEngramRoutes } from './routes.ts'
import type { ProjectPalaceView, RouteDeps } from './routes.ts'
import { migrateProjectDb, migrationWarning, resolveProjectIdentity, workspaceProjectDbName } from './project/identity.ts'
import { findProjectPalace, listProjectPalaces } from './project/registry.ts'
import type { ProjectPalace, WorkspaceRef } from './project/registry.ts'
import { openEngramStore } from './store/sqlite.ts'
import type { EngramStore } from './store/interface.ts'
import { createEngramTools } from './tools/create.ts'
import { resolveJevField } from './jev/runtime.ts'
import { currentUserRequestText, renderMemoryPacket } from './security/sanitize.ts'
import { wrapWithRationale } from './selection-rationale.ts'
import { buildAssessReminder, evidenceBatches } from './retrieve/evidence.ts'
import { estimateTokens } from './token.ts'
import type { EngramScope, Slot } from './types.ts'

/** Cordis plugin name (used by loader diagnostics and the injection source). */
export const name = 'dsh-engram'

/** Plugin version (kept in sync with package.json, written into the backup _meta.json). */
export const VERSION = '0.7.6'

/** Required services: the tool registry and the LLM streaming endpoint (auxiliary calls for ingest/distill). */
export const inject = ['tools', 'llm']

/** Config validation surface the loader reads (the cordis.yml config field). */
export { Config } from './config.ts'
export type { EngramConfig } from './config.ts'

/** Profile render result: text is the injected text; overflow is entries that did not get a full line (compression candidates). */
export interface ProfileRender {
  readonly text: string
  readonly overflow: readonly { id: string; kind: string; content: string }[]
}

/** Graduated-decay per-item body budget: item i's budget = max(floor, round(start × decay^i)). */
export interface GraduatedItemBudget {
  /** First item's body character budget. */
  readonly start: number
  /** Per-item decay factor. */
  readonly decay: number
  /** Floor character budget. */
  readonly floor: number
}

/** Graduated-decay budget defaults (when config is absent, resolveConfig explicitly lands the same values here). */
export const DEFAULT_ITEM_BUDGET: GraduatedItemBudget = { start: 160, decay: 0.9, floor: 24 }

/**
 * Profile render for session-start injection: fills in importance-descending order, truncating each
 * item's body by the graduated-decay budget (first item 160 chars, ×0.9 per item, floor 24 chars —
 * later-ranked items get shorter bodies; a smooth degradation instead of a whole-entry-degraded
 * index line). The token budget (estimation via estimateTokens: CJK counts as 1.5 tokens/char,
 * everything else 4 chars/token) is the outer hard constraint: entries that still do not fit after
 * truncation first fall back to a 40-char index line; index lines that also do not fit fold into a
 * trailing `+N more; use engram_search` count line; the count line also consumes budget.
 * @param records - Candidate entries (the caller has already sorted by importance and truncated by count).
 * @param tokenBudget - Token budget for the whole profile (including the fixed header/footer lines).
 * @param itemBudget - Graduated-decay per-item body budget (defaults to DEFAULT_ITEM_BUDGET; the config surface is in resolveConfig).
 * @returns Rendered text and overflow entries (the caller can compress them with the auxiliary LLM and re-render).
 */
export function renderProfileDetailed(
  records: readonly { id: string; kind: string; content: string; slot?: Slot }[],
  tokenBudget: number,
  itemBudget: GraduatedItemBudget = DEFAULT_ITEM_BUDGET,
): ProfileRender {
  const estimate = estimateTokens
  // Grand Hall: the resident core memory layer (present in every session); lines carry palace coordinates (room #slot) so the agent has a sense of place.
  const header = 'User memory profile (dsh-engram, cross-session) — Grand Hall (always present):'
  const footer = 'Use engram_search to recall details (pass room to search inside one room); use engram_save to persist new facts.'
  let remaining = Math.max(0, tokenBudget - estimate(header) - estimate(footer))
  const lines: string[] = []
  const overflow: { id: string; kind: string; content: string }[] = []
  records.forEach((record, index) => {
    // Graduated decay: item i's body budget = max(floor, start × decay^i); over-length is truncated (keeping the entry count takes priority over single-item completeness).
    const budget = Math.max(itemBudget.floor, Math.round(itemBudget.start * itemBudget.decay ** index))
    const content = record.content.length > budget ? `${record.content.slice(0, budget)}…` : record.content
    const slot = record.slot === undefined ? '' : ` ${record.slot.room}#${record.slot.index}`
    const line = `- [${record.kind}]${slot} ${content}`
    const cost = estimate(line)
    if (cost <= remaining) {
      lines.push(line)
      remaining -= cost
    } else {
      overflow.push(record)
    }
  })
  let more = 0
  // The trailing count line also consumes budget: reserve for its maximum digit count before filling index lines, otherwise the total after adding the line would exceed the budget.
  // When the budget is too small to even fit the reservation (remaining goes negative), do not emit the count line, guaranteeing the total never exceeds the commitment.
  remaining -= overflow.length === 0 ? 0 : estimate(`+${overflow.length} more; use engram_search`)
  for (const record of overflow) {
    const line = `- [${record.kind}] #${record.id} ${record.content.slice(0, 40)}…`
    const cost = estimate(line)
    if (cost <= remaining) {
      lines.push(line)
      remaining -= cost
    } else {
      more += 1
    }
  }
  if (more > 0 && remaining >= 0) lines.push(`+${more} more; use engram_search`)
  return { text: [header, ...lines, footer].join('\n'), overflow }
}

/**
 * Profile render for session-start injection (text only; overflow detail in renderProfileDetailed).
 * @param records - Candidate entries (the caller has already sorted by importance and truncated by count).
 * @param tokenBudget - Token budget for the whole profile (including the fixed header/footer lines).
 * @returns The injected text.
 */
export function renderProfile(
  records: readonly { id: string; kind: string; content: string }[],
  tokenBudget: number,
): string {
  return renderProfileDetailed(records, tokenBudget).text
}

/** Header line for the curated block section (lets the model know this section is the manually maintained, highest-priority profile). */
export const CURATED_HEADER =
  'Curated profile (user-maintained via engram_profile_edit; authoritative over derived facts):'

/**
 * Profile render (curated first): when a curated block exists, its full text is placed before the
 * derived profile (the first section the model sees), and its own consumption is first deducted
 * from the token budget, with the remaining budget used to fill the derived entries; the derived
 * section still goes through graduated decay and the index-line/count-line degradation. The curated
 * block is the user's explicitly maintained intent, so it is injected in full even when it exceeds
 * the remaining budget (same rationale as the due line); when the block is absent, it is equivalent
 * to renderProfileDetailed.
 * @param curated - The current curated block; undefined = never edited.
 * @param records - Derived profile candidate entries (the caller has already sorted by importance and truncated by count).
 * @param tokenBudget - Token budget for the whole profile (shared by the curated and derived sections).
 * @param itemBudget - Graduated-decay per-item body budget (passed through to renderProfileDetailed).
 * @returns Rendered text and the derived section's overflow entries.
 */
export function renderProfileWithCurated(
  curated: { content: string } | undefined,
  records: readonly { id: string; kind: string; content: string; slot?: Slot }[],
  tokenBudget: number,
  itemBudget: GraduatedItemBudget = DEFAULT_ITEM_BUDGET,
): ProfileRender {
  if (curated === undefined) return renderProfileDetailed(records, tokenBudget, itemBudget)
  const curatedSection = `${CURATED_HEADER}\n${curated.content}`
  const detailed = renderProfileDetailed(records, Math.max(0, tokenBudget - estimateTokens(curatedSection)), itemBudget)
  return { text: `${curatedSection}\n${detailed.text}`, overflow: detailed.overflow }
}

/** Output token cap for the compression auxiliary call (40 chars × several items; short output suffices). */
const COMPRESS_MAX_TOKENS = 800
/** Compression auxiliary call timeout: compression is on the pre-step critical path and must be bounded to avoid blocking the first turn's request. */
const COMPRESS_TIMEOUT_MS = 8000
/** Max number of consolidated beliefs injected at turn_start (by evidence count, recency descending). */
const OBSERVATION_INJECT_LIMIT = 3
/** Truncation character count for a single injected belief. */
const OBSERVATION_INJECT_ITEM_CHARS = 120
/** Total character cap for the belief block (independent of the profile token budget, avoiding mutual squeezing with the profile). */
const OBSERVATION_INJECT_BLOCK_CHARS = 480

const COMPRESS_SYSTEM = [
  'Compress each memory entry into a shorter one-sentence phrasing (at most 40 characters per item), keeping the key information reusable across sessions (facts, preferences, decisions, methods).',
  'Output only one JSON array, each item shaped like {"id": "the id returned as-is", "content": "compressed phrasing"}; the item count and ids must correspond one-to-one with the input.',
  'Do not output anything other than the JSON.',
].join('\n')

/**
 * Auxiliary compression for an over-budget profile: hands the entries that do not fit to the
 * auxiliary LLM to shorten, returning id → compressed text.
 * Any failure (no route, unparseable output, timeout, call exception) returns undefined, and the
 * caller degrades back to index-line filling. Compression requests are audited to the user store's
 * op_log (model-visible ⟺ logged: the compressed products themselves enter the session log with
 * the injected message).
 */
async function compressProfileOverflow(
  ctx: Context,
  agent: Agent,
  routeOverride: LlmRoute | undefined,
  overflow: readonly { id: string; kind: string; content: string }[],
  signal: AbortSignal,
): Promise<Map<string, string> | undefined> {
  try {
    const events = agent.session.snapshotEvents() as unknown as readonly SessionEventLike[]
    const route = routeOverride ?? routeFromEvents(events)
    if (route === undefined) return undefined
    const userText = JSON.stringify(overflow.map(record => ({ id: record.id, content: record.content })))
    const raw = await streamText(ctx, {
      route,
      system: COMPRESS_SYSTEM,
      userText,
      maxTokens: COMPRESS_MAX_TOKENS,
      purpose: 'engram-compress',
      sessionId: agent.session.id,
      signal: AbortSignal.any([signal, AbortSignal.timeout(COMPRESS_TIMEOUT_MS)]),
    })
    const parsed = parseJsonArray(raw)
    if (parsed === undefined) return undefined
    const ids = new Set(overflow.map(record => record.id))
    const compressed = new Map<string, string>()
    for (const item of parsed) {
      const entry = item as { id?: unknown; content?: unknown }
      if (typeof entry.id !== 'string' || typeof entry.content !== 'string') continue
      // Accept only ids from the input list and non-empty compressed results that are genuinely shorter.
      if (!ids.has(entry.id) || entry.content.trim() === '' || entry.content.length >= overflow.find(record => record.id === entry.id)!.content.length) continue
      compressed.set(entry.id, entry.content.trim())
    }
    return compressed.size > 0 ? compressed : undefined
  } catch {
    // Compression is an enhancement path: any failure degrades back to the existing index-line filling.
    return undefined
  }
}

/**
 * agent/pre-step waterfall: injects the profile on the first step of every turn (skipping duplicate injection when the content is the same as last time);
 * simultaneously fire-and-forget triggers the previous turn's auto-ingest (without blocking the request); the process's first
 * first-step replays the pending final-turn ingest. next() must be called to delegate down the chain; reject decisions pass
 * through unchanged, and no message is appended when the memory store is empty or it is not the first turn.
 */
async function preStep(
  ctx: Context,
  openStore: (scope: EngramScope) => Promise<EngramStore>,
  openStoreForProjectCwd: (cwd: string) => Promise<EngramStore>,
  resolved: ResolvedEngramConfig,
  embedder: Promise<EngramEmbedder | undefined>,
  state: { pendingReplayed: boolean; lastProfileAgent: string | null; lastProfileHash: string | null; lastAssessReminder: string | null; route: LlmRoute | undefined },
  logRequest: (data: IngestRequestEventData) => void,
  { agent, step, turn, signal }: { agent: Agent; step: number; turn: number; signal: AbortSignal },
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision> {
  const decision = await next()
  if (decision.kind === 'reject') return decision
  // Record the route the current session is using: history backfill reuses it preferentially — the provider/model in historical logs is from back then,
  // and may no longer be available in the current environment (e.g. the provider changed); only the current model will run through.
  if (step === 1) {
    const currentRoute = resolved.routeOverride ?? routeFromEvents(agent.session.snapshotEvents() as unknown as readonly SessionEventLike[])
    if (currentRoute !== undefined) state.route = currentRoute
  }
  const mode = resolved.ingest
  // Write routing: when this session has a cwd, default to the project palace and accept the model's per-item scope judgment; without a cwd, only the private palace is available.
  const routing = ingestWriteRouting(sessionCwd(agent.session), openStoreForProjectCwd, openStore)
  if (step === 1 && mode !== 'off') {
    // Replay the pending final-turn ingest (the pending key from the last session's failed/timed-out disposed).
    if (!state.pendingReplayed) {
      state.pendingReplayed = true
      void replayPendingIngests({
        openStore: () => openStore('user'),
        resolveSession: makeSessionResolver(ctx, agent),
        resolveStore: openStoreForProjectCwd,
        embedder,
        mode,
        routeOverride: resolved.routeOverride,
        ...resolveJevField(resolved.jev, resolved.dbDir),
        call: params => streamText(ctx, { ...params, sessionId: agent.session.id }),
        logRequest,
        signal,
      }).catch((error: unknown) => {
        console.warn('[dsh-engram] pending ingest replay failed (pending kept, conversation unaffected):', error)
      })
    }
    // Auto-ingest: the first step of a new turn reads the previous turn's log. Runs asynchronously; failures only warn.
    if (turn > 1) {
      void ingestPreviousTurn({
        events: agent.session.snapshotEvents() as unknown as readonly SessionEventLike[],
        sessionId: String(agent.id),
        turn,
        openStore: () => openStore('user'),
        openAuditStore: () => openStore('user'),
        ...routing,
        embedder,
        mode,
        routeOverride: resolved.routeOverride,
        ...resolveJevField(resolved.jev, resolved.dbDir),
        call: params => streamText(ctx, { ...params, sessionId: agent.session.id }),
        logRequest,
        signal,
      }).catch((error: unknown) => {
        console.warn('[dsh-engram] auto-ingest for this turn failed (skipped, conversation unaffected):', error)
      })
    }
  }
  if (step !== 1 && resolved.assessReminder) {
    // Evidence-gate closing reminder: when this session has unassessed batches, remind before the next step starts (injected at the plugin layer,
    // without touching the agent-loop); the same text is not injected repeatedly, and it naturally stops after the assessment completes or the batch is cleared.
    const sessionId = String(agent.session.id)
    const pending = evidenceBatches.pendingBatches(sessionId).length
    const reminder = buildAssessReminder(pending, evidenceBatches.insufficientStreak(sessionId))
    if (reminder !== undefined && reminder !== state.lastAssessReminder) {
      state.lastAssessReminder = reminder
      return {
        ...decision,
        messages: [
          ...decision.messages,
          createUserMessage({
            content: [{ type: 'text', text: reminder }],
            source: { kind: `plugin:${name}`, form: 'snapshot', sections: [{ name, text: reminder }] },
          }),
        ],
      }
    }
  }
  if (step !== 1) return decision
  const store = await openStore('user')
  // Curated block: the profile section maintained by engram_profile_edit, injected with priority over the auto-derived profile.
  const curated = await store.getProfileBlock('user')
  const top = await store.topActive('user', resolved.profileTopN)
  if (top.length === 0 && curated === undefined) return decision
  // Today's recall-due hint (retrieval practice scheduling): when there are due entries, append one line at the end of the profile to guide the agent into active self-testing.
  // user + project stores are counted together; 50 is the counting cap (more than that shows 50+).
  const dueTotal = resolved.reviewScheduling
    ? (await Promise.all((['user', 'project'] as const).map(async scope =>
        (await openStore(scope)).dueReviews(Date.now(), 50)))).reduce((sum, rows) => sum + rows.length, 0)
    : 0
  const detailed = renderProfileWithCurated(
    curated,
    top,
    resolved.injectTokenBudget,
    { start: resolved.injectItemBudgetStart, decay: resolved.injectItemBudgetDecay, floor: resolved.injectItemBudgetFloor },
  )
  let text = detailed.text
  // Over-budget compression: hand entries that do not fit to the auxiliary LLM to shorten, then re-render; on failure keep the index-line degradation unchanged.
  if (detailed.overflow.length > 0) {
    const compressed = await compressProfileOverflow(ctx, agent, resolved.routeOverride, detailed.overflow, signal)
    if (compressed !== undefined) {
      // Auxiliary request audit (the compressed products enter the session log with the injected message; the request itself lands in op_log for attribution).
      void openStore('user').then(auditStore => auditStore.audit('compress-request', 'AUX', JSON.stringify({ count: detailed.overflow.length }))).catch(() => { /* audit failures do not affect injection */ })
      text = renderProfileWithCurated(
        curated,
        top.map(record => {
          const shorter = compressed.get(record.id)
          return shorter === undefined ? record : { ...record, content: shorter }
        }),
        resolved.injectTokenBudget,
        { start: resolved.injectItemBudgetStart, decay: resolved.injectItemBudgetDecay, floor: resolved.injectItemBudgetFloor },
      ).text
    }
  }
  // Consolidated beliefs block: active beliefs take the top N by evidence count/recency and are spliced into the same profile packet;
  // stale/refuted are not injected. The block is independent of the profile budget (a fixed hard cap); after beliefs update, the profile hash changes and naturally triggers re-injection.
  const observations = await store.listObservations({ status: 'active', limit: OBSERVATION_INJECT_LIMIT })
  if (observations.length > 0) {
    const block = [
      'Consolidated beliefs (distilled from multiple stored memories; verify against sources before high-stakes use):',
      ...observations.map(observation =>
        `- ${observation.belief.slice(0, OBSERVATION_INJECT_ITEM_CHARS)} (${String(observation.proofCount)} sources)`),
    ].join('\n').slice(0, OBSERVATION_INJECT_BLOCK_CHARS)
    text = `${text}\n\n${block}`
  }
  // Injection dedup: within the same session, skip when the profile text matches last time (the previous turn's injection is still in context);
  // a new session (a different lastProfileAgent) must inject, even if the text matches the previous session. The due line is included in the hash input.
  const dueLine = dueTotal === 0
    ? ''
    : `\nPalace review due today: ${dueTotal}${dueTotal >= 50 ? '+' : ''} memories. Use engram_review_queue for active recall (recall beats re-reading).`
  const textWithRationale = wrapWithRationale(text, top) + dueLine
  const hash = createHash('sha256').update(textWithRationale).digest('hex')
  if (state.lastProfileAgent === String(agent.id) && hash === state.lastProfileHash) return decision
  state.lastProfileAgent = String(agent.id)
  state.lastProfileHash = hash
  // Profile packet protocol tag: memory entries are untrusted historical context; the current request takes the last text block of this turn's admitted messages.
  const packet = renderMemoryPacket(text, 'turn_start', currentUserRequestText(decision.messages))
  return {
    ...decision,
    messages: [
      ...decision.messages,
      createUserMessage({
        content: [{ type: 'text', text: packet }],
        source: { kind: `plugin:${name}`, form: 'snapshot', sections: [{ name, text: packet }] },
      }),
    ],
  }
}

/**
 * A narrow view of the session persistence service: the new dsh only has handle-style `open`/`read` (`load(id)` has been removed),
 * and `list()` returns snapshots (the header is on `snapshot.header`) rather than a header array.
 * This plugin does not hard-depend on @deepseek-ai/dsh-session-persistence and only reads by runtime shape.
 */
interface PersistenceReadHandle {
  /** Read a contiguous log segment; default parameters = read from 0 to the end. */
  read(offset?: number, length?: number): Promise<{ events: readonly unknown[] }>
  /** Session header (always provided by a real handle; test stubs may omit it) — its cwd decides which project palace the catch-up turn writes into. */
  readonly header?: { readonly cwd?: string | undefined } | undefined
  /** Release the handle (idempotent; not releasing holds local resources in the backend). */
  close(): Promise<void>
}

/** Minimal view of the persistence service (only list and read-only open are used). */
interface PersistenceServiceView {
  /** List snapshots of all persisted sessions (the host interface does not paginate or filter). */
  list(options?: { signal?: AbortSignal }): Promise<readonly { header: HistorySessionHeader }[]>
  /** Read-only open of a persisted session; does not take write ownership and can coexist with an active writer. */
  open(id: string, access: 'read'): Promise<PersistenceReadHandle>
}

/**
 * Session working directory (decides which project palace its memories go into).
 * A real `Session.header` is always present; test stubs may omit the header, so it is read as an optional shape.
 * @param session - The session (or stub) object.
 * @returns cwd; undefined when unavailable (that session's fallback is the private palace).
 */
function sessionCwd(session: { readonly header?: { readonly cwd?: string | undefined } | undefined } | undefined): string | undefined {
  const cwd = session?.header?.cwd
  return cwd === undefined || cwd === '' ? undefined : cwd
}

/**
 * Read-only open of a session log → hand it to the caller to read → always close the handle.
 * A close failure does not mask the read result (when reading succeeds and close fails, the success value is still returned).
 * @param persistence - The persistence service view.
 * @param sessionId - The target session id.
 * @param use - The handle-use callback.
 * @returns The callback's result.
 */
async function withReadHandle<T>(
  persistence: PersistenceServiceView,
  sessionId: string,
  use: (handle: PersistenceReadHandle) => Promise<T>,
): Promise<T> {
  const handle = await persistence.open(sessionId, 'read')
  try {
    return await use(handle)
  } finally {
    await handle.close().catch(() => { /* no remedial action on close failure */ })
  }
}

/**
 * Session resolver for pending replay: when the pending belongs to the current session, use its event snapshot and cwd directly;
 * other sessions read their persisted log and header.cwd through the optional sessionPersistence service (read-only handle)
 * (a missing service or read failure returns undefined, the pending is kept until next time, no error).
 */
function makeSessionResolver(
  ctx: Context,
  agent: Agent,
): (sessionId: string) => Promise<{ events: readonly SessionEventLike[]; cwd?: string | undefined } | undefined> {
  return async sessionId => {
    if (sessionId === String(agent.id)) {
      return {
        events: agent.session.snapshotEvents() as unknown as readonly SessionEventLike[],
        cwd: sessionCwd(agent.session),
      }
    }
    // An optional service that engram does not hard-depend on: when absent, cross-session pendings are kept until that session is restored.
    const persistence = ctx.get('sessionPersistence' as never) as PersistenceServiceView | undefined
    if (persistence === undefined) return undefined
    try {
      return await withReadHandle(persistence, sessionId, async handle => ({
        events: (await handle.read()).events as readonly SessionEventLike[],
        cwd: sessionCwd(handle),
      }))
    } catch {
      return undefined
    }
  }
}

/**
 * Plugin body: warms up the substores and the embedder, registers the engram_ tools, profile injection, auto-ingest, and the decay schedule.
 * @param ctx - The host context.
 * @param config - Optional config passed from cordis.yml; illegal values fail loudly at load time.
 */
export function apply(ctx: Context, config: EngramConfig = {}): void {
  const resolved = resolveConfig(config)
  mkdirSync(resolved.dbDir, { recursive: true, mode: 0o700 })

  // Project identity: normalized git origin hash → full cwd hash; check legacy store migration per config.
  const identity = resolveProjectIdentity(process.cwd())
  const migration = migrateProjectDb(resolved.dbDir, identity, resolved.legacyMigration)
  const warning = migrationWarning(resolved.dbDir, identity, migration)
  if (warning !== undefined) console.warn(warning)

  // Retrieval ranking boost parameters: explicitly resolved from config, injected into the two substores.
  const rankBoost = {
    recencyWeight: resolved.rankRecencyWeight,
    proofWeight: resolved.rankProofWeight,
    decayAfterDays: resolved.decayAfterDays,
  }

  // Lazy substore opening: connections are cached by substore file name (user / shared / project-<hash>; the project store is named by identity and shared across sessions of the same repo).
  const stores = new Map<string, Promise<EngramStore>>()
  const backgroundAbort = new AbortController()
  const backgroundTasks = new Set<Promise<unknown>>()
  const trackBackground = <T>(pending: Promise<T>): Promise<T> => {
    backgroundTasks.add(pending)
    void pending.then(() => backgroundTasks.delete(pending), () => backgroundTasks.delete(pending))
    return pending
  }
  const startBackground = (task: () => Promise<void>): void => {
    if (backgroundAbort.signal.aborted) return
    trackBackground(task())
  }


  /** Open (or reuse) a substore file; on first open, idempotently backfill slots for pre-existing entries. */
  const openDb = (dbName: string): Promise<EngramStore> => {
    const existing = stores.get(dbName)
    if (existing !== undefined) return existing
    const path = join(resolved.dbDir, dbName)
    const created = openEngramStore(path, rankBoost, {
      autoSlot: resolved.autoSlot,
      reviewScheduling: resolved.reviewScheduling,
    })
      // Pre-existing slotting: idempotently backfilled on first open (active entries with an empty slot_room are assigned to a room by kind, ordered by creation time).
      .then(async store => {
        const assigned = await store.backfillSlots(room => {
          console.warn(`[dsh-engram] room full, auto-opened a new room "${room}" (can be manually split/named in the admin panel's refurb list)`)
        })
        if (assigned > 0) console.warn(`[dsh-engram] pre-existing memories slotted: ${assigned} pinned into the palace (${path})`)
        return store
      })
    stores.set(dbName, created)
    return created
  }

  const openStore = (scope: EngramScope): Promise<EngramStore> => openDb(
    scope === 'user' ? 'user.db' : scope === 'shared' ? 'shared.db' : identity.dbName,
  )

  // Close opened substore connections on uninstall/restart: not closing locks the .db file on Windows
  // (after uninstall the directory cannot be deleted, and backup/migration may also fail). The disposer returns a promise, and the host waits for it to complete.
  ctx.effect(() => async () => {
    backgroundAbort.abort()
    while (backgroundTasks.size > 0) await Promise.allSettled([...backgroundTasks])
    await Promise.allSettled([...stores.values()].map(async pending => {
      try {
        await (await pending).close()
      } catch {
        // No remedial action on close failure (the connection is released when the process exits).
      }
    }))
  }, 'dsh-engram: close stores')

  /** cwd → substore file name (history backfill resolves each historical cwd once, avoiding repeated git metadata reads). */
  const cwdDbNames = new Map<string, string>()
  /**
   * Open a substore by the project identity of any cwd (history-backfill only): a historical session writes into its own project's store,
   * not the current working directory's store — otherwise cross-project content would mix stores.
   * @param cwd - The cwd recorded in the historical session's header.
   * @returns The connection to the project substore corresponding to that cwd.
   */
  /** cwd → substore file name (cached, avoiding repeated git metadata reads and repeated migration checks). */
  const dbNameForCwd = (cwd: string): string => {
    // Match the host registry on its canonical path before the legacy origin fallback.
    // Do not cache workspace ownership: deletion/recreation may assign a new stable ID.
    let canonical = cwd
    try { canonical = realpathSync(cwd) } catch { /* Historical directories may no longer exist. */ }
    const workspace = workspaceRefs().find(candidate => candidate.path === canonical)
    if (workspace !== undefined) return workspaceProjectDbName(workspace.id)
    const cached = cwdDbNames.get(cwd)
    if (cached !== undefined) return cached
    const projectIdentity = resolveProjectIdentity(cwd)
    // The session cwd likewise applies the legacy store migration policy; the result and warning are cached per cwd.
    const migration = migrateProjectDb(resolved.dbDir, projectIdentity, resolved.legacyMigration)
    const warning = migrationWarning(resolved.dbDir, projectIdentity, migration)
    if (warning !== undefined) console.warn(warning)
    cwdDbNames.set(cwd, projectIdentity.dbName)
    return projectIdentity.dbName
  }

  const openStoreForProjectCwd = (cwd: string): Promise<EngramStore> => openDb(dbNameForCwd(cwd))

  /**
   * Project substore resolution during tool calls: attributed by the session cwd (falls back to the plugin process directory when absent).
   * The panel's "project" scope, tool reads/writes, and auto-ingest's project landing point therefore share the same basis.
   */
  const resolveProjectStore = (cwd: string | undefined): Promise<EngramStore> =>
    openStoreForProjectCwd(cwd ?? process.cwd())

  // The embedder is optional: a download/load failure does not block plugin loading; retrieval degrades to pure keyword and is marked in the result.
  const embedder: Promise<EngramEmbedder | undefined> = createLocalEmbedder(resolved.modelCacheDir, resolved.hfEndpoint)
    .catch((error: unknown) => {
      console.warn('[dsh-engram] embedder unavailable; retrieval degrades to pure keyword mode:', error)
      return undefined
    })
  void embedder

  // Auxiliary requests are written to engram's own operation log (downstream plugins are forbidden from writing unknown event types into the session log).
  const logIngestRequest = (data: IngestRequestEventData): void => {
    startBackground(() => openStore('user').then(store => store.audit('ingest-request', 'AUX', JSON.stringify(data))).catch(() => { /* audit failures do not affect ingest */ }))
  }

  // Mutable state for preStep: route records the route the current session is using, and history backfill reuses it preferentially.
  const preStepState: {
    pendingReplayed: boolean
    lastProfileAgent: string | null
    lastProfileHash: string | null
    lastAssessReminder: string | null
    route: LlmRoute | undefined
  } = { pendingReplayed: false, lastProfileAgent: null, lastProfileHash: null, lastAssessReminder: null, route: undefined }

  // ---- History session backfill: ingest dsh's persisted historical sessions into the palace turn by turn (panel "History Backfill" tab / engram_ingest_history) ----
  /** Session persistence service (optional; history backfill unavailable when absent). */
  const persistenceService = (): HistoryLogSource | undefined => {
    const persistence = ctx.get('sessionPersistence' as never) as PersistenceServiceView | undefined
    if (persistence === undefined) return undefined
    return {
      // The header is now embedded in the snapshot, and the cancellation parameter changed from positional to { signal } (the key is omitted when there is no signal).
      list: async signal => (await persistence.list(signal === undefined ? undefined : { signal })).map(snapshot => snapshot.header),
      // The log is read through a read-only handle (open → read fully → always close); read failures are thrown as-is and the caller counts them as unreadable.
      load: id => withReadHandle(persistence, id, async handle => ({ events: (await handle.read()).events })),
    }
  }

  /** Open the user substore if it already exists (for estimation: do not create an empty store file just to estimate). */
  const openUserStoreIfExists = (): Promise<EngramStore | undefined> =>
    existsSync(join(resolved.dbDir, 'user.db')) ? openStore('user') : Promise.resolve(undefined)

  // ---- Project palace list: the panel's "project" scope switches and displays with the GUI workspace (host-half data source) ----
  /** Host workspace registry (optional service: when absent, degrades to a two-level "session cwd + process directory" list). */
  const workspaceRefs = (): WorkspaceRef[] => {
    const registry = ctx.get('workspaceRegistry' as never) as
      | { list(): readonly { id: unknown; path: unknown; title: unknown }[] }
      | undefined
    if (registry === undefined) return []
    try {
      return registry.list()
        .filter(workspace => typeof workspace.path === 'string' && workspace.path !== '')
        .map(workspace => ({
          id: String(workspace.id),
          path: workspace.path as string,
          title: typeof workspace.title === 'string' ? workspace.title : '',
        }))
    } catch {
      // Registry unavailable (not initialized / implementation changed): degrade as if there were no registry, without affecting the panel's other functions.
      return []
    }
  }

  /** Cap on substores claimed by session cwd only (take the most recent few by session recency, so historical cwds do not bloat the list). */
  const SESSION_CWD_PALACE_LIMIT = 30

  /**
   * cwds seen in session headers: stores created by history backfill can also be claimed in the panel.
   * Take the most recent N by session creation time descending (newest first, deduped then truncated).
   */
  const sessionCwds = async (): Promise<string[]> => {
    const source = persistenceService()
    if (source === undefined) return []
    try {
      const headers = await source.list()
      const ordered = [...headers].sort((a, b) => b.createdAt - a.createdAt)
      const cwds: string[] = []
      const seen = new Set<string>()
      for (const header of ordered) {
        const cwd = header.cwd
        if (cwd === undefined || cwd === '' || seen.has(cwd)) continue
        seen.add(cwd)
        cwds.push(cwd)
        if (cwds.length >= SESSION_CWD_PALACE_LIMIT) break
      }
      return cwds
    } catch {
      return []
    }
  }

  /** Project palace list (computed on the fly, zero state): registry workspaces → session cwds → process directory fallback, deduped by substore name. */
  const projectPalaces = async (): Promise<ProjectPalace[]> =>
    listProjectPalaces({ workspaces: workspaceRefs(), sessionCwds: await sessionCwds(), processCwd: process.cwd() })

  /** Panel view: fills in exists and the active count (do not open when the store file does not exist, avoiding creating empty stores for workspaces). */
  const palaceView = async (palace: ProjectPalace): Promise<ProjectPalaceView> => {
    const exists = existsSync(join(resolved.dbDir, palace.dbName))
    let memories: number | null = null
    if (exists) {
      try {
        memories = (await (await openDb(palace.dbName)).stats()).active
      } catch {
        memories = null
      }
    }
    return {
      dbName: palace.dbName,
      title: palace.title,
      path: palace.path ?? null,
      kind: palace.kind,
      source: palace.source,
      workspaceId: palace.workspaceId ?? null,
      exists,
      memories,
    }
  }

  const projectsDeps: RouteDeps['projects'] = {
    list: async () => Promise.all((await projectPalaces()).map(async palace => palaceView(palace))),
    open: async selector => {
      const palaces = await projectPalaces()
      const palace = selector === undefined
        ? findProjectPalace(palaces, {})
        : palaces.find(candidate => candidate.dbName === selector)
      if (palace === undefined) return undefined
      return { store: await openDb(palace.dbName), project: await palaceView(palace) }
    },
  }

  /** Assemble the history backfill dependencies; source is fetched fresh each time, compatible with compositions where the persistence service mounts after the plugin. */
  const buildHistoryDeps = (): HistoryBackfillDeps => ({
    source: persistenceService(),
    resolveStore: openStoreForProjectCwd,
    openUserStore: () => openStore('user'),
    resolveExistingUserStore: openUserStoreIfExists,
    embedder,
    // Backfill must go through the distill pipeline: even ingest=off deployments allow manual backfill, distilling at the most economical light tier.
    mode: resolved.ingest === 'off' ? 'light' : resolved.ingest,
    // Prefer the currently available route (config override > the model the current session is using) — the old provider/model in historical logs may no longer be available.
    routeOverride: resolved.routeOverride ?? preStepState.route,
    // Auxiliary call attribution: the audit lands in op_log via logRequest with the session id; streamText only needs a stable identifier.
    call: callParams => streamText(ctx, { ...callParams, sessionId: '' }),
    logRequest: logIngestRequest,
    // Panel override, uncached assembly: read jev-config.json on every backfill run, so a panel save takes effect immediately.
    ...resolveJevField(resolved.jev, resolved.dbDir),
  })

  /** Backfill job (in-process singleton; the panel polls its progress, the tool synchronously waits for its own run). */
  let backfillJob:
    | { controller: AbortController; progress: HistoryRunProgress; failures: HistoryRunResult['failures']; error?: string }
    | undefined

  /** History backfill external interface: shared by the panel route (async job) and the tool (synchronous run). */
  const historyApi = {
    /** The list of registered providers and models (data source for the panel's "auxiliary model" dropdown). */
    models: async (): Promise<{
      providers: { id: string; name: string; models: { id: string; name: string }[] }[]
      failures: string[]
    }> => {
      const llm = ctx.get('llm' as never) as
        | {
            listProviders(): readonly { id: string; name: string }[]
            listModels(provider: string): Promise<readonly { id: string; name: string }[]>
          }
        | undefined
      if (llm === undefined) return { providers: [], failures: [] }
      const failures: string[] = []
      const providers = await Promise.all(llm.listProviders().map(async (provider) => {
        try {
          const models = await llm.listModels(provider.id)
          return { id: provider.id, name: provider.name, models: models.map(model => ({ id: model.id, name: model.name })) }
        } catch (error) {
          // A single provider listing failure (e.g. remote unreachable) does not affect the other groups.
          failures.push(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`)
          return { id: provider.id, name: provider.name, models: [] }
        }
      }))
      return { providers, failures }
    },
    estimate: (rules: HistoryBackfillRules): Promise<HistoryEstimate> =>
      estimateHistoryBackfill(buildHistoryDeps(), resolved.historyBackfill, rules),
    run: (rules: HistoryBackfillRules, signal: AbortSignal): Promise<HistoryRunResult> =>
      runHistoryBackfill(buildHistoryDeps(), resolved.historyBackfill, rules, () => { /* a synchronous run does not broadcast progress externally */ }, signal),
    /** Start a background backfill; refused when a job is already running (the panel button is disabled accordingly). */
    start: (rules: HistoryBackfillRules): { ok: boolean; reason?: string } => {
      if (backfillJob !== undefined && backfillJob.progress.state === 'running') {
        return { ok: false, reason: 'A backfill job is already running; please pause it or wait for it to finish first' }
      }
      const controller = new AbortController()
      const job: NonNullable<typeof backfillJob> = {
        controller,
        failures: [],
        progress: {
          state: 'running', sessionsTotal: 0, sessionsDone: 0, turnsPlanned: 0,
          turnsDone: 0, memoriesWritten: 0, turnsSkipped: 0, turnsFailed: 0, skipReasons: {},
        },
      }
      backfillJob = job
      startBackground(() => runHistoryBackfill(
        buildHistoryDeps(), resolved.historyBackfill, rules,
        progress => { job.progress = progress },
        AbortSignal.any([controller.signal, backgroundAbort.signal]),
      )
        .then((result) => { job.progress = result; job.failures = result.failures })
        .catch((error: unknown) => {
          // The whole batch failed (e.g. an error enumerating sessions): mark it failed and keep the accumulated progress, without throwing to the host.
          console.warn('[dsh-engram] history backfill failed:', error)
          job.progress = { ...job.progress, state: 'failed' }
          job.error = error instanceof Error ? error.message : String(error)
        }).then(() => {}))
      return { ok: true }
    },
    cancel: (): void => { backfillJob?.controller.abort() },
    /** Current job snapshot; returns an idle placeholder when it has never run. */
    status: (): { progress: HistoryRunProgress; failures: HistoryRunResult['failures']; error?: string } => ({
      progress: backfillJob?.progress ?? {
        state: 'done', sessionsTotal: 0, sessionsDone: 0, turnsPlanned: 0,
        turnsDone: 0, memoriesWritten: 0, turnsSkipped: 0, turnsFailed: 0, skipReasons: {},
      },
      failures: backfillJob?.failures ?? [],
      ...(backfillJob?.error === undefined ? {} : { error: backfillJob.error }),
    }),
  }

  // Tool registration (history backfill's estimate/run are provided by historyApi; project scope is resolved by session cwd attribution).
  for (const tool of createEngramTools({
    openStore,
    resolveProjectStore,
    embedder,
    call: callParams => streamText(ctx, { ...callParams, sessionId: callParams.sessionId ?? '' }),
    routeOverride: resolved.routeOverride,
    // Panel override, uncached assembly: read jev-config.json on every tool call, so a panel save takes effect immediately.
    ...resolveJevField(resolved.jev, resolved.dbDir),
    queryRewrite: resolved.queryRewrite,
    exportDir: `${resolved.dbDir}/exports`,
    historyBackfill: { estimate: historyApi.estimate, run: historyApi.run },
  })) {
    ctx.tools.register(tool)
  }

  // Admin panel (optional): register the admin page and /api/engram/* endpoints once webServer is ready.
  // The injected child fiber keeps waiting in compositions without a webServer (headless), without blocking the main install,
  // and the other capabilities (tools/profile injection/ingest/decay) are unaffected.
  ctx.inject(['webServer'], (webCtx) => {
    // The injected callback's child ctx must be used: the ctx.webServer property proxy is topology-sensitive,
    // and the property is unavailable when the outer ctx does not depend on webServer.
    registerEngramRoutes(webCtx, {
      openStore,
      projects: projectsDeps,
      exportDir: `${resolved.dbDir}/exports`,
      mirrorDir: `${resolved.dbDir}/palaces`,
      dbDir: resolved.dbDir,
      pluginVersion: VERSION,
      embedder,
      // Jev panel config: the yml baseline + dbDir (override file path derivation); all reads/writes go through jev/runtime pure functions.
      jev: { base: resolved.jev, dbDir: resolved.dbDir },
      history: {
        estimate: historyApi.estimate,
        start: historyApi.start,
        cancel: historyApi.cancel,
        status: historyApi.status,
        models: historyApi.models,
        defaults: resolved.historyBackfill,
      },
    })
  })

  if (resolved.injectProfile || resolved.ingest !== 'off') {
    ctx.on('agent/pre-step', (payload, next) => backgroundAbort.signal.aborted ? next() : trackBackground(preStep(ctx, openStore, openStoreForProjectCwd, resolved, embedder, preStepState, logIngestRequest, { ...payload, signal: AbortSignal.any([payload.signal, backgroundAbort.signal]) }, next)), { prepend: true })
  }

  // Release the session's evidence batches as soon as the session ends (in-process registry, avoiding accumulation in long-lived processes).
  ctx.on('session/disposed', (session) => {
    evidenceBatches.clear(String(session.id))
  })

  if (resolved.ingest !== 'off') {
    // Final-turn ingest closure: disposed is a fire-and-forget observer (the host does not wait), with a 5-second timeout;
    // failure/timeout lands a pending key via ingestFinalTurn, replayed as catch-up on the next session's first pre-step.
    // A .catch must be attached: the host treats an unhandled rejection as fatal (installFailLoud → process.exit),
    // and at dispose time the session event source may already be detached — any escaping exception becomes a whole DSH process exit.
    ctx.on('session/disposed', (session) => {
      const mode = resolved.ingest
      if (mode === 'off') return
      // After dispose the event source may detach: take the event snapshot and cwd once in the synchronous segment, shared by ingest and summary.
      const events = session.snapshotEvents() as unknown as readonly SessionEventLike[]
      const sessionId = String(session.id)
      const cwd = sessionCwd(session)
      startBackground(() => ingestFinalTurn({
        events,
        sessionId,
        turn: 0,
        slice: 'last',
        openStore: () => openStore('user'),
        openAuditStore: () => openStore('user'),
        // The final-turn catch-up likewise lands in the project palace by that session's cwd and judges scope per item.
        ...ingestWriteRouting(cwd, openStoreForProjectCwd, openStore),
        embedder,
        mode,
        routeOverride: resolved.routeOverride,
        ...resolveJevField(resolved.jev, resolved.dbDir),
        call: params => streamText(ctx, { ...params, sessionId: session.id }),
        logRequest: logIngestRequest,
        signal: AbortSignal.any([backgroundAbort.signal, AbortSignal.timeout(FINAL_INGEST_TIMEOUT_MS)]),
      })
        // After the final-turn ingest completes, generate a one-sentence summary of the whole session as a wrap-up: an ingest failure (null) usually means
        // the LLM is unreachable and the summary would fail too, so do not start the call. The summary uses an independent 5-second budget, not eating into the ingest's timeout allowance.
        .then(outcome => {
          if (outcome === null || backgroundAbort.signal.aborted) return undefined
          return ensureSessionSummary({
            events,
            sessionId,
            // The summary lands in the session's primary store (same basis as history backfill): with a cwd it lands in that project store, without a cwd in the user store.
            openStore: () => (cwd === undefined ? openStore('user') : openStoreForProjectCwd(cwd)),
            call: params => streamText(ctx, { ...params, sessionId: session.id }),
            logRequest: logIngestRequest,
            mode,
            routeOverride: resolved.routeOverride,
            signal: AbortSignal.any([backgroundAbort.signal, AbortSignal.timeout(FINAL_INGEST_TIMEOUT_MS)]),
            round: lastTurnNumber(events),
          })
        })
        .catch((error: unknown) => {
          if (!backgroundAbort.signal.aborted) console.warn('[dsh-engram] session-end wrap-up handling exception (conversation unaffected):', error)
        }).then(() => {}))
    })
  }

  if (resolved.reflect !== 'off') {
    // Belief consolidation: disposed is a fire-and-forget observer. auto consolidates in the background (user store + the project store for a cwd that already has a store);
    // suggest only registers reflect-pending (the exit is the engram_reflect tool). Independent from the final-turn ingest —
    // reflect's material selection is idempotent (memories already serving as belief evidence are excluded); misses under concurrency are filled in by the next session end or a manual call.
    // All exceptions must be swallowed in place: the host treats an unhandled rejection as fatal (see the previous disposed listener).
    ctx.on('session/disposed', (session) => {
      // After dispose the event source may detach: take the event snapshot and cwd once in the synchronous segment.
      const events = session.snapshotEvents() as unknown as readonly SessionEventLike[]
      const sessionId = String(session.id)
      const cwd = sessionCwd(session)
      const route = resolved.routeOverride ?? routeFromEvents(events)
      const targets: { scope: EngramScope; open: () => Promise<EngramStore> }[] = [
        { scope: 'user', open: () => openStore('user') },
      ]
      // For project palaces, only process those whose store file already exists, avoiding creating empty stores for one-off cwds (same discipline as the decay schedule).
      if (cwd !== undefined && existsSync(join(resolved.dbDir, dbNameForCwd(cwd)))) {
        targets.push({ scope: 'project', open: () => openStoreForProjectCwd(cwd) })
      }
      startBackground(async () => {
        for (const target of targets) {
          if (backgroundAbort.signal.aborted) return
          try {
            const store = await target.open()
            if (resolved.reflect === 'suggest') {
              const detail = JSON.stringify({ scope: target.scope, sessionId })
              if (!await store.hasAudit('reflect-pending', detail)) {
                await store.audit('reflect-pending', 'AUX', detail)
              }
              continue
            }
            // auto: when the session has no model request the route cannot be resolved, so skip this time (filled in by the next session).
            if (route === undefined) continue
            const reflectionEmbedder = await embedder
            backgroundAbort.signal.throwIfAborted()
            const outcome = await reflectObservations({
              store,
              embedder: reflectionEmbedder,
              scope: target.scope,
              call: params => streamText(ctx, { ...params, sessionId: session.id }),
              logRequest: data => {
                startBackground(() => store.audit('reflect-request', 'AUX', JSON.stringify(data)).catch(() => { /* audit failures do not affect consolidation */ }))
              },
              route,
              signal: AbortSignal.any([backgroundAbort.signal, AbortSignal.timeout(FINAL_INGEST_TIMEOUT_MS)]),
            })
            if (outcome.formed + outcome.refined + outcome.confirmed + outcome.refuted > 0) {
              console.log(`[dsh-engram] belief consolidation complete (${target.scope}): formed ${String(outcome.formed)}, refined ${String(outcome.refined)}, maintained ${String(outcome.confirmed)}, refuted ${String(outcome.refuted)}`)
            }
          } catch (error) {
            if (!backgroundAbort.signal.aborted) console.warn(`[dsh-engram] session-end belief consolidation exception (${target.scope}, conversation unaffected):`, error)
          }
        }
      })
    })
  }

  // Decay schedule: runs once at startup, then once every 24 hours; entries with low importance that have not been accessed for a long time are archived (recoverable).
  const runDecay = async (): Promise<void> => {
    const targets: { label: string; open: () => Promise<EngramStore> }[] = [
      { label: 'user', open: () => openStore('user') },
    ]
    // There may be more than one project palace (one per workspace): only process those whose store file already exists, avoiding creating empty stores for workspaces.
    for (const palace of await projectPalaces()) {
      if (!existsSync(join(resolved.dbDir, palace.dbName))) continue
      targets.push({ label: `project "${palace.title}"`, open: () => openDb(palace.dbName) })
    }
    for (const target of targets) {
      if (backgroundAbort.signal.aborted) return
      const archived = await (await target.open()).decay({
        importanceBelow: resolved.decayImportanceBelow,
        olderThanDays: resolved.decayAfterDays,
      })
      if (archived > 0) console.warn(`[dsh-engram] decay schedule: archived ${archived} low-value memories from the ${target.label} store (verifiable via engram_review)`)
    }
  }
  startBackground(() => runDecay().catch((error: unknown) => {
    if (!backgroundAbort.signal.aborted) console.warn('[dsh-engram] initial decay schedule failed (skipped):', error)
  }))
  ctx.effect(
    () => {
      const timer = setInterval(() => {
        startBackground(() => runDecay().catch((error: unknown) => {
          if (!backgroundAbort.signal.aborted) console.warn('[dsh-engram] Scheduled decay failed (skipped):', error)
        }))
      }, 24 * 60 * 60 * 1000)
      return () => { clearInterval(timer) }
    },
    'dsh-engram: decay timer',
  )

  // Consolidate at startup and daily; without embeddings, archive and deduplicate heuristically, recording consolidation in op_log.
  const runConsolidateOnce = async (): Promise<void> => {
    try {
      const store = await openStore('user')
      const report = await runConsolidation(store, embedder, {
        signal: backgroundAbort.signal,
        olderThanDays: resolved.decayAfterDays,
        importanceBelow: resolved.decayImportanceBelow,
      })
      console.log(`[dsh-engram] Consolidation complete: archived ${String(report.archived)}, merged ${String(report.merged)}, skipped ${String(report.skipped)} (${String(report.tookMs)} ms)`)
    } catch (error) {
      if (!backgroundAbort.signal.aborted) console.warn('[dsh-engram] Consolidation failed (conversation unaffected):', error)
    }
  }
  startBackground(runConsolidateOnce)
  ctx.effect(
    () => {
      const timer = setInterval(() => { startBackground(runConsolidateOnce) }, 24 * 60 * 60 * 1000)
      return () => { clearInterval(timer) }
    },
    'dsh-engram: consolidation timer',
  )
}
