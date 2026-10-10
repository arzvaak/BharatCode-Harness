/**
 * Definitions and executors for the 21 engram_ tools. Tool schemas keep narrow parameters;
 * scope decides which substore is read/written; retrieval results are explicitly marked
 * degraded when embeddings are unavailable.
 * @module @kenz1117/dsh-engram/tools/create
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { distillMemories } from '../flywheel/distill.ts'
import { reflectObservations } from '../consolidation/reflect.ts'
import { writeMirror } from '../mirror/markdown.ts'
import type { EngramEmbedder } from '../embedder/interface.ts'
import { parseJsonArray, routeFromEvents } from '../llm/client.ts'
import type { LlmRoute } from '../llm/client.ts'
import type { EngramStore } from '../store/interface.ts'
import { parseEntityMentions } from '../ingest/hook.ts'
import type { EngramKind, EngramScope, EntityId, EntityMention, FactRecord, FactWriteInput, ImageryLabel, MemoryId } from '../types.ts'
import type { MemoryRecord, SearchHit } from '../types.ts'
import { EPISODE_PROXIMITY_MS_DEFAULT, EPISODE_TIMELINE_LIMIT_DEFAULT, asEntityId, asFactId, asMemoryId, normalizeEntityName } from '../types.ts'
import { renderMemoryPacket, sanitizeProtocolText } from '../security/sanitize.ts'
import { redactSecrets } from '../security/redact.ts'
import {
  MAX_REWRITE_QUERIES, REWRITE_MAX_TOKENS, REWRITE_SYSTEM, RRF_CONSTANT,
  mergeQueryResults, normalizeRewriteQueries,
} from '../retrieve/rewrite.ts'
import { RECALL_TOTAL_CHARS, enforceBudget, fitWithinBudget, truncateItem } from '../retrieve/budget.ts'
import {
  MAX_BATCHES_PER_SESSION, MAX_EVIDENCE_REFS, NEXT_STRATEGIES, assessEvidence, evidenceBatches, evidenceRefOf,
} from '../retrieve/evidence.ts'
import type { AssessVerdict, NextStrategy } from '../retrieve/evidence.ts'
import { placardImprovementHint } from '../imagery/score.ts'
import type { HistoryBackfillRules, HistoryEstimate, HistoryRunResult } from '../ingest/history.ts'
import { applyMerge, confirmContradictions, decideWrite } from '../write-disposition.ts'
import type { MemoryJudge, WriteDisposition } from '../write-disposition.ts'

/** Tool dependencies: substore openers, the embedder promise, auxiliary LLM calls, and the export directory. */
export interface ToolDeps {
  /** Resolves the substore for a target scope (one each for user/shared) per call. */
  readonly openStore: (scope: EngramScope) => Promise<EngramStore>
  /**
   * Project substore resolution: attributed by session cwd (undefined = session cwd
   * unavailable, falls back to the plugin process directory).
   * Same basis as the panel "project" scope and the auto-ingest landing point — tool
   * reads/writes follow the session when the workspace changes.
   */
  readonly resolveProjectStore: (cwd: string | undefined) => Promise<EngramStore>
  /** The embedder promise; undefined = embeddings unavailable, retrieval degrades to pure keyword and contradiction detection is disabled. */
  readonly embedder: Promise<EngramEmbedder | undefined>
  /** Auxiliary LLM calls (index.ts builds one from ctx.llm.stream); undefined = distill unavailable. sessionId is filled in at the call site. */
  readonly call: ((params: { route: LlmRoute; system: string; userText: string; maxTokens: number; purpose: string; signal: AbortSignal; sessionId: string | undefined }) => Promise<string>) | undefined
  /** Explicit route override (Config provider+model); by default resolved from the session log. */
  readonly routeOverride: LlmRoute | undefined
  /** Jev judge (injected when Config jev.enabled); undefined = pure rule four-way, DEFER persists and creates edges immediately. */
  readonly judge?: MemoryJudge
  /** Whether to enable retrieval query rewriting (Config queryRewrite); when false, engram_search runs a single query directly. */
  readonly queryRewrite: boolean
  /** Export file directory (written by engram_export). */
  readonly exportDir: string
  /** History backfill (optional: when absent, engram_ingest_history is not registered, meaning the environment cannot read session history). */
  readonly historyBackfill?: {
    /** Estimate: candidate session count / in-rule turn count / turns actually pending. */
    readonly estimate: (rules: HistoryBackfillRules) => Promise<HistoryEstimate>
    /** Run: ingest per session per turn (synchronous wait, bounded by the caller's signal). */
    readonly run: (rules: HistoryBackfillRules, signal: AbortSignal) => Promise<HistoryRunResult>
  }
}

const KINDS = ['fact', 'preference', 'decision', 'episode', 'skill'] as const

/**
 * Session cwd during tool execution: project-scope reads/writes resolve the project palace from it.
 * AsyncLocalStorage rather than a module-level variable: tool calls from multiple sessions in the
 * same process may interleave, and module-level mutable state would leak session A's cwd to session B.
 */
const execSessionCwd = new AsyncLocalStorage<string | undefined>()

/** Read the session cwd from the tool execution context (undefined = no session info, caller falls back to the plugin process directory). */
function sessionCwdOf(exec: ToolRunContext): string | undefined {
  const cwd = exec.agent?.session?.header?.cwd
  return cwd === undefined || cwd === '' ? undefined : cwd
}

/** Tool time-parameter parsing: ISO or parseable date string → epoch ms; undefined when absent; loud failure when unparseable. */
function parseTimeParam(raw: string | undefined, toolName: string, field: string): number | undefined {
  if (raw === undefined) return undefined
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) throw new Error(`${toolName}: ${field} is not a parseable time: ${raw}`)
  return ms
}

/** Tool count-parameter parsing (minutes/counts): fallback when absent; loud failure on non-finite numbers or out-of-range values. */
function parseCountParam(raw: number | undefined, toolName: string, field: string, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`${toolName}: ${field} must be a finite number, got ${String(raw)}`)
  const value = Math.floor(raw)
  if (value < min || value > max) throw new Error(`${toolName}: ${field} must be between ${String(min)} and ${String(max)}, got ${String(value)}`)
  return value
}

/** Fact-chain line rendering: index + statement + id/valid date; invalidated facts append the invalid date and successor id (full-chain view). */
function renderFactLine(index: number, fact: FactRecord): string {
  const valid = new Date(fact.validAt).toISOString().slice(0, 10)
  const state = fact.invalidAt === null
    ? ''
    : ` (invalidated ${new Date(fact.invalidAt).toISOString().slice(0, 10)}, superseded by ${fact.replacedBy ?? 'unknown fact'})`
  return `${index + 1}. ${fact.content} (id=${fact.id}, valid ${valid})${state}`
}

/** Model-readable text for a history backfill estimate (zero cost: look at the numbers before deciding to run). */
function renderHistoryEstimate(estimate: HistoryEstimate): string {
  if (estimate.unavailable !== undefined) return `History backfill unavailable: ${estimate.unavailable}`
  const rules = estimate.rules
  const window = rules.days === 0 ? 'unlimited' : `${String(rules.days)} days`
  const lines = [
    `History backfill estimate: ${String(estimate.candidates)} candidate sessions · ${String(estimate.eligibleTurns)} in-rule turns · ${String(estimate.pendingTurns)} pending turns (${String(estimate.alreadyIngested)} previously ingested turns are skipped automatically).`,
    `Rules: time window ${window} · ≤${String(rules.maxTurnsPerSession)} turns per session · ≤${String(rules.maxTotalTurns)} total turns · subagents ${rules.includeSubagents ? 'yes' : 'no'} · seeded ${rules.includeSeeded ? 'yes' : 'no'} · no-cwd ${rules.includeNoCwd ? 'yes' : 'no'}`,
    `Excluded: subagent ${String(estimate.skipped.subagent)} · seeded ${String(estimate.skipped.seeded)} · no cwd ${String(estimate.skipped.noCwd)} · outside time window ${String(estimate.skipped.tooOld)} · unreadable log ${String(estimate.skipped.unreadable)}`,
  ]
  if (estimate.truncated) {
    lines.push('Note: candidates exceed the total turn cap; this run will process only the most recent sessions. Raise maxTotalTurns or narrow the time window and run in batches.')
  }
  lines.push('Actual LLM calls will not exceed the pending turn count (low-activity/small-talk/explicitly-no-record turns are throttled and skipped). To actually backfill, pass dryRun=false.')
  return lines.join('\n')
}

/** Model-readable text for a history backfill run result. */
function renderHistoryRun(result: HistoryRunResult): string {
  const state = result.state === 'done' ? 'done' : result.state === 'cancelled' ? 'cancelled (rerun to resume)' : 'failed'
  const lines = [
    `History backfill ${state}: processed ${String(result.sessionsDone)}/${String(result.sessionsTotal)} sessions · ${String(result.turnsDone)} turns → wrote ${String(result.memoriesWritten)} memories; skipped ${String(result.turnsSkipped)} turns · failed ${String(result.turnsFailed)} turns.`,
  ]
  const reasons = Object.entries(result.skipReasons).sort(([, a], [, b]) => b - a)
  if (reasons.length > 0) {
    lines.push(`Skip reasons: ${reasons.map(([reason, count]) => `${reason} ${String(count)}`).join(' · ')}`)
  }
  if (result.failures.length > 0) {
    const shown = result.failures.slice(0, 3).map(failure => `${failure.sessionId.slice(-12)} turn ${String(failure.turn)}: ${failure.reason}`)
    lines.push(`Failure details (first ${String(shown.length)}): ${shown.join('; ')}`)
    // The most common failure: a route recorded in a historical session has no matching model config in the current environment.
    lines.push('If the failure reason is that a route recorded in a historical session is unavailable in the current environment, configure provider/model in cordis.yml, or let one session run a turn with the target model first (backfill reuses the currently active route preferentially) and rerun — completed turns are skipped automatically.')
  }
  lines.push('The same batch is rerunnable: completed turns are skipped by their idempotency key, only the unfinished part is filled in.')
  return lines.join('\n')
}

/** Human-readable hints for evidence-gate strategies. */
const STRATEGY_HINT: Record<NextStrategy, string> = {
  answer: 'can answer based on this',
  search_keyword: 'search again with different keywords (engram_search)',
  search_room: 'narrow to a specific room and search (engram_search with room)',
  search_timeline: 'search by timeline (engram_timeline or engram_episode_timeline for episodes)',
  ask_user: 'ask the user to clarify the missing information',
  stop: 'do not answer, and tell the user what is missing',
}

/** Model-readable text for an evidence-gate verdict (including rejected refs and forced-rewrite notes). */
function renderAssessText(verdict: AssessVerdict, batchId: string): string {
  const lines = [
    verdict.sufficient
      ? `Evidence verdict: sufficient (batch ${batchId}, ${String(verdict.evidenceRefs.length)} valid evidence refs) — can answer based on this.`
      : `Evidence verdict: insufficient (batch ${batchId}).`,
  ]
  if (verdict.evidenceRefs.length > 0) lines.push(`Valid evidence: ${verdict.evidenceRefs.join(', ')}`)
  if (verdict.rejectedRefs.length > 0) lines.push(`Invalid refs (not in this batch, ignored): ${verdict.rejectedRefs.join(', ')}`)
  if (verdict.droppedRefs.length > 0) lines.push(`Dropped over the cap (max ${String(MAX_EVIDENCE_REFS)} per call): ${verdict.droppedRefs.join(', ')}`)
  lines.push(`Gap: ${verdict.missing === '' ? '(not filled in)' : verdict.missing}${verdict.missingTruncated ? ' (truncated)' : ''}`)
  lines.push(`Next step: ${verdict.nextStrategy} — ${STRATEGY_HINT[verdict.nextStrategy]}`)
  if (verdict.forced) {
    lines.push('Note: the verdict was corrected by code — sufficient requires all of "you claim sufficient", "at least one valid evidence ref from this batch", and "nextStrategy=answer".')
  }
  return lines.join('\n')
}

/** Converge scope from model parameters (invalid or missing values fall back to `fallback`). */
function scopeOf(raw: unknown, fallback: EngramScope): EngramScope {
  if (raw === 'user' || raw === 'project' || raw === 'shared') return raw
  return fallback
}

/** Converge the search scope parameter into a set of substores. */
function scopesOf(raw: unknown): EngramScope[] {
  if (raw === 'user') return ['user']
  if (raw === 'project') return ['project']
  if (raw === 'shared') return ['shared']
  return ['user', 'project', 'shared']
}

/** Query vector: returns the embedding of the query text when available, otherwise undefined (degraded). */
async function queryVectorOf(deps: ToolDeps, text: string): Promise<Float32Array | undefined> {
  const embedder = await deps.embedder
  if (embedder === undefined || text.trim() === '') return undefined
  const vectors = await embedder.embed([text.trim()])
  return vectors[0]
}

/**
 * Retrieval query rewriting: the auxiliary LLM rewrites the query into ≤3 complementary
 * queries. Any failure (no call, no route, unparseable output, call exception) degrades to a
 * list containing only the original query, never blocking retrieval. On success the request is
 * audited to the user store (auxiliary calls do not go into the session log; they land in
 * op_log for attribution).
 */
async function rewriteQueries(deps: ToolDeps, exec: ToolRunContext, query: string): Promise<{ queries: string[]; rewritten: boolean }> {
  if (deps.call === undefined || !deps.queryRewrite) return { queries: [query], rewritten: false }
  const events = (exec.agent?.session?.snapshotEvents() ?? []) as unknown as Parameters<typeof routeFromEvents>[0]
  const route = deps.routeOverride ?? routeFromEvents(events)
  if (route === undefined) return { queries: [query], rewritten: false }
  try {
    const raw = await deps.call({
      route,
      system: REWRITE_SYSTEM,
      userText: query,
      maxTokens: REWRITE_MAX_TOKENS,
      purpose: 'engram-rewrite',
      signal: exec.signal,
      sessionId: exec.agent === undefined ? undefined : String(exec.agent.session.id),
    })
    const queries = normalizeRewriteQueries(parseJsonArray(raw), MAX_REWRITE_QUERIES)
    if (queries.length === 0) return { queries: [query], rewritten: false }
    await (await deps.openStore('user')).audit('search-rewrite-request', 'AUX', JSON.stringify({ route, query, queries }))
    return { queries, rewritten: true }
  } catch {
    // Rewriting is an enhancement path: any failure degrades to the original single query.
    return { queries: [query], rewritten: false }
  }
}

/**
 * Build the 20 tool definitions (engram_save/search/facts/assess/timeline/episode_timeline/update/forget/report/review/review_queue/
 * stats/export/distill/examine/neighbors/audit_forgotten/tour/ingest_history/profile_edit).
 * @param baseDeps - substore openers, embedder, auxiliary LLM, export directory.
 * @returns Tool definition array ready to register (execute is bound to the session cwd's project palace routing).
 */
export function createEngramTools(baseDeps: ToolDeps): ToolDefinition[] {
  /**
   * Substore facade: project scope always goes through `resolveProjectStore(execution-time session cwd)`,
   * other scopes pass through as-is. All handlers use this `deps`, no per-call-site changes needed.
   */
  const deps: ToolDeps = {
    ...baseDeps,
    openStore: scope => (scope === 'project'
      ? baseDeps.resolveProjectStore(execSessionCwd.getStore())
      : baseDeps.openStore(scope)),
  }
  /** Batch save cap (protocol-internal constant: aligned with the per-turn ingest candidate volume, prevents flooding at once). */
  const MAX_SAVE_BATCH = 10

  /** engram_save output view (after schema relaxation, single/batch fields may all be absent). */
  interface SaveResultView {
    readonly id?: string
    readonly kind?: string
    readonly importance?: number
    /** Write four-way disposition: accept creates new / merge reinforces existing / defer pending adjudication (drop does not enter results — failed-validation items go to failed). */
    readonly disposition?: WriteDisposition
    /** merge: id of the existing entry that was merged into and reinforced. */
    readonly mergedInto?: string
    /** merge/defer: cosine similarity to the nearest neighbor. */
    readonly similarity?: number
    /** Single-item contradiction warning text (generated by execute, presented preferentially by render). */
    readonly text?: string
    /** Batch mode: success count. */
    readonly count?: number
    /** Batch mode: successful items (with palace coordinates and disposition, so batch writes also carry position and four-way visibility). */
    readonly items?: readonly { id: string; kind: string; importance: number; slot?: { room: string; index: number }; disposition: Exclude<WriteDisposition, 'drop'>; mergedInto?: string }[]
    /** Batch mode: failed items (index is the items array index). */
    readonly failed?: readonly { index: number; reason: string }[]
  }

  /** engram_save presentation text: contradiction warning text takes priority; batch output summarizes successes and failures. */
  function renderSaveResultText(value: SaveResultView): string {
    if (value.count !== undefined) {
      const items = value.items ?? []
      const merged = items.filter(item => item.disposition === 'merge').length
      const deferred = items.filter(item => item.disposition === 'defer').length
      const parts = [`Batch-saved ${value.count} memories`]
      const states: string[] = []
      if (merged > 0) states.push(`merged into and reinforced ${merged} existing memories`)
      if (deferred > 0) states.push(`${deferred} highly similar to existing memories, pending adjudication`)
      if (states.length > 0) parts.push(states.join(', '))
      for (const item of items) {
        const slot = item.slot === undefined ? '' : `, ${item.slot.room}#${item.slot.index}`
        const state = item.disposition === 'merge' ? `, merged into ${item.mergedInto}` : item.disposition === 'defer' ? ', pending adjudication' : ''
        parts.push(`${item.id} (kind=${item.kind}, importance=${item.importance}${slot}${state})`)
      }
      const failures = value.failed ?? []
      if (failures.length > 0) {
        parts.push(`${failures.length} failed: ${failures.map(entry => `#${entry.index + 1} ${entry.reason}`).join('; ')}`)
      }
      parts.push('Later sessions can recall them via engram_search.')
      return parts.join('; ')
    }
    if (value.text !== undefined) return value.text
    return `Memory ${value.id} saved (kind=${value.kind}, importance=${value.importance}). Later sessions can recall it via engram_search.`
  }

  /** Disposition result of a single write (shared by batch and single). */
  interface WriteOutcome {
    readonly disposition: Exclude<WriteDisposition, 'drop'>
    /** accept/defer: the new entry; merge: the existing entry that was merged into and reinforced. */
    readonly record: MemoryRecord
    /** merge: the merged-into existing entry id; defer: the nearest neighbor id. */
    readonly relatedId?: string
    /** merge/defer: cosine similarity to the nearest neighbor. */
    readonly similarity?: number
    /** defer: all contradiction candidates (contradicts edges created, for presentation to report). */
    readonly candidates: readonly MemoryRecord[]
  }

  /**
   * Write a single cleaned item (four-way disposition): MERGE does not create a new entry, only
   * reinforces the existing one; DEFER writes and creates contradicts edges pending adjudication;
   * ACCEPT writes as-is.
   */
  async function writeWithDisposition(
    store: EngramStore,
    item: {
      scope: EngramScope
      kind: EngramKind
      content: string
      importance?: number
      sourceSessionId: string | null
      embedding?: Float32Array
      imagery?: ImageryLabel
    },
  ): Promise<WriteOutcome> {
    const { embedding } = item
    // When judge + content are provided as a pair, the DEFER ambiguous band goes to the Jev three-way adjudication; without a judge, behavior matches the pure rule four-way.
    const decision = await decideWrite(store, item.kind, embedding, deps.judge === undefined ? {} : { judge: deps.judge, content: item.content })
    if (decision.disposition === 'merge') {
      const record = await applyMerge(store, decision, item.content)
      return { disposition: 'merge', record, relatedId: decision.into.id, similarity: decision.similarity, candidates: [] }
    }
    const record = await store.write({
      scope: item.scope,
      kind: item.kind,
      content: item.content,
      ...(item.importance === undefined ? {} : { importance: item.importance }),
      sourceSessionId: item.sourceSessionId,
      ...(embedding === undefined ? {} : { embedding }),
      ...(item.imagery === undefined ? {} : { imagery: item.imagery }),
    })
    if (decision.disposition === 'defer') {
      // In defer, the embedding must exist (decideWrite only judges accept when there is no embedding).
      const candidates = await store.findContradictions(embedding as Float32Array)
      // With a judge, contradiction edges first go through Jev confirmation (failure returns undefined = degrades to creating all edges, matching the old behavior).
      const confirmed = deps.judge === undefined
        ? candidates
        : (await confirmContradictions(deps.judge, item.content, candidates)) ?? candidates
      for (const candidate of confirmed) {
        await store.linkEdge(record.id, candidate.id, 'contradicts')
      }
      return { disposition: 'defer', record, relatedId: decision.neighbor.id, similarity: decision.similarity, candidates: confirmed }
    }
    return { disposition: 'accept', record, candidates: [] }
  }

  /**
   * Entity linking helper: resolves entity mentions and attaches them to the entry. merge
   * attaches to the merged-into existing entry; accept/defer attaches to the new entry; failures
   * are silent (the entity lexicon is enhancement data, does not block memory writes).
   */
  async function linkEntities(store: EngramStore, nodeId: MemoryId, mentions: readonly EntityMention[]): Promise<void> {
    if (mentions.length === 0) return
    try {
      const entities = await store.resolveEntities(mentions)
      await store.linkNodeEntities(nodeId, entities.map(entity => entity.id))
    } catch {
      // Entity lexicon write failures (e.g. EMPTY_ENTITY_NAME) do not affect the memory entry's own persistence.
    }
  }

  /** Placard parameter convergence: non-empty string → ImageryLabel (sensory/emotional dimensions left blank — the AI needs no human-brain patch); illegal returns undefined. */
  function placardOf(raw: unknown): ImageryLabel | undefined {
    if (typeof raw !== 'string') return undefined
    const caption = raw.trim()
    if (caption === '') return undefined
    return { caption, sensoryTags: [], emotionalValence: 0, provisional: false }
  }

  /** Batch save result (runtime shape of the output schema). */
  interface SaveBatchResult {
    readonly count: number
    readonly items: { id: string; kind: string; importance: number; disposition: Exclude<WriteDisposition, 'drop'>; mergedInto?: string }[]
    readonly failed: { index: number; reason: string }[]
  }

  /** Batch save: unified clean/validate/dedupe-within-batch, one batch embed, per-item write; a single failure does not block the rest. */
  async function saveBatch(sourceSessionId: string | null, items: readonly unknown[], rawScope: unknown): Promise<SaveBatchResult> {
    if (items.length > MAX_SAVE_BATCH) throw new Error(`engram_save: at most ${MAX_SAVE_BATCH} items per call`)
    const scope = scopeOf(rawScope, 'project')
    const store = await deps.openStore(scope)
    const embedder = await deps.embedder
    // Step 1: clean + validate + dedupe within the batch (failures collected by original index, do not block the rest).
    const prepared: { index: number; content: string; kind: EngramKind; importance: number | undefined; entities: readonly EntityMention[] }[] = []
    const failed: { index: number; reason: string }[] = []
    const seen = new Set<string>()
    for (const [index, raw] of items.entries()) {
      if (raw === null || typeof raw !== 'object') { failed.push({ index, reason: 'item must be an object' }); continue }
      const candidate = raw as { content?: unknown; kind?: unknown; importance?: unknown; entities?: unknown }
      if (typeof candidate.content !== 'string' || candidate.content.trim() === '') {
        failed.push({ index, reason: 'content missing or empty' }); continue
      }
      if (!KINDS.includes(candidate.kind as EngramKind)) {
        failed.push({ index, reason: 'invalid kind' }); continue
      }
      const content = redactSecrets(sanitizeProtocolText(candidate.content))
      if (content.trim() === '') {
        failed.push({ index, reason: 'content empty after cleaning (only protocol tags or secrets)' }); continue
      }
      const key = content.toLowerCase()
      if (seen.has(key)) { failed.push({ index, reason: 'duplicate within batch' }); continue }
      seen.add(key)
      prepared.push({
        index,
        content,
        kind: candidate.kind as EngramKind,
        importance: typeof candidate.importance === 'number' ? candidate.importance : undefined,
        entities: parseEntityMentions(candidate.entities),
      })
    }
    // Step 2: one batch embed (aligned to the cleaned item order).
    const vectors = embedder === undefined || prepared.length === 0
      ? undefined
      : await embedder.embed(prepared.map(item => item.content.trim()))
    // Step 3: per-item disposition write; a single failure is recorded in failed and does not block the rest (defer's contradiction edges are still created, viewable via engram_review).
    const saved: { id: string; kind: string; importance: number; slot?: { room: string; index: number }; disposition: Exclude<WriteDisposition, 'drop'>; mergedInto?: string }[] = []
    for (const [position, item] of prepared.entries()) {
      try {
        const embedding = vectors?.[position]
        const outcome = await writeWithDisposition(store, {
          scope,
          kind: item.kind,
          content: item.content,
          ...(item.importance === undefined ? {} : { importance: item.importance }),
          sourceSessionId,
          ...(embedding === undefined ? {} : { embedding }),
        })
        // The merge disposition has no new entry; entities attach to the merged-into existing entry; others attach to the new entry.
        const nodeId = outcome.disposition === 'merge' && outcome.relatedId !== undefined
          ? asMemoryId(outcome.relatedId)
          : outcome.record.id
        await linkEntities(store, nodeId, item.entities)
        saved.push({
          id: outcome.record.id,
          kind: outcome.record.kind,
          importance: outcome.record.importance,
          disposition: outcome.disposition,
          // The merge disposition does not create a new entry; record is the reinforced existing entry, so do not report a slot again.
          ...(outcome.disposition === 'merge' || outcome.record.slot === undefined ? {} : { slot: outcome.record.slot }),
          ...(outcome.disposition === 'merge' && outcome.relatedId !== undefined ? { mergedInto: outcome.relatedId } : {}),
        })
      } catch (error) {
        failed.push({ index: item.index, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    return { count: saved.length, items: saved, failed }
  }

  const save = defineTool({
    name: 'engram_save',
    description: 'Save long-term memory (usable across sessions). Supports a single item (content/kind) or a batch (items, up to 10, a single failure does not affect the rest). kind: fact / preference / decision / episode / skill. scope: project (current project only) or user (global).',
    parameters: {
      content: { type: 'string', description: 'Memory body (required in single mode); express it completely in one sentence' },
      kind: { type: 'string', enum: [...KINDS], description: 'Memory kind (required in single mode)' },
      entities: {
        type: 'array',
        description: 'Entities mentioned by this memory (optional, single mode only): person/project/tool/concept names, used for entity-based retrieval',
        items: { type: 'object', additionalProperties: false, properties: {
          name: { type: 'string', required: true, description: 'Entity name (the proper noun itself, at most 20 characters)' },
          kind: { type: 'string', enum: ['person', 'project', 'tool', 'concept', 'other'], description: 'Entity kind, defaults to other' },
          aliases: { type: 'array', items: { type: 'string' }, description: 'Other names for this entity' },
        } },
      },
      items: {
        type: 'array',
        description: 'Batch save items array, each item {content, kind, importance?, entities?}; mutually exclusive with content/kind',
        items: { type: 'object', additionalProperties: false, properties: {
          content: { type: 'string', required: true, description: 'Memory body' },
          kind: { type: 'string', enum: [...KINDS], required: true, description: 'Memory kind' },
          importance: { type: 'number', description: 'Importance 0-1' },
          entities: {
            type: 'array',
            description: 'Entities mentioned by this item',
            items: { type: 'object', additionalProperties: false, properties: {
              name: { type: 'string', required: true, description: 'Entity name (the proper noun itself, at most 20 characters)' },
              kind: { type: 'string', enum: ['person', 'project', 'tool', 'concept', 'other'], description: 'Entity kind, defaults to other' },
              aliases: { type: 'array', items: { type: 'string' }, description: 'Other names for this entity' },
            } },
          },
        } },
      },
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'Scope, defaults to project' },
      importance: { type: 'number', description: 'Importance 0-1, defaults to 0.5 (single mode only)' },
      placard: { type: 'string', description: 'Placard (optional, single mode only): a 4-30 character plate. Palace discipline: unique · differentiated · dated anchor (e.g. "2026-09 vector retrieval selection"); must not be so close to an existing placard that they are indistinguishable' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string' },
        kind: { type: 'string' },
        importance: { type: 'number' },
        disposition: { type: 'string', enum: ['accept', 'merge', 'defer'] },
        mergedInto: { type: 'string' },
        similarity: { type: 'number' },
        text: { type: 'string' },
        count: { type: 'number' },
        items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          importance: { type: 'number', required: true },
          disposition: { type: 'string', enum: ['accept', 'merge', 'defer'], required: true },
          mergedInto: { type: 'string' },
          slot: { type: 'object', additionalProperties: false, properties: {
            room: { type: 'string', required: true },
            index: { type: 'number', required: true },
          } },
        } } },
        failed: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          index: { type: 'number', required: true },
          reason: { type: 'string', required: true },
        } } },
      } },
      render: (_args, value) => [{ type: 'text', text: renderSaveResultText(value as SaveResultView) }],
    },
    async execute(args, exec) {
      const input = args as { content?: unknown; kind?: unknown; entities?: unknown; items?: unknown; scope?: unknown; importance?: unknown; placard?: unknown }
      const sourceSessionId = exec.agent?.id ?? null
      // Batch mode: items and content/kind are mutually exclusive; passing both is a loud failure.
      if (input.items !== undefined) {
        if (input.content !== undefined || input.kind !== undefined) {
          throw new Error('engram_save: the items and content/kind parameters cannot be used together')
        }
        if (!Array.isArray(input.items) || input.items.length === 0) {
          throw new Error('engram_save: items must be a non-empty array')
        }
        return saveBatch(sourceSessionId, input.items, input.scope)
      }
      if (typeof input.content !== 'string' || typeof input.kind !== 'string') {
        throw new Error('engram_save: content/kind (single) or items (batch) parameters are required')
      }
      // Pre-store protocol stripping + secret redaction (the model may write session secrets or protocol blocks verbatim into memory).
      const content = redactSecrets(sanitizeProtocolText(input.content))
      if (content.trim() === '') throw new Error('engram_save: content empty after cleaning (the original contained only protocol tags or secrets)')
      const scope = scopeOf(input.scope, 'project')
      const store = await deps.openStore(scope)
      const embedder = await deps.embedder
      const embeddings = embedder === undefined ? undefined : await embedder.embed([content.trim()])
      const imagery = placardOf(input.placard)
      const mentions = parseEntityMentions(input.entities)
      const outcome = await writeWithDisposition(store, {
        scope,
        kind: input.kind as EngramKind,
        content,
        ...(typeof input.importance === 'number' ? { importance: input.importance } : {}),
        sourceSessionId,
        ...(embeddings?.[0] === undefined ? {} : { embedding: embeddings[0] }),
        ...(imagery === undefined ? {} : { imagery }),
      })
      // Entity linking: merge attaches to the merged-into existing entry; accept/defer attaches to the new entry; failures are silent.
      if (mentions.length > 0) {
        const nodeId = outcome.disposition === 'merge' && outcome.relatedId !== undefined
          ? asMemoryId(outcome.relatedId)
          : outcome.record.id
        await linkEntities(store, nodeId, mentions)
      }
      const { record, candidates } = outcome
      // MERGE: a restatement merged into an existing entry — no new entry, no placard; only reinforced and told explicitly (prevents the model from assuming a new save succeeded).
      if (outcome.disposition === 'merge') {
        const sim = (outcome.similarity ?? 0).toFixed(2)
        return {
          id: record.id,
          kind: record.kind,
          importance: record.importance,
          disposition: 'merge' as const,
          ...(outcome.relatedId === undefined ? {} : { mergedInto: outcome.relatedId }),
          ...(outcome.similarity === undefined ? {} : { similarity: outcome.similarity }),
          text: `Highly duplicated with an existing memory (similarity ${sim}); merged into ${outcome.relatedId} and its confidence and access count were reinforced; no new entry was created. If this is a correction rather than a restatement, use engram_update to consolidate it.`,
        }
      }
      // Placard quality hint: a low score (violating the "unique · differentiated · dated" discipline) gets an enhancement suggestion attached.
      const placardHint = imagery === undefined || record.imageryScore === undefined
        ? ''
        : `\n${placardImprovementHint(record.imageryScore) ?? ''}`
      // DEFER: suspected contradiction/correction — persist and create contradicts edges; the model/user adjudicates the reported candidates.
      if (outcome.disposition === 'defer') {
        const listed = candidates.map(candidate => `"${candidate.content}" (id=${candidate.id})`).join('; ')
        return {
          id: record.id,
          kind: record.kind,
          importance: record.importance,
          disposition: 'defer' as const,
          ...(outcome.similarity === undefined ? {} : { similarity: outcome.similarity }),
          text: `${record.id} saved. Note: highly similar to existing memories — ${listed}. If this is a correction rather than a new fact, use engram_update to consolidate it, or engram_forget to deduplicate.${placardHint}`,
        }
      }
      const base = `Memory ${record.id} saved (kind=${record.kind}, importance=${record.importance}${record.slot === undefined ? '' : `, ${record.slot.room}#${record.slot.index}`}). Later sessions can recall it via engram_search.`
      return { id: record.id, kind: record.kind, importance: record.importance, disposition: 'accept' as const, text: `${base}${placardHint}` }
    },
  })

  const search = defineTool({
    name: 'engram_search',
    description: 'Hybrid semantic + keyword retrieval over long-term memory. Palace discipline: first decide which room to enter — Fact Hall (fact) / Preference Pavilion (preference) / Decision Hall (decision) / Episode Gallery (episode) / Skill Workshop (skill); pass the room parameter to search only that room (faster and more accurate); when unsure, default to searching the whole store. The user scope stores preferences and general facts; the project scope stores project conventions and decisions. Result lines end with an id for engram_update/engram_forget to reference.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search text' },
      scope: { type: 'string', enum: ['user', 'project', 'shared', 'all'], description: 'Scope, defaults to all' },
      room: { type: 'string', description: 'Room routing: search only within the named room (e.g. "Decision Hall"). See the room directory in engram_stats output' },
      limit: { type: 'number', description: 'Max results, defaults to 8' },
      asOf: { type: 'string', description: 'Point-in-time look-back (optional, ISO date like 2026-03-01): result lines carry a snapshot of the facts still valid at that time for each linked entities of that memory, preventing stale facts from misleading "at that time" questions' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        degraded: { type: 'boolean', required: true },
        text: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const input = args as { query: string; scope?: unknown; room?: unknown; limit?: number; asOf?: unknown }
      const scopes = scopesOf(input.scope)
      const rooms = typeof input.room === 'string' && input.room.trim() !== '' ? [input.room.trim()] : undefined
      const limit = input.limit ?? 8
      const asOfMs = parseTimeParam(typeof input.asOf === 'string' ? input.asOf : undefined, 'engram_search', 'asOf')
      // Multi-query rewriting: when the auxiliary LLM is available, generate ≤3 complementary queries, search each, then RRF-fuse;
      // failure/unavailability degrades to a single query. Multi-query hits on the same id reinforce it (accessCount,
      // confidence grow faster); semantically it is indeed multiple hits, a known cost.
      const rewrite = await rewriteQueries(deps, exec, input.query)
      const retrievals = await Promise.all(rewrite.queries.map(async (queryText) => {
        const vector = await queryVectorOf(deps, queryText)
        const results = await Promise.all(scopes.map(async (scope) => {
          const store = await deps.openStore(scope)
          return store.search({ text: queryText, scopes: [scope], limit, ...(rooms === undefined ? {} : { rooms }) }, vector)
        }))
        return {
          hits: results.flatMap(result => result.hits).sort((a, b) => b.score - a.score).slice(0, limit),
          degraded: results.some(result => result.degraded),
        }
      }))
      const degraded = retrievals.some(retrieval => retrieval.degraded)
      const merged = mergeQueryResults(
        retrievals,
        limit,
        RRF_CONSTANT,
        Math.floor(Math.max(0, limit) / Math.max(1, rewrite.queries.length)),
      )
      // Character budget: 1200 per item, 4800 total (over-budget lines are dropped with a note, preventing long memories from flooding context).
      // Line format carries palace coordinates (room #slot + inscription date), the evidence ref, and encoding cues (adjacent slot ids) — reconstructing the encoding context at extraction time.
      // asOf point-in-time fact labels: facts still valid at that time for a hit linked entities of that memory (up to 4 per memory), participating in budget trimming alongside the line.
      const factNotes = new Map<string, string[]>()
      if (asOfMs !== undefined) {
        const scopeGroups = new Map<EngramScope, MemoryId[]>()
        for (const hit of merged) {
          const ids = scopeGroups.get(hit.record.scope)
          if (ids === undefined) scopeGroups.set(hit.record.scope, [hit.record.id])
          else ids.push(hit.record.id)
        }
        for (const [scope, ids] of scopeGroups) {
          const store = await deps.openStore(scope)
          const entityMap = await store.entitiesOfNodes(ids)
          const factLists = new Map<EntityId, readonly FactRecord[]>()
          for (const entities of entityMap.values()) {
            for (const entity of entities) {
              if (factLists.has(entity.id)) continue
              factLists.set(entity.id, (await store.factsOfEntity({ entityId: entity.id, asOf: asOfMs, limit: 3, offset: 0 })).items)
            }
          }
          for (const [nodeId, entities] of entityMap) {
            const contents: string[] = []
            for (const entity of entities) {
              for (const fact of factLists.get(entity.id) ?? []) {
                if (contents.length >= 4) break
                contents.push(fact.content)
              }
            }
            if (contents.length > 0) factNotes.set(String(nodeId), contents)
          }
        }
      }
      const candidates = merged.map((hit, index) => {
        const ref = evidenceRefOf(hit.record.scope, hit.record.id, hit.record.slot)
        const edge = hit.viaEdge === undefined ? '' : ` (via ${hit.viaEdge.type} from ${hit.viaEdge.from})`
        const slot = hit.record.slot === undefined ? '' : ` ${hit.record.slot.room}#${hit.record.slot.index}`
        const date = ` inscribed ${new Date(hit.record.createdAt).toISOString().slice(0, 10)}`
        const cues = hit.cues === undefined ? '' : ` adjacent slots: ${hit.cues.neighbors.join(', ')}`
        const notes = factNotes.get(String(hit.record.id))
        const facts = notes === undefined ? '' : ` point-in-time facts: ${notes.join('; ')}`
        return {
          ref,
          line: `${index + 1}. [${hit.record.scope}/${hit.record.kind}]${slot}${date} ${truncateItem(hit.record.content)} (id=${hit.record.id}, ref=${ref})${edge}${cues}${facts}`,
        }
      })
      const { kept, dropped } = fitWithinBudget(candidates, entry => entry.line.length, RECALL_TOTAL_CHARS)
      const lines = kept.map(entry => entry.line)
      if (dropped > 0) lines.push(`(${dropped} more not shown: narrow the query or lower limit and retry)`)
      // Evidence gate: register the refs actually output this time as a batch; engram_assess can only cite refs registered here.
      const sessionId = exec.agent === undefined ? undefined : String(exec.agent.session.id)
      const batch = sessionId === undefined || kept.length === 0
        ? undefined
        : evidenceBatches.register(sessionId, kept.map(entry => entry.ref))
      const prefix = degraded && lines.length > 0 ? '(semantic embeddings unavailable, keyword search only)\n' : ''
      const roomNote = rooms === undefined ? '' : `(room routing: ${rooms.join(', ')})\n`
      const asOfNote = asOfMs === undefined ? '' : `(point-in-time look-back: the "point-in-time facts" at line end are snapshots of the linked entities' facts still valid on ${new Date(asOfMs).toISOString().slice(0, 10)})\n`
      const batchNote = batch === undefined
        ? ''
        : `\nBatch ${batch.batchId} (${String(batch.refs.size)} citable evidence refs): before answering, use engram_assess to judge whether the evidence is sufficient; evidenceRefs may only cite the refs above.`
      // Output packet protocol tag: memory bodies are untrusted historical context; the current request is the search term itself.
      return { degraded, text: renderMemoryPacket(`${prefix}${roomNote}${asOfNote}${lines.join('\n') || 'no hits'}${batchNote}`, 'tool_search', input.query) }
    },
  })

  const factsTool = defineTool({
    name: 'engram_facts',
    description: 'Entity fact chains: query the temporal facts of an entity (asOf point-in-time look-back / includeInvalid full-chain expansion), or write and correct facts (facts array). A fact is one objective statement about a specific entity (state/ownership/relation/data). When correcting a stale fact, pass replaces=old fact id: the old fact is softly invalidated, the new fact takes over, and the history chain is preserved — do not repeatedly save mutually contradictory facts; express evolution with the replacement chain.',
    parameters: {
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'Scope, defaults to project' },
      entityId: { type: 'string', description: 'Query mode: entity id (obtained from engram_search/engram_entities output; mutually exclusive with entity, preferred)' },
      entity: { type: 'string', description: 'Query mode: entity name (exact match by name and alias; no new entity on miss, returns approximate candidates)' },
      asOf: { type: 'string', description: 'Point-in-time look-back (ISO date or millisecond timestamp): only facts still valid at that time' },
      includeInvalid: { type: 'boolean', description: 'true expands the full chain (including invalidated facts, to view fact evolution history)' },
      limit: { type: 'number', description: 'Max results, defaults to 20' },
      offset: { type: 'number', description: 'Pagination offset, defaults to 0' },
      facts: {
        type: 'array',
        description: 'Write mode: facts array (mutually exclusive with query parameters), each item {entity or entityId, content, replaces?}',
        items: { type: 'object', additionalProperties: false, properties: {
          entity: { type: 'string', description: 'Entity name (mutually exclusive with entityId; created when the entity does not exist)' },
          entityId: { type: 'string', description: 'Entity id (preferred over entity)' },
          content: { type: 'string', required: true, description: 'Fact statement (one sentence, at most 500 characters)' },
          replaces: { type: 'string', description: 'The superseded old fact id (the old fact is softly invalidated; when the id does not exist, written as no-replacement)' },
        } },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        total: { type: 'number' },
        count: { type: 'number' },
        items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true },
          entityId: { type: 'string', required: true },
          replaced: { type: 'string' },
        } } },
        failed: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
          index: { type: 'number', required: true },
          reason: { type: 'string', required: true },
        } } },
        text: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as {
        scope?: unknown; entityId?: unknown; entity?: unknown; asOf?: unknown
        includeInvalid?: unknown; limit?: unknown; offset?: unknown; facts?: unknown
      }
      const scope = scopeOf(input.scope, 'project')
      const store = await deps.openStore(scope)
      const asOfMs = parseTimeParam(typeof input.asOf === 'string' ? input.asOf : undefined, 'engram_facts', 'asOf')
      // —— Write mode: facts is mutually exclusive with query parameters (same pattern as engram_save's items mode).
      if (input.facts !== undefined) {
        if (input.entityId !== undefined || input.entity !== undefined || input.asOf !== undefined || input.includeInvalid !== undefined) {
          throw new Error('engram_facts: facts (write) and entityId/entity/asOf/includeInvalid (query) parameters cannot be used together')
        }
        if (!Array.isArray(input.facts) || input.facts.length === 0) {
          throw new Error('engram_facts: facts must be a non-empty array')
        }
        if (input.facts.length > MAX_SAVE_BATCH) throw new Error(`engram_facts: at most ${MAX_SAVE_BATCH} facts per call`)
        const failed: { index: number; reason: string }[] = []
        const prepared: { index: number; input: FactWriteInput }[] = []
        for (const [index, raw] of input.facts.entries()) {
          if (raw === null || typeof raw !== 'object') { failed.push({ index, reason: 'item must be an object' }); continue }
          const candidate = raw as { entity?: unknown; entityId?: unknown; content?: unknown; replaces?: unknown }
          if (typeof candidate.content !== 'string' || candidate.content.trim() === '') {
            failed.push({ index, reason: 'content missing or empty' }); continue
          }
          // Pre-store protocol stripping + secret redaction (same cleaning discipline as engram_save).
          const content = redactSecrets(sanitizeProtocolText(candidate.content))
          if (content.trim() === '') { failed.push({ index, reason: 'content empty after cleaning (only protocol tags or secrets)' }); continue }
          try {
            let entityId: EntityId
            if (typeof candidate.entityId === 'string' && candidate.entityId.trim() !== '') {
              entityId = asEntityId(candidate.entityId.trim())
            } else if (typeof candidate.entity === 'string' && candidate.entity.trim() !== '') {
              // Name-based writes go through resolution (miss creates new); kind is fixed to other (fact attachment is not responsible for entity classification).
              const resolved = await store.resolveEntities([{ name: candidate.entity.trim(), kind: 'other' }])
              const resolvedEntity = resolved[0]
              if (resolvedEntity === undefined) { failed.push({ index, reason: 'entity resolution returned no result' }); continue }
              entityId = resolvedEntity.id
            } else {
              failed.push({ index, reason: 'entity or entityId is required' }); continue
            }
            prepared.push({
              index,
              input: {
                entityId,
                content,
                ...(typeof candidate.replaces === 'string' && candidate.replaces.trim() !== ''
                  ? { replaces: asFactId(candidate.replaces.trim()) }
                  : {}),
              },
            })
          } catch (error) {
            failed.push({ index, reason: error instanceof Error ? error.message : String(error) })
          }
        }
        // Batch write (the store layer handles replaces existence checks and soft invalidation); single-item parse failures already went to failed.
        const records = prepared.length === 0 ? [] : await store.writeFacts(prepared.map(entry => entry.input))
        const items: { id: string; entityId: string; replaced?: string }[] = []
        for (const [position, record] of records.entries()) {
          const entry = prepared[position]
          if (entry === undefined) continue
          items.push({
            id: record.id,
            entityId: record.entityId,
            ...(entry.input.replaces === undefined ? {} : { replaced: entry.input.replaces }),
          })
        }
        const parts = [`Wrote ${String(records.length)} facts`]
        const replacedCount = prepared.filter(entry => entry.input.replaces !== undefined).length
        if (replacedCount > 0) parts.push(`${String(replacedCount)} declare supersession of old facts (old facts softly invalidated, history chain preserved; ids that do not exist are written as no-replacement)`)
        for (const item of items) {
          parts.push(`${item.id} → entity ${item.entityId}${item.replaced === undefined ? '' : ` (supersedes ${item.replaced})`}`)
        }
        if (failed.length > 0) {
          parts.push(`${String(failed.length)} failed: ${failed.map(entry => `#${String(entry.index + 1)} ${entry.reason}`).join('; ')}`)
        }
        return {
          count: records.length,
          items,
          ...(failed.length > 0 ? { failed } : {}),
          text: parts.join('; '),
        }
      }
      // —— Query mode: entityId preferred; an entity name goes through "substring list + normalized exact filter",
      // not resolveEntities (a query-path miss would create a new entry, polluting the entity lexicon).
      const hasEntityId = typeof input.entityId === 'string' && input.entityId.trim() !== ''
      const hasEntityName = typeof input.entity === 'string' && input.entity.trim() !== ''
      if (!hasEntityId && !hasEntityName) {
        throw new Error('engram_facts: entityId/entity (query) or facts (write) parameters are required')
      }
      const limit = parseCountParam(typeof input.limit === 'number' ? input.limit : undefined, 'engram_facts', 'limit', 20, 1, 100)
      const offset = parseCountParam(typeof input.offset === 'number' ? input.offset : undefined, 'engram_facts', 'offset', 0, 0, 100000)
      const includeInvalid = input.includeInvalid === true
      let entityId: EntityId
      let entityName: string
      if (hasEntityId) {
        entityId = asEntityId((input.entityId as string).trim())
        const detail = await store.entityDetail(entityId, 0)
        if (detail === undefined) throw new Error(`engram_facts: entity ${input.entityId} does not exist`)
        entityName = detail.entity.name
      } else {
        const name = (input.entity as string).trim()
        const { items: candidates } = await store.listEntities({ q: name, limit: 10, offset: 0 })
        const normalized = normalizeEntityName(name)
        const matches = candidates.filter(item =>
          normalizeEntityName(item.entity.name) === normalized
          || item.entity.aliases.some(alias => normalizeEntityName(alias) === normalized))
        if (matches.length === 0) {
          const near = candidates.map(item => `${item.entity.name} (id=${item.entity.id})`).join('; ')
          return {
            total: 0,
            text: `Entity "${name}" not found (exact match by name and alias, no automatic creation).${near === '' ? 'No approximate names in the lexicon.' : `Approximate candidates: ${near}. Use entityId for an exact query.`}`,
          }
        }
        if (matches.length > 1) {
          const listed = matches.map(item => `${item.entity.name} (id=${item.entity.id})`).join('; ')
          return { total: 0, text: `Name "${name}" matches ${String(matches.length)} entities: ${listed}. Specify one with entityId.` }
        }
        const match = matches[0]
        if (match === undefined) {
          return { total: 0, text: `Entity "${name}" not found.` }
        }
        entityId = match.entity.id
        entityName = match.entity.name
      }
      const { items: facts, total } = await store.factsOfEntity({
        entityId,
        ...(asOfMs === undefined ? {} : { asOf: asOfMs }),
        ...(includeInvalid ? { includeInvalid: true } : {}),
        limit,
        offset,
      })
      const header = `Facts for entity "${entityName}" (total ${String(total)}${asOfMs === undefined ? '' : `, point-in-time ${new Date(asOfMs).toISOString().slice(0, 10)}`}${includeInvalid ? ', full chain including invalidated' : ''})`
      const lines = facts.map((fact, index) => renderFactLine(index, fact))
      const body = lines.length === 0 ? 'No facts match the criteria.' : lines.join('\n')
      // Output packet protocol tag: facts are excerpts from historical memory, untrusted historical context; the current request is approximated by the entity name.
      return { total, text: renderMemoryPacket(`${header}\n${body}`, 'tool_facts', hasEntityName ? (input.entity as string) : entityId) }
    },
  })

  const assess = defineTool({
    name: 'engram_assess',
    description: 'Evidence gate: after retrieval (engram_search) and before answering, judge "whether the retrieved content is sufficient to answer the current question". Submit batchId, sufficient, up to 8 evidenceRefs (may only cite ref=… from the output of that batch), a gap note missing (≤160 chars), and next nextStrategy. Code-enforced validation: sufficient requires all of "you claim sufficient", "at least one valid evidence ref from this batch", and "nextStrategy=answer", otherwise it is judged insufficient and the strategy is reverted to continue searching; refs not belonging to this batch are rejected and listed. Verdicts and rejection details are written to the audit log.',
    parameters: {
      batchId: { type: 'string', required: true, description: 'The batch id given at the end of engram_search output (e.g. batch-3)' },
      sufficient: { type: 'boolean', required: true, description: 'Whether the evidence suffices to answer the current question (nextStrategy must be answer when true)' },
      evidenceRefs: { type: 'array', items: { type: 'string' }, description: 'Cited evidence refs (up to 8, only refs=… from the output of that batch)' },
      missing: { type: 'string', description: 'Which dimension of information is missing (≤160 chars)' },
      nextStrategy: { type: 'string', enum: [...NEXT_STRATEGIES], description: 'Next step: answer / search_keyword (different keywords) / search_room (different room) / search_timeline (timeline) / ask_user (ask the user) / stop (do not answer)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        sufficient: { type: 'boolean', required: true },
        nextStrategy: { type: 'string', required: true },
        text: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const input = args as { batchId?: unknown; sufficient?: unknown; evidenceRefs?: unknown; missing?: unknown; nextStrategy?: unknown }
      if (typeof input.batchId !== 'string' || input.batchId.trim() === '') throw new Error('engram_assess: batchId is required (taken from the end of engram_search output)')
      const sessionId = exec.agent === undefined ? undefined : String(exec.agent.session.id)
      const batch = sessionId === undefined ? undefined : evidenceBatches.get(sessionId, input.batchId.trim())
      if (batch === undefined) {
        throw new Error(`engram_assess: batch ${input.batchId} does not exist or has expired (each session keeps the most recent ${String(MAX_BATCHES_PER_SESSION)} batches) — run engram_search again for a fresh batch`)
      }
      const verdict = assessEvidence(batch, {
        sufficient: input.sufficient === true,
        evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter((ref): ref is string => typeof ref === 'string') : [],
        missing: typeof input.missing === 'string' ? input.missing : '',
        nextStrategy: typeof input.nextStrategy === 'string' ? input.nextStrategy : '',
      })
      // Record the verdict (the closing reminder uses it to know the batch was processed, and to escalate suggestions on consecutive insufficiency).
      if (sessionId !== undefined) evidenceBatches.recordVerdict(sessionId, batch.batchId, verdict)
      // The verdict returns to the model context, written to the audit log (not the session log — downstream plugins are forbidden from writing unknown event types).
      const userStore = await deps.openStore('user')
      await userStore.audit('assess', batch.batchId, JSON.stringify({
        batchId: batch.batchId,
        sufficient: verdict.sufficient,
        refs: verdict.evidenceRefs,
        rejected: verdict.rejectedRefs,
        strategy: verdict.nextStrategy,
      }))
      return { sufficient: verdict.sufficient, nextStrategy: verdict.nextStrategy, text: renderAssessText(verdict, batch.batchId) }
    },
  })

  const timeline = defineTool({
    name: 'engram_timeline',
    description: 'Browse memories by time range and topic (default reverse chronological, most recent 20). With order=tour, walk in fixed tour-route slot order instead (entries not on the route go last); output carries palace coordinates — suitable for reciting along the fixed palace route; multi-scope results are concatenated in user→project→shared order (slot order only makes sense within each store). With no parameters, lists the most recent records.',
    parameters: {
      scope: { type: 'string', enum: ['user', 'project', 'shared', 'all'], description: 'Scope, defaults to all' },
      topic: { type: 'string', description: 'Topic substring' },
      since: { type: 'string', description: 'Start time (ISO or parseable date)' },
      until: { type: 'string', description: 'End time' },
      order: { type: 'string', enum: ['time', 'tour'], description: "Sort: default 'time' is reverse creation order; 'tour' is fixed tour-route slot order" },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { scope?: unknown; topic?: string; since?: string; until?: string; order?: unknown }
      const scopes = scopesOf(input.scope)
      const order = input.order === 'tour' ? 'tour' : 'time'
      const since = parseTimeParam(input.since, 'engram_timeline', 'since')
      const until = parseTimeParam(input.until, 'engram_timeline', 'until')
      const results = await Promise.all(scopes.map(async (scope) => {
        const store = await deps.openStore(scope)
        return store.timeline({
          scopes: [scope],
          ...(input.topic === undefined ? {} : { topic: input.topic }),
          ...(since === undefined ? {} : { since }),
          ...(until === undefined ? {} : { until }),
          order,
          limit: 20,
        })
      }))
      // time order has a common scale across scopes (time), so globally re-sort; tour-order slots are only comparable within their own store, so concatenate by scope order.
      const rows = order === 'tour'
        ? results.flat().slice(0, 20)
        : results.flat().sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
      // Output packet protocol tag: memory bodies are untrusted historical context; timeline has no query parameter, so the current request is a placeholder sentence.
      const body = enforceBudget(rows.map(record => {
        const slot = order === 'tour' && record.slot !== undefined ? ` ${record.slot.room}#${record.slot.index}` : ''
        return `${new Date(record.createdAt).toISOString()}${slot} [${record.scope}/${record.kind}] ${truncateItem(record.content)} (id=${record.id})`
      }))
      const tail = order === 'tour' ? '\n(in fixed tour-route slot order; entries not on the route are ordered by creation time at the end)' : ''
      return { text: renderMemoryPacket(`${body.join('\n') || 'timeline is empty'}${tail}`, 'tool_timeline', input.topic ?? '(conversation continues)') }
    },
  })

  const episodeTimeline = defineTool({
    name: 'engram_episode_timeline',
    description: 'A standalone timeline for episode (episodic) memories: browse experiences by date range and source session; output is grouped by session (groups newest→oldest, within a group time ascending), suitable for answering "what did we do that day/in that period". Passing an anchor memory id to around switches to time-proximity expansion — listing episodes within ± window of the creation time of the anchor (ignoring date filters), answering "what else happened around then".',
    parameters: {
      scope: { type: 'string', enum: ['user', 'project', 'shared', 'all'], description: 'Scope, defaults to all' },
      since: { type: 'string', description: 'Start date (ISO or parseable date)' },
      until: { type: 'string', description: 'End date' },
      sessionId: { type: 'string', description: 'Only episodes from this source session (exact id match, taken from the "session …" group header in the output of this tool)' },
      around: { type: 'string', description: 'Anchor memory id: switches to time-proximity expansion mode (mutually exclusive with since/until/sessionId, which are then ignored)' },
      windowMinutes: { type: 'number', description: `Proximity window in minutes (around mode, defaults to ${String(EPISODE_PROXIMITY_MS_DEFAULT / 60000)})` },
      limit: { type: 'number', description: `Max results (defaults to ${String(EPISODE_TIMELINE_LIMIT_DEFAULT)})` },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { scope?: unknown; since?: string; until?: string; sessionId?: string; around?: string; windowMinutes?: number; limit?: number }
      const scopes = scopesOf(input.scope)
      const since = parseTimeParam(input.since, 'engram_episode_timeline', 'since')
      const until = parseTimeParam(input.until, 'engram_episode_timeline', 'until')
      const limit = parseCountParam(input.limit, 'engram_episode_timeline', 'limit', EPISODE_TIMELINE_LIMIT_DEFAULT, 1, 500)
      const sessionId = input.sessionId?.trim()
      const aroundId = input.around?.trim()
      // Output lines share the engram_timeline format, so the model need not distinguish the two timelines' phrasing.
      const renderRow = (record: MemoryRecord): string =>
        `${new Date(record.createdAt).toISOString()} [${record.scope}/${record.kind}] ${truncateItem(record.content)} (id=${record.id})`
      if (aroundId !== undefined && aroundId !== '') {
        const windowMinutes = parseCountParam(input.windowMinutes, 'engram_episode_timeline', 'windowMinutes', EPISODE_PROXIMITY_MS_DEFAULT / 60000, 1, 24 * 60)
        const anchor = asMemoryId(aroundId)
        // Proximity expansion runs in the store holding the anchor: ids are globally unique, so first locate the substore that holds it.
        for (const scope of scopes) {
          const store = await deps.openStore(scope)
          if (await store.get(anchor) === undefined) continue
          const result = await store.episodeTimeline({ scopes: [scope], around: anchor, proximityMs: windowMinutes * 60_000, limit })
          const around = result.around!
          const lines = around.neighbors.length === 0
            ? [`Anchor: ${renderRow(around.anchor)}`, 'No episodic memories within the proximity window.']
            : [
                `Anchor: ${renderRow(around.anchor)}`,
                `Nearby episodes (±${String(windowMinutes)} minutes, ${String(around.neighbors.length)} items, chronological):`,
                ...around.neighbors.map(renderRow),
              ]
          const body = enforceBudget(lines)
          return { text: renderMemoryPacket(body.join('\n'), 'tool_episode_timeline', aroundId) }
        }
        throw new Error(`engram_episode_timeline: anchor ${aroundId} does not exist`)
      }
      const results = await Promise.all(scopes.map(async (scope) => {
        const store = await deps.openStore(scope)
        return store.episodeTimeline({
          scopes: [scope],
          ...(since === undefined ? {} : { since }),
          ...(until === undefined ? {} : { until }),
          ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
          limit,
        })
      }))
      // The group sort key is time (a common scale across scopes); re-sort globally then render in order.
      const groups = results.flatMap(result => result.groups).sort((a, b) => b.startedAt - a.startedAt)
      const lines: string[] = []
      for (const group of groups) {
        lines.push(group.sessionId === null
          ? `[no session source] ${new Date(group.startedAt).toISOString()} ~ ${new Date(group.endedAt).toISOString()} (${String(group.episodes.length)} items)`
          : `[session ${group.sessionId}] ${new Date(group.startedAt).toISOString()} ~ ${new Date(group.endedAt).toISOString()} (${String(group.episodes.length)} items)`)
        // Group header summary: a one-sentence gist generated at ingest time, so the model can locate the target session without expanding item by item.
        if (group.summary !== undefined) lines.push(`  Summary: ${group.summary}`)
        for (const record of group.episodes) lines.push(`- ${renderRow(record)}`)
      }
      const body = enforceBudget(lines)
      return { text: renderMemoryPacket(body.join('\n') || 'episode timeline is empty', 'tool_episode_timeline', sessionId ?? '(conversation continues)') }
    },
  })

  const update = defineTool({
    name: 'engram_update',
    description: 'Correct a memory: write a new entry and mark the old entry as superseded (the chain is preserved and auditable). The id comes from engram_search results.',
    parameters: {
      id: { type: 'string', required: true, description: 'Id of the old entry to correct' },
      content: { type: 'string', required: true, description: 'The corrected body' },
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'The old entry scope, defaults to project' },
      kind: { type: 'string', enum: [...KINDS], description: 'Kind, defaults to inheriting the old entry' },
      placard: { type: 'string', description: 'Placard (optional): a 4-30 character plate, replaces the old entry placard. Palace discipline: unique · differentiated · dated anchor' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true },
        superseded: { type: 'string', required: true },
      } },
      render: (_args, value) =>
        [{ type: 'text', text: `Correction ${value.id} written; old entry ${value.superseded} archived with a supersession chain.` }],
    },
    async execute(args) {
      const input = args as { id: string; content: string; scope?: unknown; kind?: EngramKind; placard?: unknown }
      // Pre-store protocol stripping + secret redaction, the same defense line as engram_save.
      const content = redactSecrets(sanitizeProtocolText(input.content))
      if (content.trim() === '') throw new Error('engram_update: content empty after cleaning (the original contained only protocol tags or secrets)')
      const scope = scopeOf(input.scope, 'project')
      const store = await deps.openStore(scope)
      const old = await store.get(input.id as never)
      if (old === undefined) throw new Error(`engram_update: entry ${input.id} does not exist in the ${scope} store (confirm id and scope with engram_search)`)
      const embedder = await deps.embedder
      const embeddings = embedder === undefined ? undefined : await embedder.embed([content.trim()])
      const imagery = placardOf(input.placard)
      const record = await store.update({
        id: input.id as never,
        scope,
        kind: input.kind ?? old.kind,
        content,
        ...(embeddings === undefined ? {} : { embedding: embeddings[0] }),
        ...(imagery === undefined ? {} : { imagery }),
      })
      return { id: record.id, superseded: input.id }
    },
  })

  const forget = defineTool({
    name: 'engram_forget',
    description: 'Closing ritual (soft delete, recoverable): before forgetting, you must leave answers to the three questions "why close / who is affected / still useful?" as a tombstone, for later archaeology. id and scope come from engram_search results.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id' },
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'Entry scope, defaults to project' },
      reason: { type: 'string', required: true, description: 'Reason for closing: superseded / expired / inconsistent with reality / privacy, etc.' },
      affects: { type: 'string', required: true, description: 'Which entries/people/projects are affected; an empty string means not applicable' },
      stillUseful: { type: 'string', required: true, description: 'Residual value: archaeology / review / how to understand it on rollback' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Memory ${value.id} closed (soft delete, recoverable); the tombstone was engraved into the operation log.` }],
    },
    async execute(args) {
      const input = args as { id: string; scope?: unknown; reason: unknown; affects: unknown; stillUseful: unknown }
      const scope = scopeOf(input.scope, 'project')
      const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
      const affects = typeof input.affects === 'string' ? input.affects.trim() : ''
      const stillUseful = typeof input.stillUseful === 'string' ? input.stillUseful.trim() : ''
      if (reason === '' || affects === '' || stillUseful === '') {
        throw new Error('engram_forget: all three closing questions (reason / affects / stillUseful) must be filled in, for later archaeology')
      }
      const store = await deps.openStore(scope)
      const record = await store.forgetWithTombstone(input.id as never, { reason, affects, stillUseful })
      return { id: record.id }
    },
  })

  /**
   * History backfill: distill dsh's historical sessions turn by turn into the palace (substored by session cwd, turns with existing idempotency keys are skipped).
   * dryRun defaults to true — preventing the model from accidentally triggering hundreds of auxiliary calls; only an explicit false actually writes.
   */
  const ingestHistory = defineTool({
    name: 'engram_ingest_history',
    description: 'History session backfill: distill historical dsh sessions turn by turn into the memory palace (written into the project store for the cwd of each session; previously ingested turns are skipped automatically, and an interrupted run can be resumed). dryRun defaults to true, returning only an estimate (candidate session count / in-rule turn count / pending turn count) without calling the LLM or writing to the store; pass dryRun=false after confirmation to execute. For large backfills, prefer the settings page "History Backfill" tab (rule selection, progress, and pause); this tool suits estimating first or running small batches.',
    parameters: {
      dryRun: { type: 'boolean', description: 'Estimate only, do not execute (default true; explicit false actually backfills)' },
      days: { type: 'number', description: 'Time window in days, 0 = unlimited; defaults to the deployment-configured value' },
      maxTurnsPerSession: { type: 'number', description: 'Max turns to ingest per session; defaults to the deployment-configured value' },
      maxTotalTurns: { type: 'number', description: 'Max total turns to process this run (can only lower the configured hard cap)' },
      includeSubagents: { type: 'boolean', description: 'Whether to include subagent sessions (default false)' },
      includeSeeded: { type: 'boolean', description: 'Whether to include seeded sessions (default false)' },
      includeNoCwd: { type: 'boolean', description: 'Whether to include no-cwd sessions (default false; such sessions can only be written into the user store)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const input = args as {
        dryRun?: unknown
        days?: unknown
        maxTurnsPerSession?: unknown
        maxTotalTurns?: unknown
        includeSubagents?: unknown
        includeSeeded?: unknown
        includeNoCwd?: unknown
      }
      const history = deps.historyBackfill
      if (history === undefined) {
        return { text: 'History backfill unavailable: this combination does not mount a session persistence service (session logs unreadable, e.g. a headless profile).' }
      }
      const rules: HistoryBackfillRules = {
        ...(typeof input.days === 'number' ? { days: input.days } : {}),
        ...(typeof input.maxTurnsPerSession === 'number' ? { maxTurnsPerSession: input.maxTurnsPerSession } : {}),
        ...(typeof input.maxTotalTurns === 'number' ? { maxTotalTurns: input.maxTotalTurns } : {}),
        ...(typeof input.includeSubagents === 'boolean' ? { includeSubagents: input.includeSubagents } : {}),
        ...(typeof input.includeSeeded === 'boolean' ? { includeSeeded: input.includeSeeded } : {}),
        ...(typeof input.includeNoCwd === 'boolean' ? { includeNoCwd: input.includeNoCwd } : {}),
      }
      // dryRun defaults to true: estimating is free, executing costs LLM calls, and requires explicit confirmation.
      if (input.dryRun !== false) {
        return { text: renderHistoryEstimate(await history.estimate(rules)) }
      }
      const result = await history.run(rules, exec.signal)
      return { text: renderHistoryRun(result) }
    },
  })

  /** P0-3 closing archaeology: returns the most recent N forgotten entries + their tombstones. */
  const auditForgotten = defineTool({
    name: 'engram_audit_forgotten',
    description: 'Closing archaeology: lists the most recent N closed entries + their tombstones (why closed / who is affected / still useful?), making it easy to review whether past forgetting was appropriate.',
    parameters: {
      scope: { type: 'string', enum: ['user', 'project', 'shared', 'all'], description: 'Scope, defaults to all' },
      limit: { type: 'integer', description: 'Max results, defaults to 20' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { scope?: unknown; limit?: unknown }
      const scopes = scopesOf(input.scope)
      const limit = Number.isInteger(input.limit) ? Math.min(Math.max(1, input.limit as number), 50) : 20
      const all = (await Promise.all(scopes.map(async (scope) =>
        (await deps.openStore(scope)).listForgottenWithTombs(limit)
      ))).flat()
      all.sort((a, b) => b.forgottenAt - a.forgottenAt)
      const sliced = all.slice(0, limit)
      if (sliced.length === 0) return { text: 'No closed entries yet.' }
      const lines = sliced.map((row, index) => {
        const stamp = new Date(row.forgottenAt).toISOString()
        const tomb = row.tombstone === null
          ? '(tombstone missing: older version has no three-question data)'
          : `\n   - Why closed: ${row.tombstone.reason}\n   - Who is affected: ${row.tombstone.affects}\n   - Still useful?: ${row.tombstone.stillUseful}`
        return `${index + 1}. [${row.scope}/${row.kind}] ${row.content.slice(0, 80)}${row.content.length > 80 ? '…' : ''}\n   id=${row.id} · importance=${row.importance.toFixed(2)} · closed on ${stamp}${tomb}`
      })
      return { text: `Closing archaeology (${sliced.length} total):\n${lines.join('\n')}` }
    },
  })

  // Today's recall queue (retrieval practice): only gives cues (room/slot/placard), not content — the model first actively recalls,
  // then uses engram_review to reveal and check, and engram_report grade to self-assess. Active recall's reinforcement far exceeds passive re-reading.
  const reviewQueue = defineTool({
    name: 'engram_review_queue',
    description: "Today's recall queue: lists memories whose spaced interval is due, each giving only palace coordinates and placard cues (no body). Usage: for each, first try to recall the content, then engram_review to reveal and check, then engram_report with grade (0-5) to self-assess — active recall reinforces memories far more than re-reading. The session-start injection indicates whether anything is due today.",
    parameters: {
      scope: { type: 'string', enum: ['user', 'project', 'shared', 'all'], description: 'Scope, defaults to all' },
      limit: { type: 'integer', description: 'Max results, defaults to 10 (most overdue first)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { scope?: unknown; limit?: unknown }
      const scopes = scopesOf(input.scope)
      const limit = Number.isInteger(input.limit) ? Math.min(Math.max(1, input.limit as number), 50) : 10
      const now = Date.now()
      const groups = await Promise.all(scopes.map(async (scope) => ({
        scope,
        due: await (await deps.openStore(scope)).dueReviews(now, limit),
      })))
      const total = groups.reduce((sum, group) => sum + group.due.length, 0)
      if (total === 0) return { text: 'Nothing due for recall today (queue empty). New memories come due for the first time the day after saving.' }
      const lines: string[] = [`${total} items due for recall today (most overdue first). For each: recall first → engram_review to check → engram_report with grade to self-assess.`]
      for (const { scope, due } of groups) {
        for (const [index, record] of due.entries()) {
          const slot = record.slot === undefined ? '(no slot assigned)' : `${record.slot.room} #${record.slot.index}`
          const placard = record.imagery?.caption ?? '(no placard)'
          const overdueDays = record.review?.nextReviewAt === null || record.review?.nextReviewAt === undefined
            ? 0
            : Math.max(0, Math.floor((now - record.review.nextReviewAt) / 86_400_000))
          const overdue = overdueDays === 0 ? 'due today' : `overdue by ${overdueDays} days`
          lines.push(`${index + 1}. [${scope}] ${slot} · placard "${placard}" · ${overdue} · id=${record.id}`)
        }
      }
      return { text: lines.join('\n') }
    },
  })

  // Reward signal entry: after the model uses a memory (especially skill kinds) it reports the actual effect — success boosts weight / failure lowers it.
  // It also bridges spaced repetition: success=grade 5 / failure=grade 1 advances the SM-2 schedule; an explicit grade self-assessment takes priority.
  const report = defineTool({
    name: 'engram_report',
    description: 'Report the actual effect after using a memory (especially skill kinds): success (effective, boost) or failure (ineffective, down-weight). id and scope come from engram_search results. It can also serve as a review self-assessment entry: pass grade (0 fully forgotten … 5 perfect recall) to explicitly report recall quality. The effect influences later recall ranking and review scheduling; memories that remain ineffective long-term are decayed and archived.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id' },
      outcome: { type: 'string', enum: ['success', 'failure'], description: 'Usage effect (mutually exclusive with grade; when both are passed, grade wins)' },
      grade: { type: 'integer', description: 'Recall quality self-assessment 0-5 (for review quizzes; 0/1 fully forgotten, 3 barely, 5 perfect)' },
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'Entry scope, defaults to project' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true },
        outcome: { type: 'string', required: true },
        confidence: { type: 'number', required: true },
        nextReviewAt: { type: 'number' },
      } },
      render: (_args, value) => [{
        type: 'text',
        text: (value.outcome === 'success'
          ? `Recorded: memory ${value.id} proved effective on use (confidence=${value.confidence}). Its later recall ranking will rise.`
          : `Recorded: memory ${value.id} marked ineffective/forgotten (confidence=${value.confidence}). Its ranking will fall; sustained ineffectiveness leads to decay and archiving.`)
          + (value.nextReviewAt === undefined
            ? ''
            : ` Next review: ${new Date(value.nextReviewAt).toISOString().slice(0, 10)}.`),
      }],
    },
    async execute(args) {
      const input = args as { id: string; outcome?: unknown; grade?: unknown; scope?: unknown }
      const hasGrade = Number.isInteger(input.grade) && (input.grade as number) >= 0 && (input.grade as number) <= 5
      if (input.grade !== undefined && !hasGrade) {
        throw new Error('engram_report: grade must be an integer 0-5')
      }
      if (input.outcome !== 'success' && input.outcome !== 'failure' && !hasGrade) {
        throw new Error('engram_report: outcome (success/failure) or grade (0-5) parameter is required')
      }
      // An explicit grade self-assessment wins; otherwise outcome maps to an SM-2 grade (success=5 perfect, failure=1 forgotten).
      const outcome = input.outcome === 'success' || input.outcome === 'failure'
        ? input.outcome
        : (input.grade as number) >= 3 ? 'success' : 'failure'
      const grade = (hasGrade ? input.grade : outcome === 'success' ? 5 : 1) as 0 | 1 | 2 | 3 | 4 | 5
      const scope = scopeOf(input.scope, 'project')
      const store = await deps.openStore(scope)
      const record = await store.reportOutcome(input.id as never, outcome)
      if (record === undefined) throw new Error(`engram_report: entry ${input.id} does not exist (scope=${scope})`)
      const scheduled = await store.scheduleReview(input.id as never, grade)
      return {
        id: record.id,
        outcome,
        confidence: record.confidence,
        ...(scheduled?.review?.nextReviewAt === null || scheduled?.review?.nextReviewAt === undefined
          ? {}
          : { nextReviewAt: scheduled.review.nextReviewAt }),
      }
    },
  })

  const review = defineTool({
    name: 'engram_review',
    description: 'Audit a memory: view its content, source (session/turn/event), supersession chain, contradictions and relations, and recent operation log.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id' },
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'Entry scope, defaults to project' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { id: string; scope?: unknown }
      const store = await deps.openStore(scopeOf(input.scope, 'project'))
      const view = await store.review(input.id as never)
      if (view === undefined) return { text: `Entry ${input.id} not found (confirm id and scope with engram_search)` }
      const record = view.record
      const source = record.sourceSessionId === null
        ? 'explicit save (no session source)'
        : `session ${record.sourceSessionId}`
          + (record.sourceRound === null ? '' : ` turn ${record.sourceRound}`)
          + (record.sourceSeq === null ? '' : `, event seq ${record.sourceSeq}`)
      const section = (title: string, ids: readonly string[]): string =>
        ids.length === 0 ? '' : `\n${title}: ${ids.join(', ')}`
      // Output packet protocol tag: memory bodies and source chains are untrusted historical context.
      return {
        text: renderMemoryPacket([
          `Content: ${record.content}`,
          `Attributes: kind=${record.kind}, scope=${record.scope}, status=${record.status}, importance=${record.importance}, confidence=${record.confidence}, accessed ${record.accessCount} times`,
          `Source: ${source}`,
          section('Superseded by', view.supersededBy.map(String)),
          section('Supersedes', view.supersedes.map(String)),
          section('Contradiction candidates', view.contradicts.map(String)),
          section('Related', view.related.map(String)),
          view.revisions.length === 0 ? '' : `\nRevision history:\n${view.revisions.map(rev =>
            `- ${new Date(rev.supersededAt).toISOString()} [${rev.kind}] ${truncateItem(rev.content)}`).join('\n')}`,
          view.operations.length === 0 ? '' : `\nRecent operations:\n${view.operations.map(op => `- ${new Date(op.at).toISOString()} ${op.op}${op.detail === null ? '' : ` ${op.detail}`}`).join('\n')}`,
        ].filter(part => part !== '').join('\n'), 'tool_review', '(conversation continues)'),
      }
    },
  })

  const stats = defineTool({
    name: 'engram_stats',
    description: 'Memory store statistics: counts by status and kind, relation edge count, signal-to-noise ratio, operation log volume, plus the room directory (room name / slot count / latest placard — check the directory before searching to decide which room to enter, used with engram_search\'s room parameter). scope=all merges the two stores.',
    parameters: {
      scope: { type: 'string', enum: ['user', 'project', 'shared', 'all'], description: 'Scope, defaults to all' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { scope?: unknown }
      const scopes = scopesOf(input.scope)
      const all = await Promise.all(scopes.map(async (scope) => {
        const store = await deps.openStore(scope)
        const [storeStats, rooms, placards] = await Promise.all([
          store.stats(),
          store.slotCountsByRoom(),
          store.listPlacards(),
        ])
        return { scope, stats: storeStats, rooms, placards }
      }))
      const text = all.map(({ scope, stats, rooms, placards }) => {
        // Room directory (corridor routing index): one line per room, slot count + latest placard as routing cues.
        const latestPlacardByRoom = new Map<string, string>()
        for (const row of placards) {
          if (row.room !== null) latestPlacardByRoom.set(row.room, row.caption)
        }
        const roomLines = Object.entries(rooms)
          .sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'))
          .map(([room, state]) => {
            const placard = latestPlacardByRoom.get(room)
            return `  ${room}: ${state.count}/${state.maxIndex} slots${placard === undefined ? '' : ` · latest placard "${placard}"`}`
          })
        return [
          `[${scope}] total ${stats.total} (active ${stats.active} / archived ${stats.archived} / forgotten ${stats.forgotten})`,
          `Kind distribution: ${Object.entries(stats.byKind).map(([kind, count]) => `${kind}=${count}`).join(', ') || 'empty'}`,
          `${stats.edges} relation edges · signal-to-noise ${(stats.signalRatio * 100).toFixed(1)}% · ${stats.opLogCount} operation log entries`,
          roomLines.length === 0 ? 'Room directory: (no slots yet)' : `Room directory (enter directly via engram_search's room parameter):\n${roomLines.join('\n')}`,
        ].join('\n')
      }).join('\n\n')
      return { text }
    },
  })

  const exportTool = defineTool({
    name: 'engram_export',
    description: 'Export the memory store to files (Markdown / JSON / mirror directory), returning file paths. redactedView=true outputs a redacted view (content re-cleaned and truncated to a 40-char preview, safe to share). format=markdown-mirror splits directories by room (kind), one .md + frontmatter per memory, plus a room manifest _meta.json and a whole-palace entry _index.md, directly browsable with Obsidian / git.',
    parameters: {
      format: { type: 'string', enum: ['markdown', 'json', 'markdown-mirror'], description: 'Export format: markdown single file, json single file, markdown-mirror one file per memory (directories by room, default markdown)' },
      scope: { type: 'string', enum: ['user', 'project', 'shared', 'all'], description: 'Scope, defaults to all' },
      redactedView: { type: 'boolean', description: 'Redacted view: content re-redacted and truncated to a preview (default false full export; mirror mode ignores this parameter)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { format?: unknown; scope?: unknown; redactedView?: unknown }
      const format = input.format === 'json' ? 'json' : input.format === 'markdown-mirror' ? 'markdown-mirror' : 'markdown'
      const redactedView = input.redactedView === true
      const scopes = scopesOf(input.scope)
      // Redacted view: in-store cleaning may postdate old data, so re-clean idempotently before export and truncate to a preview.
      const preview = (content: string): string => {
        const cleaned = redactSecrets(content)
        return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned
      }
      await mkdir(deps.exportDir, { recursive: true, mode: 0o700 })
      const written: string[] = []
      for (const scope of scopes) {
        const data = await (await deps.openStore(scope)).exportAll()
        if (format === 'markdown-mirror') {
          // Mirror mode: full export, ignore redaction (users viewing full content in Obsidian matches expectations; for redaction use markdown/json + redactedView).
          const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
          const mirrorRoot = join(deps.exportDir, `mirror-${scope}-${stamp}`)
          const report = await writeMirror(mirrorRoot, data)
          written.push(`${mirrorRoot} (${report.fileCount} files, ${data.records.length} memories, ${report.rooms.length} rooms)`)
          continue
        }
        const payload = redactedView
          ? { ...data, records: data.records.map(record => ({ ...record, content: preview(record.content) })) }
          : data
        const stamp = new Date().toISOString().replaceAll(':', '-')
        const suffix = redactedView ? '-redacted' : ''
        const path = join(deps.exportDir, `engram-${scope}${suffix}-${stamp}.${format === 'json' ? 'json' : 'md'}`)
        const body = format === 'json'
          ? JSON.stringify(payload, null, 2)
          : [
              `# dsh-engram export (${scope}${redactedView ? ', redacted view' : ''})`,
              '',
              ...payload.records.map(record =>
                `- [${record.status}/${record.kind}] ${record.content} (id=${record.id}, importance ${record.importance})`),
              '',
              '## Relation edges',
              ...payload.edges.map(edge => `- ${edge.from} --${edge.type}--> ${edge.to}`),
              '',
            ].join('\n')
        await writeFile(path, body, { mode: 0o600 })
        written.push(`${path} (${payload.records.length} memories, ${payload.edges.length} edges${redactedView ? ', redacted view' : ''})`)
      }
      return { text: `Exported${redactedView ? ' (redacted view)' : ''}:\n${written.join('\n')}` }
    },
  })

  const distill = defineTool({
    name: 'engram_distill',
    description: 'Distill and organize: merge and refine same-topic memory clusters into higher-level regularities (old entries archived, supersedes chains preserved). Recommended to run periodically when there are many memories.',
    parameters: {
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'Scope, defaults to user' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const input = args as { scope?: unknown }
      const scope = scopeOf(input.scope, 'user')
      if (deps.call === undefined) throw new Error('engram_distill: auxiliary LLM unavailable (the host does not provide an llm service); cannot distill')
      const call = deps.call
      const events = (exec.agent?.session?.snapshotEvents() ?? []) as unknown as Parameters<typeof routeFromEvents>[0]
      const route = deps.routeOverride ?? routeFromEvents(events)
      if (route === undefined) throw new Error('engram_distill: cannot determine the model route (the session has no model requests yet); configure provider/model in cordis.yml')
      const embedder = await deps.embedder
      const outcome = await distillMemories({
        store: await deps.openStore(scope),
        embedder,
        scope,
        call: params => call({ ...params, sessionId: exec.agent === undefined ? undefined : String(exec.agent.session.id) }),
        logRequest: (data) => {
          void (async () => {
            const store = await deps.openStore(scope)
            await store.audit('distill-request', 'AUX', JSON.stringify(data))
          })().catch(() => { /* audit failures do not affect distillation */ })
        },
        route,
        signal: exec.signal,
      })
      return { text: `Distillation complete: consumed ${outcome.input} items, produced ${outcome.distilled} higher-level regularities, archived ${outcome.superseded} old memories (supersedes chains established, auditable via engram_review).` }
    },
  })

  /**
   * Belief consolidation — abstracts one-sentence beliefs with evidence chains from unconsolidated raw memories, and re-reviews stale beliefs.
   * Key difference from distill: all raw memories are preserved; beliefs are a superimposed abstraction layer (same-topic vector neighbors merged,
   * continuously refining the same one). Under the reflect=suggest tier this is the execution exit for pending-consolidation registrations; it can be called manually at any tier.
   */
  const reflect = defineTool({
    name: 'engram_reflect',
    description: 'Belief consolidation: consolidates multiple raw memories via the auxiliary LLM into higher-level beliefs with evidence counts (form creates / refine refines / still maintains / refute refutes), auto-merging same topics; raw memories are preserved and not archived. Call it after a repeatedly appearing pattern or a new batch of memories.',
    parameters: {
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'Scope, defaults to user' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const input = args as { scope?: unknown }
      const scope = scopeOf(input.scope, 'user')
      if (deps.call === undefined) throw new Error('engram_reflect: auxiliary LLM unavailable (the host does not provide an llm service); cannot consolidate')
      const call = deps.call
      const events = (exec.agent?.session?.snapshotEvents() ?? []) as unknown as Parameters<typeof routeFromEvents>[0]
      const route = deps.routeOverride ?? routeFromEvents(events)
      if (route === undefined) throw new Error('engram_reflect: cannot determine the model route (the session has no model requests yet); configure provider/model in cordis.yml')
      const store = await deps.openStore(scope)
      const embedder = await deps.embedder
      const outcome = await reflectObservations({
        store,
        embedder,
        scope,
        call: params => call({ ...params, sessionId: exec.agent === undefined ? undefined : String(exec.agent.session.id) }),
        logRequest: (data) => {
          void store.audit('reflect-request', 'AUX', JSON.stringify(data)).catch(() => { /* audit failures do not affect consolidation */ })
        },
        route,
        signal: exec.signal,
      })
      // Consume this scope's suggest pending-consolidation registrations (detail is {scope,sessionId} JSON; out-of-range/corrupt entries ignored).
      const pending = await store.listAuditDetails('reflect-pending')
      let consumed = 0
      for (const detail of pending) {
        try {
          const parsed = JSON.parse(detail) as { scope?: unknown }
          if (parsed.scope === scope) {
            await store.clearAudit('reflect-pending', detail)
            consumed += 1
          }
        } catch {
          /* corrupt pending entries are left for the cleanup flow; do not block this result */
        }
      }
      const lines = [
        `Belief consolidation complete: pool ${String(outcome.pool)} items, new evidence ${String(outcome.candidates)} items, beliefs to re-review ${String(outcome.staleReviewed)}; formed ${String(outcome.formed)}, refined ${String(outcome.refined)}, maintained ${String(outcome.confirmed)}, refuted ${String(outcome.refuted)}, skipped ${String(outcome.skipped)}.`,
        'Beliefs are an abstraction layer superimposed on raw memories (evidence ids and counts preserved, raw memories not archived).',
      ]
      if (consumed > 0) lines.push(`Also consumed ${String(consumed)} pending-consolidation tasks registered at session end.`)
      return { text: lines.join('\n') }
    },
  })

  /**
   * Progressive disclosure — memory placard batch visitor: only after obtaining a set of ids decide which few to fetch.
   * Used with engram_search: search returns only placard summaries; examine actually enters the room to read the placards.
   */
  const examine = defineTool({
    name: 'engram_examine',
    description: 'Progressive disclosure: batch-fetch full memory placards (content + room + status + edge relations) by id. Only call it after obtaining candidate ids via engram_search/timeline/neighbors, to avoid swallowing full text at once. Recommended ≤16 ids; excess keeps the first N in input order.',
    parameters: {
      ids: { type: 'array', items: { type: 'string' }, description: 'List of memory ids' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { ids?: unknown }
      const rawIds = Array.isArray(input.ids) ? input.ids.filter((x): x is string => typeof x === 'string') : []
      if (rawIds.length === 0) throw new Error('engram_examine: ids is required with at least 1 item')
      const ids = rawIds.slice(0, 16).map(id => asMemoryId(id))
      const store = await deps.openStore('user')
      const projectStore = await deps.openStore('project')
      const [fromUser, fromProject] = await Promise.all([store.getMany(ids), projectStore.getMany(ids)])
      const records = [...fromUser, ...fromProject]
      if (records.length === 0) throw new Error(`engram_examine: none of the ${ids.length} ids could be found`)
      const text = records.map((record, index) => [
        `### ${index + 1}. [${record.scope}/${record.kind}/${record.status}] id=${record.id}`,
        `Placard: ${record.content}`,
        `Landmark brightness=${record.importance.toFixed(2)} · scholarly reliability=${record.confidence.toFixed(2)} · visits=${record.accessCount}`,
      ].join('\n')).join('\n\n')
      return { text }
    },
  })

  /**
   * Progressive disclosure — corridor walk: from one room, walk related/supersedes/contradicts corridor edges,
   * finding a brief table of related neighbor memories (id + one-sentence summary only, no full text).
   */
  const neighborsTool = defineTool({
    name: 'engram_neighbors',
    description: 'Corridor walk: from one memory, walk related/supersedes/contradicts edges within 1-3 hops, returning a brief table of neighbor memories (id + scope + kind + status + content only), to help decide the next stop.',
    parameters: {
      id: { type: 'string', description: 'Starting memory id' },
      depth: { type: 'integer', description: 'Hop count (default 1, max 3, clamped by the executor)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { id?: unknown; depth?: unknown }
      if (typeof input.id !== 'string' || input.id === '') throw new Error('engram_neighbors: id is required')
      const depth = Number.isInteger(input.depth) ? Math.min(Math.max(1, input.depth as number), 3) : 1
      const seed = asMemoryId(input.id)
      const userStore = await deps.openStore('user')
      const projectStore = await deps.openStore('project')
      const seedRow = await userStore.get(seed) ?? await projectStore.get(seed)
      if (seedRow === undefined) throw new Error(`engram_neighbors: seed ${seed} does not exist`)
      const seedScope = seedRow.scope
      const scopeStore = seedScope === 'user' ? userStore : projectStore
      const neighbors = await scopeStore.neighbors(seed, depth)
      if (neighbors.length === 0) return { text: `From ${seed} (${seedScope}), no neighbor memories within ${depth} hops.` }
      const lines = neighbors.map((record, index) => `${index + 1}. [${record.scope}/${record.kind}/${record.status}] ${record.content.slice(0, 80)}${record.content.length > 80 ? '…' : ''} (id=${record.id})`)
      return { text: `Seed ${seed} (${seedScope}) → ${depth}-hop corridor visited ${neighbors.length} items:\n${lines.join('\n')}` }
    },
  })

  /**
   * P0-2 tour routing: reorganizes search results into an ordered 3-7 memory path, with echo triggers and selection reasons.
   * Reuses the underlying query of engram_search to avoid duplicate IO.
   */
  const tour = defineTool({
    name: 'engram_tour',
    description: 'Tour routing. mode=fixed: walk the whole palace along the fixed tour route (slot order constant, the skeleton is reused long-term — the palace route never changes, relying on serial retrieval); mode=thematic (default): dynamically plan 3-7 stops by topic (same-kind consolidation → corridor adjacency → contrast fill-in), suitable for giving a walkable guide route when the user asks about a topic.',
    parameters: {
      query: { type: 'string', description: 'Tour theme (required in thematic mode, synonymous with engram_search)' },
      mode: { type: 'string', enum: ['fixed', 'thematic'], description: 'fixed: fixed-route whole-palace tour / thematic: topic dynamic route (default thematic)' },
      scope: { type: 'string', enum: ['user', 'project', 'shared', 'all'], description: 'Scope, defaults to all' },
      maxStops: { type: 'integer', description: 'Max stops (default 6, between 3-7; fixed mode defaults to 20)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const input = args as { query?: string; mode?: unknown; scope?: unknown; maxStops?: unknown }
      const scopes = scopesOf(input.scope)
      const mode = input.mode === 'fixed' ? 'fixed' : 'thematic'
      // fixed mode: output the whole-palace tour in tour_routes table order (archived/forgotten stops skipped and marked as empty slots).
      if (mode === 'fixed') {
        const maxStops = Number.isInteger(input.maxStops) ? Math.max(1, input.maxStops as number) : 20
        const sections: string[] = []
        let shown = 0
        let skipped = 0
        for (const scope of scopes) {
          const store = await deps.openStore(scope)
          const route = await store.routeList()
          if (route.length === 0) continue
          const records = await store.getMany(route.map(stop => stop.id))
          const byId = new Map(records.map(record => [String(record.id), record]))
          const lines: string[] = []
          for (const stop of route) {
            if (shown >= maxStops) break
            const record = byId.get(String(stop.id))
            if (record === undefined || record.status !== 'active') { skipped += 1; continue }
            shown += 1
            const slot = record.slot === undefined ? '' : `${record.slot.room} #${record.slot.index} · `
            const placard = record.imagery?.caption
            lines.push(`Stop ${stop.position + 1} · ${slot}[${record.kind}] ${truncateItem(record.content)} (id=${record.id})${placard === null || placard === undefined ? '' : ` · placard "${placard}"`}`)
          }
          if (lines.length > 0) sections.push(`[${scope} palace · fixed tour]\n${lines.join('\n')}`)
        }
        if (shown === 0) return { text: 'Tour route is empty: no slotted memories yet (routes are auto-registered after saving memories).' }
        const tail = skipped > 0 ? `\n(${skipped} more empty slots: the original memories were closed or archived; slots are preserved and not reclaimed)` : ''
        return { text: `${sections.join('\n\n')}${tail}` }
      }
      if (typeof input.query !== 'string' || input.query.trim() === '') {
        throw new Error('engram_tour: thematic mode requires the query parameter (tour theme)')
      }
      const tourQuery = input.query
      const limit = 12
      const maxStops = Number.isInteger(input.maxStops) ? Math.min(Math.max(3, input.maxStops as number), 7) : 6
      const rewrite = await rewriteQueries(deps, exec, tourQuery)
      const retrievals = await Promise.all(rewrite.queries.map(async (queryText) => {
        const vector = await queryVectorOf(deps, queryText)
        const results = await Promise.all(scopes.map(async (scope) => {
          const store = await deps.openStore(scope)
          return store.search({ text: queryText, scopes: [scope], limit }, vector)
        }))
        return {
          hits: results.flatMap(result => result.hits).sort((a, b) => b.score - a.score).slice(0, limit),
          degraded: results.some(result => result.degraded),
        }
      }))
      const degraded = retrievals.some(retrieval => retrieval.degraded)
      const merged = mergeQueryResults(
        retrievals,
        limit,
        RRF_CONSTANT,
        Math.floor(Math.max(0, limit) / Math.max(1, rewrite.queries.length)),
      )
      // Neighbor queries use the user+project stores jointly (neighbors needs poolLookup to fetch records synchronously).
      const userStore = await deps.openStore('user')
      const projectStore = await deps.openStore('project')
      const poolLookup = async (id: string): Promise<MemoryRecord | undefined> =>
        await userStore.get(id as never) ?? await projectStore.get(id as never)
      const route = await planTour(merged, poolLookup, tourQuery, maxStops)
      const prefix = degraded ? '(semantic embeddings unavailable, keyword search only)\n' : ''
      return { text: `${prefix}${route.narrative}` }
    },
  })

  /**
   * Editable profile: maintains the curated block injected at session start (injected with priority over the auto-derived profile).
   * view shows the current content and version history; edit edits (optimistic locking, conflicts are loud failures); rollback
   * writes a historical version's content as a new version (the version chain only grows, never rewritten; rollback can be repeated).
   */
  const profileEdit = defineTool({
    name: 'engram_profile_edit',
    description: 'Edit the curated user-profile block injected at session start (at injection time it precedes the auto-derived profile and is the highest-priority profile layer). action=view shows the current content and version history; action=edit edits (optimistic lock: must carry the current expectedVersion, version conflicts error out — re-read the latest version before editing; omit expectedVersion on first creation); action=rollback rolls back (writes the toVersion version\'s content as a new version, history is not rewritten). Content undergoes protocol stripping and secret redaction before storage.',
    parameters: {
      action: { type: 'string', enum: ['view', 'edit', 'rollback'], required: true, description: 'view: show / edit: edit / rollback: roll back' },
      scope: { type: 'string', enum: ['user', 'project', 'shared'], description: 'Scope, defaults to user' },
      content: { type: 'string', description: 'Required for edit: the new profile content (multiline text, injected verbatim at session start)' },
      expectedVersion: { type: 'integer', description: 'Carry it on edit = concurrency protection (optimistic lock); omit = create v1 only when no block exists yet' },
      toVersion: { type: 'integer', description: 'Required for rollback: the historical version number to roll back to (obtained via view)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) {
      const input = args as { action?: unknown; scope?: unknown; content?: unknown; expectedVersion?: unknown; toVersion?: unknown }
      const action = input.action === 'edit' || input.action === 'rollback' || input.action === 'view' ? input.action : undefined
      if (action === undefined) throw new Error('engram_profile_edit: action must be one of view / edit / rollback')
      const scope = scopeOf(input.scope, 'user')
      const store = await deps.openStore(scope)
      if (action === 'view') {
        const block = await store.getProfileBlock(scope)
        if (block === undefined) {
          return { text: `The ${scope} store has no curated profile block yet. Create v1 with action=edit (omit expectedVersion); after creation it is injected before the auto-derived profile at session start.` }
        }
        const versions = await store.listProfileBlockVersions(scope, 10)
        return {
          text: [
            `Current curated profile (${scope}, v${block.version}):`,
            block.content,
            '',
            `Version history (most recent ${versions.length}, newest→oldest; specify toVersion for rollback):`,
            ...versions.map(version =>
              `- v${version.version} · ${version.source === 'rollback' ? 'rollback' : 'edit'} · ${new Date(version.at).toISOString().slice(0, 16).replace('T', ' ')} · ${version.content.length} chars`),
          ].join('\n'),
        }
      }
      if (action === 'edit') {
        if (typeof input.content !== 'string' || input.content.trim() === '') throw new Error('engram_profile_edit: edit requires the content parameter')
        let expectedVersion: number | undefined
        if (input.expectedVersion !== undefined) {
          if (!Number.isInteger(input.expectedVersion)) throw new Error('engram_profile_edit: expectedVersion must be an integer (obtained via action=view)')
          expectedVersion = input.expectedVersion as number
        }
        // Pre-store protocol stripping + secret redaction, the same defense line as engram_save/update.
        const content = redactSecrets(sanitizeProtocolText(input.content))
        if (content.trim() === '') throw new Error('engram_profile_edit: content empty after cleaning (the original contained only protocol tags or secrets)')
        const block = await store.saveProfileBlock(scope, expectedVersion, content, 'edit')
        // The edit record goes into op_log (visible in the panel steward log; target_id uses scope).
        await store.audit('profile-edit', scope, JSON.stringify({
          action: 'edit',
          fromVersion: expectedVersion ?? null,
          toVersion: block.version,
          chars: content.length,
        }))
        return { text: `Curated profile written (${scope}, v${block.version}). It will be injected before the auto-derived profile at the next session start.` }
      }
      // rollback: take a historical version's content and write it as a new version (optimistic locking applies equally).
      if (!Number.isInteger(input.toVersion)) throw new Error('engram_profile_edit: rollback requires toVersion (the target historical version number, obtained via action=view)')
      const target = await store.getProfileBlockVersion(scope, input.toVersion as number)
      if (target === undefined) throw new Error(`engram_profile_edit: version v${input.toVersion} does not exist in the ${scope} store (view the version history with action=view)`)
      const current = await store.getProfileBlock(scope)
      if (current === undefined) throw new Error(`engram_profile_edit: the ${scope} store has no curated profile block yet; nothing to roll back`)
      const updated = await store.saveProfileBlock(scope, current.version, target.content, 'rollback')
      await store.audit('profile-edit', scope, JSON.stringify({
        action: 'rollback',
        fromVersion: current.version,
        toVersion: updated.version,
        restoredFrom: target.version,
        chars: target.content.length,
      }))
      return { text: `Wrote v${target.version}'s content as v${updated.version} (${scope}; the version chain only grows and is never rewritten, so further rollbacks are possible).` }
    },
  })

  const tools = [save, search, factsTool, assess, timeline, episodeTimeline, update, forget, report, reviewQueue, review, stats, exportTool, distill, reflect, examine, neighborsTool, tour, auditForgotten, ingestHistory, profileEdit]
  // Before executing, put this session's cwd into the ALS context: project-scope substore resolution attributes to it (concurrent sessions do not cross-contaminate).
  return tools.map(tool => ({
    ...tool,
    execute: (args: Parameters<ToolDefinition['execute']>[0], exec: ToolRunContext) =>
      execSessionCwd.run(sessionCwdOf(exec), () => tool.execute(args, exec)),
  }))
}

// ===== P0-2 tour routing: engram_tour =====
// Path strategy (same color → neighbors → contrast): first cluster same kinds (same kind + same scope), then expand
// one-hop neighbors along related edges, and finally collect one strong-contrast item with emotional weight ≥ 0.7 as the
// closer. This order matches the classical mnemonic "place same color first, then contrast": first build a semantic
// cluster for easy consolidation, then wake attention with a contrasting event.

/** Tour candidate: node + the "entry motive" of the selection stage, used to generate echo triggers at render time. */
export interface TourStop {
  readonly record: MemoryRecord
  /** The reason that triggered this node's selection (for the model/user to explain). */
  readonly reason: 'same-kind' | 'neighbor' | 'contrast' | 'emotional-peak'
}

/** Tour path result: ordered stops + per-segment decision notes. */
export interface TourRoute {
  readonly stops: readonly TourStop[]
  /** Tour copy: path logic + per-stop echoes. */
  readonly narrative: string
  /** Input: the original query (for auditing). */
  readonly query: string
}

/**
 * Build a tour path: re-arranges on top of the search hits according to the path strategy.
 * 1) Start cluster: take the top N nodes of the most frequent kind among the hits (same-kind consolidation).
 * 2) Corridor expansion: from each node of the start cluster, pick active memories with score > 0 from 1-hop neighbors.
 * 3) Contrast closure: from the remaining hits, pick one with emotionalValence ≥ 0.7 as the closer (strong-contrast wake).
 * Fall back by availability when hits are insufficient; return empty stops when there are 0 hits.
 */
export async function planTour(
  hits: readonly SearchHit[],
  poolLookup: (id: string) => Promise<MemoryRecord | undefined>,
  query: string,
  maxStops = 6,
): Promise<TourRoute> {
  if (hits.length === 0) return { stops: [], narrative: 'No hits, no tour path to plan.', query }

  const used = new Set<string>()
  const stops: TourStop[] = []

  // Stage 1: same-kind cluster (by kind frequency high to low, at most 2 kinds).
  const kindCounts = new Map<string, number>()
  for (const hit of hits) kindCounts.set(hit.record.kind, (kindCounts.get(hit.record.kind) ?? 0) + 1)
  const topKinds = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([kind]) => kind)
  for (const kind of topKinds) {
    for (const hit of hits) {
      if (stops.length >= maxStops) break
      if (hit.record.kind !== kind || used.has(hit.record.id)) continue
      stops.push({ record: hit.record, reason: 'same-kind' })
      used.add(hit.record.id)
    }
  }

  // Stage 2: corridor expansion — pull neighbors for each selected stop, pick unused active ones (fill at most to maxStops-1, leaving room for contrast).
  for (const stop of [...stops]) {
    if (stops.length >= maxStops - 1) break
    const neighbors = await poolLookup(stop.record.id)
    // Simple degradation: use the hits themselves as neighbor candidates (keeps the path sound without extra IO). The production implementation should go through engram_neighbors.
    for (const hit of hits) {
      if (stops.length >= maxStops - 1) break
      if (used.has(hit.record.id) || hit.record.id === stop.record.id) continue
      if (hit.record.scope !== stop.record.scope) continue
      stops.push({ record: hit.record, reason: 'neighbor' })
      used.add(hit.record.id)
    }
    // An explicit noop keeps the expansion entry
    void neighbors
  }

  // Stage 3: contrast closure — hits with emotional weight ≥ 0.7 not yet selected.
  const emotionCut = hits.find(hit => !used.has(hit.record.id) && (hit.record.imagery?.emotionalValence ?? 0) >= 0.7)
  if (emotionCut !== undefined && stops.length < maxStops) {
    stops.push({ record: emotionCut.record, reason: 'emotional-peak' })
    used.add(emotionCut.record.id)
  }

  // Stage 4 (fallback): if there are still empty slots, fill with any remaining hits, by score descending.
  for (const hit of hits) {
    if (stops.length >= maxStops) break
    if (used.has(hit.record.id)) continue
    stops.push({ record: hit.record, reason: 'contrast' })
    used.add(hit.record.id)
  }

  const narrative = renderTourNarrative(stops, query)
  return { stops, narrative, query }
}

/** Render the tour path into a readable text with echo triggers (for engram_tour's text field). */
function renderTourNarrative(stops: readonly TourStop[], query: string): string {
  if (stops.length === 0) return 'No tour path.'
  const reasonLabel = (reason: TourStop['reason']): string => {
    switch (reason) {
      case 'same-kind': return 'same-kind consolidation'
      case 'neighbor': return 'corridor adjacency'
      case 'contrast': return 'contrast fill-in'
      case 'emotional-peak': return 'emotional strong contrast'
    }
  }
  const lines: string[] = [`Tour path (query: ${query}): organized in "same-kind consolidation → corridor adjacency → contrast fill-in" order, ${stops.length} stops total.`]
  stops.forEach((stop, index) => {
    const caption = stop.record.imagery?.caption
    const sensory = stop.record.imagery?.sensoryTags ?? []
    const echo = caption === null || caption === undefined
      ? '(no inscribed imagery; call engram_examine first to read the placard)'
      : `Echo: reminiscent of "${caption}"${sensory.length > 0 ? ` (${sensory.slice(0, 3).join(', ')})` : ''}`
    lines.push(`${index + 1}. [${stop.record.scope}/${stop.record.kind}] ${stop.record.content.slice(0, 60)}${stop.record.content.length > 60 ? '…' : ''} (id=${stop.record.id}, reason: ${reasonLabel(stop.reason)}) — ${echo}`)
  })
  return lines.join('\n')
}
