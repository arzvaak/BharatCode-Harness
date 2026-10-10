







import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: merges the ctx.webServer service declaration.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { EngramEntityKind, EngramKind, EngramScope, EngramStatus, ListFilter, ObservationStatus, ReviewGrade } from './types.ts'
import type { EngramStore } from './store/interface.ts'
import type { EngramEmbedder } from './embedder/interface.ts'
import type { HistoryBackfillRules, HistoryEstimate, HistoryRunProgress, HistoryRunResult } from './ingest/history.ts'
import type { ProjectPalaceKind } from './project/registry.ts'
import type { ResolvedHistoryRules, ResolvedJevConfig } from './config.ts'
import { effectiveJevConfig, jevConfigView, loadJevOverride, parseJevPatch, saveJevOverride } from './jev/runtime.ts'
import { testJevConnection } from './jev/client.ts'
import { listJevObservations } from './jev/observe.ts'
import { writeMirror } from './mirror/markdown.ts'
import { createBackup, restoreBackup, BACKUP_SCHEMA_VERSION } from './backup/tar.ts'
import { runConsolidation } from './consolidation/run.ts'
import { aggregateTelemetry } from './telemetry/aggregate.ts'
import { buildTourProposal } from './tour-proposal.ts'
import { gatherRefurbSuggestions, DEFAULT_REFURB_OPTIONS } from './refurb.ts'


function isLoopbackPeer(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  if (address === undefined) return false
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}


function isLoopbackHost(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (host === undefined || host === '') return true
  const name = host.split(':')[0]
  return name === 'localhost' || name === '::1' || (name !== undefined && /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name))
}


function isLoopbackOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin === '') return true
  try {
    const host = new URL(origin).hostname
    return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  } catch {
    return false
  }
}





export function guardLoopback(req: IncomingMessage, res: ServerResponse): boolean {
  const methodOk = req.method === 'GET' || req.method === 'POST'
  if (!methodOk || !isLoopbackPeer(req) || !isLoopbackHost(req)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'forbidden: loopback only' }))
    return false
  }
  return true
}


function guardWrite(req: IncomingMessage, res: ServerResponse): boolean {
  if (!isLoopbackOrigin(req.headers.origin)) {
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'forbidden: loopback only' }))
    return false
  }
  if (!(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
    res.writeHead(415, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'unsupported content-type' }))
    return false
  }
  return true
}


async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > 65_536) return null
  }
  try {
    const parsed: unknown = JSON.parse(body === '' ? '{}' : body)
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}


function scopeOf(raw: string | null, fallback: EngramScope): EngramScope {
  if (raw === 'user' || raw === 'project' || raw === 'shared') return raw
  return fallback
}


function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}


function toBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}


function historyRulesOf(raw: Readonly<Record<string, unknown>>): HistoryBackfillRules {
  const days = toNumber(raw['days'])
  const maxTurnsPerSession = toNumber(raw['maxTurnsPerSession'])
  const maxTotalTurns = toNumber(raw['maxTotalTurns'])
  const includeSubagents = toBoolean(raw['includeSubagents'])
  const includeSeeded = toBoolean(raw['includeSeeded'])
  const includeNoCwd = toBoolean(raw['includeNoCwd'])
  return {
    ...(days === undefined ? {} : { days }),
    ...(maxTurnsPerSession === undefined ? {} : { maxTurnsPerSession }),
    ...(maxTotalTurns === undefined ? {} : { maxTotalTurns }),
    ...(includeSubagents === undefined ? {} : { includeSubagents }),
    ...(includeSeeded === undefined ? {} : { includeSeeded }),
    ...(includeNoCwd === undefined ? {} : { includeNoCwd }),
  }
}


export interface ProjectPalaceView {
  
  readonly dbName: string
  
  readonly title: string
  
  readonly path: string | null
  
  readonly kind: ProjectPalaceKind
  
  readonly source: 'origin' | 'cwd' | 'workspace'
  
  readonly workspaceId: string | null
  
  readonly exists: boolean
  
  readonly memories: number | null
}


class UnknownProjectError extends Error {
  constructor(selector: string) {
    super(`unknown project: ${selector}`)
    this.name = 'UnknownProjectError'
  }
}


export interface RouteDeps {
  readonly openStore: (scope: EngramScope) => Promise<EngramStore>
  



  readonly projects: {
    list: () => Promise<readonly ProjectPalaceView[]>
    open: (selector: string | undefined) => Promise<{ readonly store: EngramStore; readonly project: ProjectPalaceView } | undefined>
  }
  readonly exportDir: string
  
  readonly embedder: Promise<EngramEmbedder | undefined>
  
  readonly mirrorDir: string
  
  readonly dbDir: string
  
  readonly pluginVersion: string
  
  readonly history: {
    
    readonly estimate: (rules: HistoryBackfillRules) => Promise<HistoryEstimate>
    
    readonly start: (rules: HistoryBackfillRules) => { ok: boolean; reason?: string }
    
    readonly cancel: () => void
    
    readonly status: () => { progress: HistoryRunProgress; failures: HistoryRunResult['failures']; error?: string }
    
    readonly models: () => Promise<{
      providers: { id: string; name: string; models: { id: string; name: string }[] }[]
      failures: string[]
    }>
    
    readonly defaults: ResolvedHistoryRules
  }
  
  readonly jev: {
    
    readonly base: ResolvedJevConfig
    
    readonly dbDir: string
  }
}





export function registerEngramRoutes(ctx: Context, deps: RouteDeps): void {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/engram',
      handler: async (req, res) => {
        if (!guardLoopback(req, res)) return
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const route = url.pathname.slice('/api/engram/'.length)

        const selectorRef: { value: string | undefined } = { value: url.searchParams.get('project') ?? undefined }
        
        const storeFor = async (scope: EngramScope): Promise<EngramStore> => {
          if (scope !== 'project') return deps.openStore(scope)
          const opened = await deps.projects.open(selectorRef.value)
          if (opened === undefined) throw new UnknownProjectError(selectorRef.value ?? '')
          return opened.store
        }
        
        const adoptBodySelector = (body: Record<string, unknown> | null): void => {
          const raw = body?.['project']
          if (typeof raw === 'string' && raw !== '') selectorRef.value = raw
        }
        try {
          if (req.method === 'GET' && route === 'workspaces') {

            const items = await deps.projects.list()
            const processDefault = items.find(item => item.kind === 'process')
            json(res, 200, {
              items,
              processDefault: processDefault === undefined
                ? null
                : { dbName: processDefault.dbName, path: processDefault.path, title: processDefault.title },
            })
            return
          }
          if (req.method === 'GET' && route === 'stats') {
            const scopes: EngramScope[] = ['user', 'project']
            const parts = await Promise.all(scopes.map(async (scope) => ({ scope, stats: await (await storeFor(scope)).stats() })))
            json(res, 200, { parts })
            return
          }
          if (req.method === 'GET' && route === 'list') {
            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const status = url.searchParams.get('status')
            const kind = url.searchParams.get('kind')
            const q = url.searchParams.get('q')
            const redacted = url.searchParams.get('redacted')
            const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
            const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
            const filter: ListFilter = {
              scope,
              ...(status !== null && status !== '' && status !== 'all' ? { status: status as EngramStatus } : {}),
              ...(kind !== null && kind !== '' && kind !== 'all' ? { kind: kind as EngramKind } : {}),
              ...(q !== null && q !== '' ? { q } : {}),
              ...(redacted === 'true' || redacted === 'false' ? { redacted: redacted === 'true' } : {}),

              ...(url.searchParams.get('sort') === 'tour' ? { sort: 'tour' as const } : {}),
              limit,
              offset,
            }
            json(res, 200, await (await storeFor(scope)).list(filter))
            return
          }
          if (req.method === 'GET' && route === 'search-test') {

            const q = url.searchParams.get('q')
            if (q === null || q.trim() === '') { json(res, 400, { error: 'q required' }); return }
            const scopeParam = url.searchParams.get('scope')
            const scopes: EngramScope[] = scopeParam === 'all' || scopeParam === null || scopeParam === ''
              ? ['user', 'project']
              : [scopeOf(scopeParam, 'user')]
            const kind = url.searchParams.get('kind')
            const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10))
            const embedder = deps.embedder === undefined ? undefined : await deps.embedder
            const vector = embedder === undefined ? undefined : (await embedder.embed([q.trim()]))[0]
            const results = await Promise.all(scopes.map(async scope => {
              const store = await storeFor(scope)
              return store.search({ text: q, scopes: [scope], limit }, vector)
            }))
            const degraded = results.some(result => result.degraded)
            let hits = results.flatMap(result => result.hits)
            if (kind !== null && kind !== '' && kind !== 'all') hits = hits.filter(hit => hit.record.kind === kind)
            json(res, 200, {
              degraded,
              hits: hits.map(hit => ({
                id: hit.record.id,
                score: hit.score,
                via: hit.via,
                ...(hit.viaEdge === undefined ? {} : { viaEdge: hit.viaEdge }),
                scope: hit.record.scope,
                kind: hit.record.kind,
                status: hit.record.status,
                content: hit.record.content,
                createdAt: hit.record.createdAt,
              })),
            })
            return
          }
          if (req.method === 'GET' && route === 'observations') {

            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const status = url.searchParams.get('status')
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100))
            const items = await (await storeFor(scope)).listObservations({
              ...(status !== null && status !== '' && status !== 'all' ? { status: status as ObservationStatus } : {}),
              limit,
            })
            json(res, 200, { scope, items, total: items.length })
            return
          }
          if (req.method === 'GET' && route === 'observation-evidence') {

            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const ids = (url.searchParams.get('ids') ?? '')
              .split(',').map(part => part.trim()).filter(part => part !== '').slice(0, 50)
            if (ids.length === 0) { json(res, 400, { error: 'ids required' }); return }
            const items = await (await storeFor(scope)).getMany(ids as never)
            json(res, 200, { scope, items })
            return
          }
          if (req.method === 'GET' && route === 'entities') {

            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const kind = url.searchParams.get('kind')
            const q = url.searchParams.get('q')
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50))
            const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
            const result = await (await storeFor(scope)).listEntities({
              ...(kind !== null && kind !== '' && kind !== 'all' ? { kind: kind as EngramEntityKind } : {}),
              ...(q !== null && q !== '' ? { q } : {}),
              limit,
              offset,
            })
            json(res, 200, { scope, ...result })
            return
          }
          if (req.method === 'GET' && route === 'entity') {

            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const id = url.searchParams.get('id')
            if (id === null || id === '') { json(res, 400, { error: 'id required' }); return }
            const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
            const detail = await (await storeFor(scope)).entityDetail(id as never, limit)
            if (detail === undefined) { json(res, 404, { error: `Entity not found: ${id}` }); return }
            json(res, 200, detail)
            return
          }
          if (req.method === 'GET' && route === 'facts') {

            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const id = url.searchParams.get('entityId')
            if (id === null || id === '') { json(res, 400, { error: 'entityId required' }); return }
            const asOf = toNumber(url.searchParams.get('asOf'))
            const includeInvalid = toBoolean(url.searchParams.get('includeInvalid')) ?? false
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50))
            const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
            const result = await (await storeFor(scope)).factsOfEntity({
              entityId: id as never,
              ...(asOf === undefined ? {} : { asOf }),
              ...(includeInvalid ? { includeInvalid: true } : {}),
              limit,
              offset,
            })
            json(res, 200, { scope, ...result })
            return
          }
          if (req.method === 'GET' && route === 'episode-timeline') {


            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const since = toNumber(url.searchParams.get('since'))
            const until = toNumber(url.searchParams.get('until'))
            const sessionId = url.searchParams.get('sessionId') ?? undefined
            const around = url.searchParams.get('around') ?? undefined
            const windowMinutes = Math.min(24 * 60, Math.max(1, toNumber(url.searchParams.get('windowMinutes')) ?? 60))
            const limit = Math.min(200, Math.max(1, toNumber(url.searchParams.get('limit')) ?? 100))
            const store = await storeFor(scope)
            if (around !== undefined && around !== '') {
              const result = await store.episodeTimeline({ scopes: [scope], around: around as never, proximityMs: windowMinutes * 60_000, limit })
              const view = result.around!
              json(res, 200, {
                around: {
                  anchor: {
                    id: view.anchor.id, kind: view.anchor.kind, content: view.anchor.content, createdAt: view.anchor.createdAt,
                  },
                  neighbors: view.neighbors.map(record => ({
                    id: record.id, kind: record.kind, content: record.content, createdAt: record.createdAt,
                  })),
                },
              })
              return
            }
            const result = await store.episodeTimeline({
              scopes: [scope],
              ...(since === undefined ? {} : { since }),
              ...(until === undefined ? {} : { until }),
              ...(sessionId === undefined || sessionId === '' ? {} : { sessionId }),
              limit,
            })
            json(res, 200, {
              groups: result.groups.map(group => ({
                sessionId: group.sessionId,
                ...(group.summary === undefined ? {} : { summary: group.summary }),
                startedAt: group.startedAt,
                endedAt: group.endedAt,
                episodes: group.episodes.map(record => ({
                  id: record.id, kind: record.kind, content: record.content, createdAt: record.createdAt,
                })),
              })),
            })
            return
          }
          if (req.method === 'GET' && route === 'activity') {

            const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
            const scopes: EngramScope[] = ['user', 'project']
            const merged = (await Promise.all(scopes.map(async scope => {
              const ops = await (await storeFor(scope)).recentOps(limit)
              return ops.map(op => ({ ...op, scope }))
            }))).flat().sort((a, b) => b.at - a.at).slice(0, limit)
            json(res, 200, { operations: merged })
            return
          }
          if (req.method === 'GET' && route === 'review-due') {

            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
            const now = Date.now()
            const due = await (await storeFor(scope)).dueReviews(now, limit)
            json(res, 200, {
              scope,
              items: due.map(record => ({
                id: record.id,
                kind: record.kind,
                ...(record.slot === undefined ? {} : { slot: record.slot }),
                caption: record.imagery?.caption ?? null,
                nextReviewAt: record.review?.nextReviewAt ?? null,
                overdueDays: record.review?.nextReviewAt === null || record.review?.nextReviewAt === undefined
                  ? 0
                  : Math.max(0, Math.floor((now - record.review.nextReviewAt) / 86_400_000)),
                reps: record.review?.reps ?? 0,
              })),
            })
            return
          }
          if (req.method === 'POST' && route === 'review-answer') {

            if (!guardWrite(req, res)) return
            const body = await readJsonBody(req)
            if (body === null || typeof body.id !== 'string' || body.id === '') { json(res, 400, { error: 'id required' }); return }
            const grade = typeof body.grade === 'number' && Number.isInteger(body.grade) && body.grade >= 0 && body.grade <= 5
              ? body.grade as 0 | 1 | 2 | 3 | 4 | 5
              : null
            if (grade === null) { json(res, 400, { error: 'grade must be an integer 0-5' }); return }
            adoptBodySelector(body)
            const scope = scopeOf(typeof body.scope === 'string' ? body.scope : null, 'user')
            const store = await storeFor(scope)
            const record = await store.scheduleReview(body.id as never, grade)
            if (record === undefined) { json(res, 404, { error: `Memory not found: ${body.id}` }); return }
            json(res, 200, { id: record.id, review: record.review ?? null })
            return
          }
          if (req.method === 'GET' && route === 'review') {
            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const id = url.searchParams.get('id')
            if (id === null || id === '') { json(res, 400, { error: 'id required' }); return }
            const store = await storeFor(scope)
            const view = await store.review(id as never)
            if (view === undefined) { json(res, 404, { error: `Memory not found: ${id}` }); return }
            json(res, 200, view)
            return
          }
          if (req.method === 'GET' && route === 'review-due') {

            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
            const now = Date.now()
            const due = await (await storeFor(scope)).dueReviews(now, limit)
            json(res, 200, {
              scope,
              count: due.length,
              now,
              items: due.map(record => ({
                id: record.id,
                kind: record.kind,
                scope: record.scope,
                importance: record.importance,
                confidence: record.confidence,
                ...(record.slot === undefined ? {} : { slot: record.slot }),
                ...(typeof record.imagery?.caption === 'string' ? { caption: record.imagery.caption } : {}),
                ...(record.review?.nextReviewAt === null || record.review?.nextReviewAt === undefined
                  ? {}
                  : { overdueDays: Math.max(0, Math.floor((now - record.review.nextReviewAt) / 86_400_000)) }),
                ...(record.review === undefined ? {} : { reps: record.review.reps, intervalDays: record.review.intervalDays }),
              })),
            })
            return
          }
          if (req.method === 'POST' && route === 'review-answer') {

            if (!guardWrite(req, res)) return
            const body = await readJsonBody(req)
            if (body === null || typeof body.id !== 'string' || body.id === '') { json(res, 400, { error: 'id required' }); return }
            const grade = Number(body.grade)
            if (!Number.isInteger(grade) || grade < 0 || grade > 5) { json(res, 400, { error: 'grade must be an integer 0-5' }); return }
            adoptBodySelector(body)
            const scope = scopeOf(typeof body.scope === 'string' ? body.scope : null, 'user')
            const record = await (await storeFor(scope)).scheduleReview(body.id as never, grade as ReviewGrade)
            if (record === undefined) { json(res, 404, { error: `Memory not found: ${body.id}` }); return }
            json(res, 200, { record })
            return
          }
          if (req.method === 'GET' && route === 'export') {
            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const format = url.searchParams.get('format') === 'json' ? 'json' : 'markdown'
            const data = await (await storeFor(scope)).exportAll()
            const stamp = new Date().toISOString().replaceAll(':', '-')
            const body = format === 'json'
              ? JSON.stringify(data, null, 2)
              : [
                  `# dsh-engram export (${scope}）`,
                  '',
                  ...data.records.map(record =>
                    `- [${record.status}/${record.kind}] ${record.content}（id=${record.id}，importance ${record.importance}）`),
                  '',
                  '## Relations',
                  ...data.edges.map(edge => `- ${edge.from} --${edge.type}--> ${edge.to}`),
                  '',
                ].join('\n')
            res.writeHead(200, {
              'content-type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
              'content-disposition': `attachment; filename="engram-${scope}-${stamp}.${format}"`,
            })
            res.end(body)
            return
          }
          if (req.method === 'GET' && route === 'mirror') {

            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const data = await (await storeFor(scope)).exportAll()
            const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
            const mirrorRoot = join(deps.mirrorDir, scope, stamp)
            const report = await writeMirror(mirrorRoot, data)
            json(res, 200, { ...report, scope, memoryCount: data.records.length, edgeCount: data.edges.length })
            return
          }
          if (req.method === 'GET' && route === 'health') {








            const rawScope = url.searchParams.get('scope')
            const scopes: EngramScope[] = rawScope === 'user' || rawScope === 'project' || rawScope === 'shared'
              ? [rawScope]
              : ['user', 'project']
            const parts = await Promise.all(scopes.map(async scope => {
              const store = await storeFor(scope)
              const s = await store.stats()
              const edgeCount = (await store.exportAll()).edges.length
              const total = Math.max(s.total, 1)
              const signal = s.signalRatio
              const activeRatio = s.active / total
              const corridorRatio = Math.min(0.5, edgeCount / Math.max(s.active, 1)) / 0.5
              const redactedPenalty = Math.max(0, 1 - s.redacted / total)
              const archivedRatio = s.archived / total


              const isShared = scope === 'shared'
              const targetActive = isShared ? 0.7 : 0.85
              const decayLow = isShared ? 0.25 : 0.15
              const decayHigh = isShared ? 0.5 : 0.45
              const decayWindow = isShared ? 0.25 : 0.3
              const decayCoverage = archivedRatio >= decayLow && archivedRatio <= decayHigh
                ? 1
                : Math.max(0, 1 - Math.min(Math.abs(archivedRatio - decayLow), Math.abs(archivedRatio - decayHigh)) / decayWindow)
              const score = Math.round(
                signal * 40
                + (1 - Math.abs(activeRatio - targetActive) / targetActive) * 25
                + corridorRatio * 15
                + redactedPenalty * 10
                + decayCoverage * 10,
              )
              return { scope, score: Math.min(100, Math.max(0, score)), signal, activeRatio, edgeCount, redacted: s.redacted, archivedRatio }
            }))
            const overall = Math.round(parts.reduce((sum, part) => sum + part.score, 0) / parts.length)
            json(res, 200, { overall, parts, evaluatedAt: Date.now() })
            return
          }
          if (req.method === 'GET' && route === 'corridor') {


            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const includeStatuses = new Set(['active'])
            const rawStatus = url.searchParams.get('status')
            if (rawStatus !== null && rawStatus !== '' && rawStatus !== 'all') {
              for (const s of rawStatus.split(',')) {
                if (s === 'active' || s === 'archived' || s === 'forgotten') includeStatuses.add(s)
              }
            }
            const data = await (await storeFor(scope)).exportAll()
            const nodes = data.records
              .filter(r => includeStatuses.has(r.status))
              .map(r => ({
                id: r.id,
                scope: r.scope,
                kind: r.kind,
                status: r.status,
                importance: r.importance,
                confidence: r.confidence,
                title: r.content.length > 40 ? `${r.content.slice(0, 40)}…` : r.content,
                content: r.content,
              }))
            const allowedIds = new Set(nodes.map(n => n.id))
            const edges = data.edges
              .filter(e => allowedIds.has(e.from) && allowedIds.has(e.to))
              .map(e => ({ id: `${e.from}-${e.to}-${e.type}`, from: e.from, to: e.to, type: e.type }))
            json(res, 200, { scope, nodes, edges })
            return
          }
          if (req.method === 'GET' && route === 'telemetry') {


            const windowDays = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 7) || 7))
            const rawScope = url.searchParams.get('scope')
            const scopeFilter: 'user' | 'project' | 'shared' | undefined =
              rawScope === 'user' ? 'user' : rawScope === 'project' ? 'project' : rawScope === 'shared' ? 'shared' : undefined

            const snapshot = await aggregateTelemetry(scope => storeFor(scope), windowDays, scopeFilter)
            json(res, 200, snapshot)
            return
          }
          if (req.method === 'GET' && route === 'tour-proposal') {


            const rawScope = url.searchParams.get('scope')
            const scope: EngramScope = rawScope === 'project' ? 'project' : rawScope === 'shared' ? 'shared' : 'user'
            const store = await storeFor(scope)
            const filter = await store.list({ scope, status: 'active', limit: 200, offset: 0 })
            const focusKind = url.searchParams.get('focusKind')
            const proposal = buildTourProposal(scope, filter.records, focusKind ?? undefined)
            json(res, 200, {
              scope: proposal.empty ? 'empty' : scope,
              greeting: proposal.greeting,
              activeCount: proposal.activeCount,
              empty: proposal.empty,
              suggestedStops: proposal.suggestedStops.map(record => ({
                id: record.id,
                kind: record.kind,
                content: record.content,
                importance: record.importance,
                confidence: record.confidence,
              })),
            })
            return
          }
          if (req.method === 'GET' && route === 'refurb') {

            const rawScope = url.searchParams.get('scope')
            const scope: EngramScope = rawScope === 'project' ? 'project' : rawScope === 'shared' ? 'shared' : 'user'
            const store = await storeFor(scope)
            const filter = await store.list({ scope, status: 'active', limit: 500, offset: 0 })
            const suggestions = gatherRefurbSuggestions(filter.records, DEFAULT_REFURB_OPTIONS)
            json(res, 200, {
              scope,
              count: suggestions.length,
              suggestions: suggestions.map(suggestion => ({
                action: suggestion.action,
                primaryId: suggestion.primaryId,
                candidates: [...suggestion.candidates],
                scope: suggestion.scope,
                reason: suggestion.reason,
                confidence: suggestion.confidence,
              })),
            })
            return
          }
          if (req.method === 'GET' && route === 'models') {

            json(res, 200, await deps.history.models())
            return
          }
          if (req.method === 'GET' && route === 'profile-block') {


            const scope = scopeOf(url.searchParams.get('scope'), 'user')
            const store = await storeFor(scope)
            const block = await store.getProfileBlock(scope)
            const versions = await store.listProfileBlockVersions(scope, 20)
            json(res, 200, { scope, block: block ?? null, versions })
            return
          }
          if (req.method === 'GET' && route === 'history-backfill') {

            json(res, 200, {
              defaults: deps.history.defaults,
              estimate: await deps.history.estimate(historyRulesOf(Object.fromEntries(url.searchParams))),
            })
            return
          }
          if (req.method === 'GET' && route === 'history-backfill/status') {
            json(res, 200, deps.history.status())
            return
          }
          if (req.method === 'POST' && route === 'history-backfill/start') {
            if (!guardWrite(req, res)) return
            const body = await readJsonBody(req)
            const started = deps.history.start(historyRulesOf(body ?? {}))
            if (!started.ok) { json(res, 409, { ok: false, error: started.reason ?? 'Unable to start backfill' }); return }
            json(res, 200, { ok: true, status: deps.history.status() })
            return
          }
          if (req.method === 'POST' && route === 'history-backfill/cancel') {
            if (!guardWrite(req, res)) return
            deps.history.cancel()
            json(res, 200, { ok: true, status: deps.history.status() })
            return
          }
          if (req.method === 'GET' && route === 'jev-config') {

            json(res, 200, jevConfigView(deps.jev.base, loadJevOverride(deps.jev.dbDir)))
            return
          }
          if (req.method === 'POST' && route === 'jev-config') {

            if (!guardWrite(req, res)) return
            const body = await readJsonBody(req)
            const parsed = parseJevPatch(loadJevOverride(deps.jev.dbDir), body ?? {})
            if (typeof parsed === 'string') { json(res, 400, { error: parsed }); return }
            saveJevOverride(deps.jev.dbDir, parsed)
            json(res, 200, { ok: true, view: jevConfigView(deps.jev.base, parsed) })
            return
          }
          if (req.method === 'POST' && route === 'jev-test') {


            if (!guardWrite(req, res)) return
            const body = await readJsonBody(req)
            const base = effectiveJevConfig(deps.jev.base, loadJevOverride(deps.jev.dbDir))
            const tested: ResolvedJevConfig = {
              ...base,
              ...(typeof body?.baseUrl === 'string' && body.baseUrl.trim() !== '' ? { baseUrl: body.baseUrl.trim() } : {}),
              ...(typeof body?.model === 'string' && body.model.trim() !== '' ? { model: body.model.trim() } : {}),
              ...(typeof body?.apiKey === 'string' && body.apiKey !== '' ? { apiKey: body.apiKey } : {}),
            }
            json(res, 200, await testJevConnection(tested))
            return
          }
          if (req.method === 'GET' && route === 'jev-observations') {

            json(res, 200, { items: [...listJevObservations()].reverse() })
            return
          }
          if (req.method === 'POST' && route === 'consolidate') {


            if (!guardWrite(req, res)) return
            const body = await readJsonBody(req)
            adoptBodySelector(body)
            const rawScope = typeof body?.scope === 'string' ? body.scope : 'user'
            const scope: 'user' | 'project' | 'shared' = rawScope === 'project' ? 'project' : rawScope === 'shared' ? 'shared' : 'user'
            const candidates = Array.isArray(body?.candidates)
              ? body.candidates.filter((value: unknown): value is string => typeof value === 'string')
              : undefined
            const store = await storeFor(scope)
            const report = await runConsolidation(store, deps.embedder, candidates === undefined
              ? { scope }
              : { scope, mergeCandidateIds: candidates })
            json(res, 200, report)
            return
          }
          if (req.method === 'POST' && route === 'backup') {
            if (!guardWrite(req, res)) return
            const result = await createBackup(deps.dbDir, deps.pluginVersion)
            json(res, 200, { archivePath: result.archivePath, bytes: result.bytes, meta: result.meta, schemaVersion: BACKUP_SCHEMA_VERSION })
            return
          }
          if (req.method === 'POST' && route === 'restore-backup') {
            if (!guardWrite(req, res)) return
            const body = await readJsonBody(req)
            if (body === null || typeof body.archivePath !== 'string' || body.archivePath === '') {
              json(res, 400, { error: 'archivePath required' })
              return
            }

            const normalized = join(deps.dbDir, body.archivePath.replace(/^\/+/, ''))
            if (!normalized.startsWith(deps.dbDir + '/') && normalized !== deps.dbDir) {
              json(res, 400, { error: 'archivePath must be inside dbDir' })
              return
            }
            try {
              const result = await restoreBackup(normalized, deps.dbDir)
              json(res, 200, { restored: result.restored, meta: result.archiveMeta })
            } catch (restoreError: unknown) {
              const message = restoreError instanceof Error ? restoreError.message : String(restoreError)
              json(res, 400, { error: `Restore failed: ${message}` })
            }
            return
          }
          if (req.method === 'POST' && (route === 'update' || route === 'forget' || route === 'restore')) {
            if (!guardWrite(req, res)) return
            const body = await readJsonBody(req)
            if (body === null || typeof body.id !== 'string' || body.id === '') { json(res, 400, { error: 'id required' }); return }
            adoptBodySelector(body)
            const scope = scopeOf(typeof body.scope === 'string' ? body.scope : null, 'user')
            const store = await storeFor(scope)
            if (route === 'update') {
              if (typeof body.content !== 'string' || body.content.trim() === '') { json(res, 400, { error: 'content required' }); return }
              const old = await store.get(body.id as never)
              if (old === undefined) { json(res, 404, { error: `Memory not found: ${body.id}` }); return }
              const record = await store.update({
                id: body.id as never,
                scope,
                kind: typeof body.kind === 'string' && ['fact', 'preference', 'decision', 'episode', 'skill'].includes(body.kind)
                  ? body.kind as EngramKind
                  : old.kind,
                content: body.content,
                ...(typeof body.importance === 'number' && Number.isFinite(body.importance)
                  ? { importance: Math.min(1, Math.max(0, body.importance)) }
                  : {}),
              })
              json(res, 200, { record })
              return
            }
            const record = route === 'forget'
              ? await store.forget(body.id as never)
              : await store.restore(body.id as never)
            json(res, 200, { record })
            return
          }
          json(res, 404, { error: 'unknown route' })
        } catch (error) {

          if (error instanceof UnknownProjectError) { json(res, 404, { error: 'unknown project' }); return }
          json(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),
    'dsh-engram: api routes',
  )
}
