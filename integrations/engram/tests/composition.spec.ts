/**
 * REAL-composition coverage: a test cordis.yml is loaded through the real
 * Loader with webserver + system-prompt + tools + an llm double + dsh-engram,
 * asserting the admin page and the full /api/engram/* surface (list/stats/
 * update/forget/export/review-queue/loopback write guard), plus tool
 * registration and fiber unload (HMR safety). The doubles only cover the
 * external network (every fetch is rejected so the embedder degrades
 * immediately -- the degradation path itself is part of the behavior under
 * test) and the llm auxiliary call endpoint.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { openEngramStore } from '../src/store/sqlite.ts'
import * as StoreModule from '../src/store/sqlite.ts'
import * as ReflectModule from '../src/consolidation/reflect.ts'
import * as IngestModule from '../src/ingest/hook.ts'
import { markPendingIngest } from '../src/ingest/hook.ts'
import { readMigrationPointer, resolveProjectIdentity, workspaceProjectDbName } from '../src/project/identity.ts'
import * as Engram from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

beforeEach(() => {
  // Reject all external network (the embedder model download fails instantly and the plugin degrades by design); local loopback passes through for the API-assertion fetches.
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.startsWith('http://127.0.0.1')) return realFetch(input, init)
    throw new Error(`offline in test: ${url}`)
  }))
})

afterEach(async () => {
  await context?.fiber?.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Records the call parameters received by the llm double (asserts routing attribution of auxiliary calls). */
const llmCalls: { route?: unknown }[] = []

/** llm service double: the auxiliary call endpoint exists but is unavailable (the runtime failure paths of ingest/distillation are out of scope for this test). */
const llmDouble = {
  name: 'test-engram-llm',
  apply(ctx: Context): void {
    ctx.provide('llm', {
      stream: async function* (params: { route?: unknown }) {
        llmCalls.push(params)
        throw new Error('llm offline in test')
      },
      // Model catalog (the data source of the panel's auxiliary-model dropdown).
      listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
      listModels: async () => [{ id: 'deepseek-v4', name: 'DeepSeek V4' }],
    } as never)
  },
}

const EXPECTED_TOOLS = [
  'engram_assess', 'engram_audit_forgotten', 'engram_distill', 'engram_episode_timeline', 'engram_examine',
  'engram_export', 'engram_facts', 'engram_forget', 'engram_ingest_history', 'engram_neighbors', 'engram_profile_edit',
  'engram_reflect', 'engram_report', 'engram_review', 'engram_review_queue', 'engram_save', 'engram_search', 'engram_stats',
  'engram_timeline', 'engram_tour', 'engram_update',
]

/** Pending make-up ingest key seeded into the user store (for the cross-session pending replay case). */
interface PendingSeed {
  readonly sessionId: string
  readonly turn: number
}

/** Session persistence double: the new dsh handle-based API (`list()` gives the snapshot, the log is read through an `open(id,'read')` handle,
 * and the handle carries the header -- the make-up turns use it to decide which project palace to write into).
 * `calls` records every open and its handle usage, to assert that cross-session reads actually go through the host service. */
function makePersistenceDouble(
  header: { id: string; createdAt: number; cwd: string },
  events: readonly unknown[],
  calls: { id: string; access: string; reads: number; closed: boolean }[] = [],
): unknown {
  return {
    list: async () => [{ header }],
    open: async (id: string, access: string) => {
      const record = { id, access, reads: 0, closed: false }
      calls.push(record)
      return {
        id,
        header,
        read: async () => {
          record.reads += 1
          return { eventState: 'detached', events }
        },
        close: async () => { record.closed = true },
      }
    },
  }
}

/** Write seed memories before the host opens the stores (sequential connections in the same process, timing-safe).
 * The keep entry's review schedule is pushed back 1 day so the review-due / review-answer chain can be asserted. */
async function seedMemories(dbPath: string, pending?: PendingSeed): Promise<{ keep: string; dropped: string }> {
  const store = await openEngramStore(dbPath)
  const keep = (await store.write({ scope: 'user', kind: 'preference', content: "Seed preference: reply in Simplified Chinese", importance: 0.8 })).id
  const dropped = (await store.write({ scope: 'user', kind: 'fact', content: "Seed fact: to be forgotten", importance: 0.5 })).id
  if (pending !== undefined) await markPendingIngest(store, pending.sessionId, pending.turn)
  await store.close()
  const { DatabaseSync } = await import('node:sqlite')
  const raw = new DatabaseSync(dbPath)
  raw.prepare('UPDATE nodes SET next_review_at = ? WHERE id = ?').run(Date.now() - 86_400_000, keep)
  raw.close()
  return { keep, dropped }
}

/** Boots a six-line cordis.yml (webserver + system-prompt + tools + llm double + engram) through the real Loader.
 * extraConfig is appended under the engram line's config (e.g. `    ingest: 'light'`);
 * pending pre-seeds a pending make-up ingest key (cross-session pending replay case). */
async function loadComposition(extraConfig: readonly string[] = [], pending?: PendingSeed, prepare?: (dbDir: string) => Promise<void>): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-engram-'))
  const dbPath = join(root, 'engram', 'user.db')
  await seedMemories(dbPath, pending)
  await prepare?.(join(root, 'engram'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: 'virtual:engram-llm'",
    "- name: '@kenz1117/dsh-engram'",
    '  config:',
    `    dbDir: '${join(root, 'engram')}'`,
    ...extraConfig,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['virtual:engram-llm', llmDouble],
    ['@kenz1117/dsh-engram', Engram],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  // Wait for the injected child fiber (registers routes once webServer is ready) to finish.
  await new Promise(resolve => setTimeout(resolve, 300))
  return context
}

/** GET/POST one engram API path; returns status and the parsed JSON body. */
async function call(port: number, method: 'GET' | 'POST', path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: unknown; text: string; contentType: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }),
    ...(body === undefined && headers !== undefined ? { headers } : {}),
  })
  const text = await response.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: response.status, json, text, contentType: response.headers.get('content-type') ?? '' }
}

describe('dsh-engram real Loader composition', () => {
  it('all 21 tools visible after load, gone after the engram line is unloaded', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const names = () => loaded.tools.schemas().map(schema => schema.name)
    for (const expected of EXPECTED_TOOLS) {
      expect(names()).toContain(expected)
    }

    // HMR safety: after unloading the engram line, all 21 tools are released (the tools service remains, other tools unaffected).
    const entry = [...loaded.loader.entries()]
      .find(candidate => candidate.options.name === '@kenz1117/dsh-engram')
    expect(entry).toBeDefined()
    await entry!.fiber?.dispose()
    for (const expected of EXPECTED_TOOLS) {
      expect(names()).not.toContain(expected)
    }
  })

  it('admin page and full API surface: page/stats/list/update/forget/restore/export/loopback write guard', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const port = loaded.webServer.port

    // The standalone admin page was removed (since v0.4.0 the UI lives in a settings tab): /engram is no longer served.
    const page = await call(port, 'GET', '/engram')
    expect(page.status).toBe(404)

    // Stats: parts for both stores; the user store has 2 seed entries.
    const stats = await call(port, 'GET', '/api/engram/stats')
    expect(stats.status).toBe(200)
    const userPart = (stats.json as { parts: { scope: string; stats: { total: number } }[] }).parts
      .find(part => part.scope === 'user')
    expect(userPart?.stats.total).toBe(2)

    // List: seed data visible (the admin view includes all statuses).
    const list = await call(port, 'GET', '/api/engram/list?scope=user&limit=10')
    expect(list.status).toBe(200)
    expect((list.json as { total: number }).total).toBe(2)

    // Tour-route sorting: by slot assignment order (the seed preference was written first, so it comes first on the route).
    const tourList = await call(port, 'GET', '/api/engram/list?scope=user&sort=tour&limit=10')
    expect((tourList.json as { records: { content: string, slot?: { room: string, index: number } }[] }).records
      .map(record => record.content)).toEqual(['Seed preference: reply in Simplified Chinese', 'Seed fact: to be forgotten'])
    // List rows carry slot coordinates (a sense of palace position).
    // '偏好阁' is the persisted room identifier from src/palace/slots.ts -- kept exactly as-is for compatibility.
    expect((tourList.json as { records: { slot?: { room: string } }[] }).records[0]?.slot).toEqual({ room: '偏好阁', index: 1 })

    // Today's recall queue: clues only, no body text (a deliberate design for retrieval practice).
    const due = await call(port, 'GET', '/api/engram/review-due?scope=user')
    expect(due.status).toBe(200)
    const dueItems = (due.json as { items: { id: string, overdueDays: number, slot?: { room: string } }[] }).items
    expect(dueItems).toHaveLength(1)
    expect(dueItems[0]?.overdueDays).toBeGreaterThanOrEqual(1)
    expect(dueItems[0]?.slot).toEqual({ room: '偏好阁', index: 1 })
    expect(due.text).not.toContain('Simplified Chinese')

    // Self-grading advances SM-2: first pass gives a 1-day interval; an illegal grade is rejected.
    const keepId = dueItems[0]!.id
    const answered = await call(port, 'POST', '/api/engram/review-answer', { id: keepId, scope: 'user', grade: 5 })
    expect(answered.status).toBe(200)
    expect((answered.json as { review: { intervalDays: number, reps: number } }).review).toEqual(
      expect.objectContaining({ intervalDays: 1, reps: 1 }),
    )
    expect((await call(port, 'POST', '/api/engram/review-answer', { id: keepId, scope: 'user', grade: 9 })).status).toBe(400)
    // After answering, it no longer appears in today's queue.
    const afterAnswer = await call(port, 'GET', '/api/engram/review-due?scope=user')
    expect((afterAnswer.json as { items: unknown[] }).items).toHaveLength(0)

    // Update: goes through the supersedes chain (old entry archived, new entry active).
    const dropped = (list.json as { records: { id: string; content: string }[] }).records
      .find(record => record.content === 'Seed fact: to be forgotten')
    expect(dropped).toBeDefined()
    const updated = await call(port, 'POST', '/api/engram/update', {
      id: dropped!.id, scope: 'user', content: 'Updated seed fact', importance: 0.7,
    })
    expect(updated.status).toBe(200)
    const afterUpdate = await call(port, 'GET', '/api/engram/list?scope=user&status=archived')
    expect((afterUpdate.json as { total: number }).total).toBe(1)

    // Forget/restore.
    const forgotten = await call(port, 'POST', '/api/engram/forget', {
      id: dropped!.id, scope: 'user',
      reason: 'seed data cleanup', affects: 'none', stillUseful: 'unit test case',
    })
    expect(forgotten.status).toBe(200)
    const restored = await call(port, 'POST', '/api/engram/restore', { id: dropped!.id, scope: 'user' })
    expect((restored.json as { record: { status: string } }).record.status).toBe('active')

    // Audit view: source chain and operation log.
    const review = await call(port, 'GET', `/api/engram/review?scope=user&id=${encodeURIComponent(dropped!.id)}`)
    expect(review.status).toBe(200)
    expect((review.json as { operations: unknown[] }).operations.length).toBeGreaterThan(0)

    // Export: markdown download.
    const exported = await call(port, 'GET', '/api/engram/export?scope=user&format=markdown')
    expect(exported.status).toBe(200)
    expect(exported.contentType).toContain('text/markdown')
    expect(exported.text).toContain('Seed preference')

    // Loopback write guard: a POST with a cross-site Origin is rejected with 403.
    const evil = await call(port, 'POST', '/api/engram/forget',
      { id: dropped!.id, scope: 'user', reason: 'x', affects: 'x', stillUseful: 'x' },
      { origin: 'https://evil.example' })
    expect(evil.status).toBe(403)
  })

  it('episode timeline HTTP path: group headers carry session summaries, around extends to neighbors', { timeout: 60_000 }, async () => {
    let anchorId = ''
    const loaded = await loadComposition([], undefined, async (dbDir) => {
      // Seed episodes from two source sessions plus one session summary, before the host opens the stores.
      const store = await openEngramStore(join(dbDir, 'user.db'))
      anchorId = (await store.write({ scope: 'user', kind: 'episode', content: 'Monday: discussed the summary chain of the memory palace', sourceSessionId: 'sess-1' })).id
      await store.write({ scope: 'user', kind: 'episode', content: 'Monday: finished the group header rendering', sourceSessionId: 'sess-1' })
      await store.write({ scope: 'user', kind: 'episode', content: 'Friday: refactored the timeline query', sourceSessionId: 'sess-2' })
      await store.setSessionSummary('sess-1', 'A session about session summaries')
      await store.close()
    })
    const port = loaded.webServer.port

    // Group mode: grouped by session (newer groups first), sess-1 header carries a summary, sess-2 has none generated so no summary key.
    const timeline = await call(port, 'GET', '/api/engram/episode-timeline?scope=user')
    expect(timeline.status).toBe(200)
    const groups = (timeline.json as {
      groups: { sessionId: string | null; summary?: string; startedAt: number; endedAt: number; episodes: { id: string; kind: string; content: string; createdAt: number }[] }[]
    }).groups
    expect(groups).toHaveLength(2)
    const withSummary = groups.find(group => group.sessionId === 'sess-1')!
    expect(withSummary.summary).toBe('A session about session summaries')
    expect(withSummary.episodes).toHaveLength(2)
    const withoutSummary = groups.find(group => group.sessionId === 'sess-2')!
    expect('summary' in withoutSummary).toBe(false)
    // Rows are slimmed to four fields: kind is passed through as-is (episode).
    expect(withSummary.episodes[0]?.kind).toBe('episode')

    // Neighbor extension: anchored on sess-1's first episode, the other two within the +/-60 minute window are returned in ascending time order.
    const around = await call(port, 'GET', `/api/engram/episode-timeline?scope=user&around=${encodeURIComponent(anchorId)}`)
    expect(around.status).toBe(200)
    const view = (around.json as { around: { anchor: { id: string }; neighbors: { content: string }[] } }).around
    expect(view.anchor.id).toBe(anchorId)
    expect(view.neighbors).toHaveLength(2)
  })

  it('entity lexicon HTTP path: list carries related-memory counts, detail returns entity and related memories, missing id and not-found have explicit status codes', { timeout: 60_000 }, async () => {
    let kenId = ''
    const loaded = await loadComposition([], undefined, async (dbDir) => {
      // Seed one memory with two entities attached (ken resolves without aliases), before the host opens the stores.
      const store = await openEngramStore(join(dbDir, 'user.db'))
      const record = await store.write({ scope: 'user', kind: 'fact', content: 'ken is in charge of developing the dsh-engram plugin' })
      const [ken, project] = await store.resolveEntities([
        { name: 'ken', kind: 'person' },
        { name: 'dsh-engram', kind: 'project', aliases: ['memory plugin'] },
      ])
      await store.linkNodeEntities(record.id, [ken!.id, project!.id])
      kenId = String(ken!.id)
      await store.close()
    })
    const port = loaded.webServer.port

    // List: scope echoed, total count, each row carries the count of related active memories.
    const list = await call(port, 'GET', '/api/engram/entities?scope=user')
    expect(list.status).toBe(200)
    const listJson = list.json as {
      scope: string
      total: number
      items: { entity: { name: string; kind: string; aliases: string[] }; memoryCount: number }[]
    }
    expect(listJson.scope).toBe('user')
    expect(listJson.total).toBe(2)
    const kenItem = listJson.items.find(item => item.entity.name === 'ken')!
    expect(kenItem.entity.kind).toBe('person')
    expect(kenItem.memoryCount).toBe(1)
    const projectItem = listJson.items.find(item => item.entity.name === 'dsh-engram')!
    expect(projectItem.entity.aliases).toEqual(['memory plugin'])

    // Detail: entity record + most recent related memories.
    const detail = await call(port, 'GET', `/api/engram/entity?scope=user&id=${encodeURIComponent(kenId)}`)
    expect(detail.status).toBe(200)
    const detailJson = detail.json as { entity: { name: string; kind: string }; memories: { content: string }[] }
    expect(detailJson.entity.name).toBe('ken')
    expect(detailJson.entity.kind).toBe('person')
    expect(detailJson.memories).toHaveLength(1)
    expect(detailJson.memories[0]!.content).toContain('dsh-engram')

    // Missing id is 400; a nonexistent id is 404.
    const missingId = await call(port, 'GET', '/api/engram/entity?scope=user')
    expect(missingId.status).toBe(400)
    const notFound = await call(port, 'GET', '/api/engram/entity?scope=user&id=no-such-entity')
    expect(notFound.status).toBe(404)
  })

  it('Jev config HTTP path: GET returns only a mask, POST lands an override file effective immediately, any invalid field 400s the whole body', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const port = loaded.webServer.port

    // Initial state: no yml jev block and no override file -> disabled with no key; the view shape is fixed (the plaintext key never appears).
    const initial = await call(port, 'GET', '/api/engram/jev-config')
    expect(initial.status).toBe(200)
    expect(initial.json).toEqual({
      enabled: false,
      baseUrl: 'https://api.typesafe.ai',
      model: 'jev-latest',
      timeoutMs: 3000,
      apiKeySet: false,
      apiKeyMask: null,
      deferMergeAbove: 0.85,
      deferAcceptBelow: 0.15,
      contradictMinProbability: 0.8,
    })

    // Save: panel toggle + key + timeout override; the response view's mask shows the last 4 digits (length > 8).
    const saved = await call(port, 'POST', '/api/engram/jev-config', {
      enabled: true,
      apiKey: 'panel-key-1234567890',
      timeoutMs: 5000,
    })
    expect(saved.status).toBe(200)
    expect(saved.json).toEqual({
      ok: true,
      view: {
        enabled: true,
        baseUrl: 'https://api.typesafe.ai',
        model: 'jev-latest',
        timeoutMs: 5000,
        apiKeySet: true,
        apiKeyMask: '****7890',
        deferMergeAbove: 0.85,
        deferAcceptBelow: 0.15,
        contradictMinProbability: 0.8,
      },
    })

    // GET again: masked view (not plaintext), the override file lands in dbDir with 0600.
    const reread = await call(port, 'GET', '/api/engram/jev-config')
    expect(reread.status).toBe(200)
    expect((reread.json as { apiKeySet: boolean; apiKeyMask: string }).apiKeySet).toBe(true)
    expect(reread.text).not.toContain('panel-key-1234567890')
    expect(root).toBeDefined()
    const overridePath = join(root!, 'engram', 'jev-config.json')
    expect(existsSync(overridePath)).toBe(true)
    expect(statSync(overridePath).mode & 0o777).toBe(0o600)

    // Any invalid field 400s the whole body: even the valid fields are not written to disk.
    const bad = await call(port, 'POST', '/api/engram/jev-config', { model: 'good', timeoutMs: 1 })
    expect(bad.status).toBe(400)
    // The host exposes the English timeout validation error without accepting partial updates.
    expect((bad.json as { error: string }).error).toBe('invalid: jev.timeoutMs must be an integer in 1000-60000 ms')
    expect(await readFile(overridePath, 'utf8')).toContain('"timeoutMs": 5000')
  })

  it('Jev connection test and verdict observation HTTP path: external failures return structured, empty-buffer observations are an array', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const port = loaded.webServer.port

    // The default baseUrl points to the external network -> the fetch double rejects deterministically; testJevConnection does not throw, the failure reason goes into the error field.
    const offline = await call(port, 'POST', '/api/engram/jev-test', {})
    expect(offline.status).toBe(200)
    const offlineBody = offline.json as { ok: boolean; elapsedMs: number; probability: number | undefined; error: string }
    expect(offlineBody.ok).toBe(false)
    expect(offlineBody.error).toContain('offline in test')
    expect(offlineBody.probability).toBeUndefined()
    expect(offlineBody.elapsedMs).toBeTypeOf('number')

    // Override baseUrl to a loopback address -> passes through to real fetch, a refused connection is also returned structured (no override file is written).
    const refused = await call(port, 'POST', '/api/engram/jev-test', { baseUrl: 'http://127.0.0.1:1', model: 'jev-latest' })
    expect(refused.status).toBe(200)
    expect((refused.json as { ok: boolean }).ok).toBe(false)

    // No verdict has occurred in this process -> the observation endpoint returns an empty sequence (newest first).
    const observations = await call(port, 'GET', '/api/engram/jev-observations')
    expect(observations.status).toBe(200)
    expect(observations.json).toEqual({ items: [] })
  })

  it('会话 dispose 且事件源不可用时，摄取不产生未处理 rejection', { timeout: 60_000 }, async () => {
    // 回归：disposed 观察器是 fire-and-forget，逃逸的 rejection 会被宿主 fail-loud 当致命错误
    // 直接退出进程（社区 issue #1：turnStarts 读 undefined.length）。
    const loaded = await loadComposition(["    ingest: 'light'"])
    // 模拟 dispose 后事件源已 detach：snapshotEvents 给不出日志。
    const fakeSession = { id: 'sess-disposed', snapshotEvents: () => undefined }
    loaded.emit('session/disposed', fakeSession as never)
    // 给 fire-and-forget 摄取一个跑完的窗口；若产生未处理 rejection，vitest 会判定本用例失败。
    await new Promise(resolve => setTimeout(resolve, 300))
  })

  it('历史回填 HTTP 链路：估算 → 启动 → 轮询到结束（LLM 失败只计数不中断）', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition(["    ingest: 'light'"])
    const port = loaded.webServer.port
    // 会话持久化替身：一个可回填会话（一轮，活动信号充足以越过节流）。
    const pad = '这是一段足够长的具体描述，用来越过节流阈值。'.repeat(12)
    const events = [
      { type: 'turn/start', data: { turn: 1 }, seq: 1, time: Date.now() },
      { type: 'user/message', data: { content: [{ type: 'text', text: pad }] }, seq: 2, time: Date.now() },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '答' }] }, seq: 3, time: Date.now() },
      // 路由必须能从日志解析（插件未配 provider/model），否则摄取会在路由检查处跳过。
      { type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } } }, seq: 4, time: Date.now() },
      ...[0, 1, 2, 3, 4].map(index => ({ type: 'tool/result', data: { callId: `c${String(index)}`, isError: false }, seq: 5 + index, time: Date.now() })),
    ]
    loaded.provide('sessionPersistence' as never, makePersistenceDouble(
      { id: 'hist-1', createdAt: Date.now() - 1000, cwd: process.cwd() }, events,
    ) as never)

    // 模型清单接口：面板「辅助模型」下拉的数据源。
    const modelsResponse = await call(port, 'GET', '/api/engram/models')
    expect(modelsResponse.status).toBe(200)
    const modelsBody = modelsResponse.json as { providers: { id: string; models: { id: string }[] }[] }
    expect(modelsBody.providers[0]?.id).toBe('deepseek')
    expect(modelsBody.providers[0]?.models[0]?.id).toBe('deepseek-v4')

    // 估算：不写库、不调 LLM。
    const estimate = await call(port, 'GET', '/api/engram/history-backfill?days=7&maxTotalTurns=5')
    expect(estimate.status).toBe(200)
    const estimateBody = estimate.json as { estimate: { candidates: number; pendingTurns: number, unavailable?: string } }
    expect(estimateBody.estimate.unavailable).toBeUndefined()
    expect(estimateBody.estimate.candidates).toBe(1)
    expect(estimateBody.estimate.pendingTurns).toBeGreaterThan(0)

    // 未挂载持久化服务时不可用的说明路径：这里已提供替身，应能启动。
    const started = await call(port, 'POST', '/api/engram/history-backfill/start',
      { days: 7, maxTotalTurns: 5, maxTurnsPerSession: 1 })
    expect(started.status).toBe(200)

    // 轮询到结束（期间 LLM 替身抛错 → 该轮记失败，整批不中断）。
    let status = await call(port, 'GET', '/api/engram/history-backfill/status')
    for (let attempt = 0; attempt < 40 && (status.json as { progress: { state: string } }).progress.state === 'running'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
      status = await call(port, 'GET', '/api/engram/history-backfill/status')
    }
    const finalBody = status.json as {
      progress: { state: string; turnsDone: number; turnsFailed: number }
      failures: { reason: string }[]
    }
    expect(finalBody.progress.state).toBe('done')
    expect(finalBody.progress.turnsDone).toBeGreaterThan(0)
    // LLM 替身离线：该轮必须被记成失败而不是静默吞掉或整批中断。
    expect(finalBody.progress.turnsFailed).toBeGreaterThan(0)
    expect(finalBody.failures[0]?.reason).toContain('llm offline in test')
  })

  it('历史回填优先复用当前会话在用的路由（而不是历史日志里的旧模型）', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition(["    ingest: 'light'"])
    const port = loaded.webServer.port
    // 历史会话日志里记录的是旧模型 zai/glm-4.5-air（当前环境没有该 provider 配置）。
    const pad = '这是一段足够长的具体描述，用来越过节流阈值。'.repeat(12)
    const historicalEvents = [
      { type: 'request/header', data: { header: { config: { provider: 'zai', model: 'glm-4.5-air' } } }, seq: 1, time: Date.now() },
      { type: 'turn/start', data: { turn: 1 }, seq: 2, time: Date.now() },
      { type: 'user/message', data: { content: [{ type: 'text', text: pad }] }, seq: 3, time: Date.now() },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '答' }] }, seq: 4, time: Date.now() },
      ...[0, 1, 2, 3, 4].map(index => ({ type: 'tool/result', data: { callId: `c${String(index)}`, isError: false }, seq: 5 + index, time: Date.now() })),
    ]
    loaded.provide('sessionPersistence' as never, makePersistenceDouble(
      { id: 'hist-old-model', createdAt: Date.now() - 1000, cwd: process.cwd() }, historicalEvents,
    ) as never)
    // 模拟「当前会话在用 deepseek」：preStep 每轮第一步记录该路由。
    const fakeAgent = {
      id: 'sess-current',
      session: {
        id: 'sess-current',
        header: { cwd: process.cwd() },
        snapshotEvents: () => [{ type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4' } } }, seq: 1, time: Date.now() }],
      },
    }
    // emit 的重载签名较窄，这里用最小可调用视图派发事件；决策按真实契约返回 enter + messages
    // （空批即可，本用例只关心路由记录），并 await 让 preStep 的失败直接暴露为测试失败。
    const emitter = loaded as unknown as { emit: (name: string, ...args: unknown[]) => unknown }
    await (emitter.emit('agent/pre-step', {
      agent: fakeAgent, step: 1, turn: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] })) as Promise<unknown>)
    await new Promise(resolve => setTimeout(resolve, 50))
    llmCalls.length = 0

    const estimate = await call(port, 'GET', '/api/engram/history-backfill?days=7&maxTurnsPerSession=1&maxTotalTurns=1')
    expect((estimate.json as { estimate: { candidates: number } }).estimate.candidates).toBe(1)
    const started = await call(port, 'POST', '/api/engram/history-backfill/start', { days: 7, maxTurnsPerSession: 1, maxTotalTurns: 1 })
    expect(started.status).toBe(200)
    let status = await call(port, 'GET', '/api/engram/history-backfill/status')
    for (let attempt = 0; attempt < 40 && (status.json as { progress: { state: string } }).progress.state === 'running'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
      status = await call(port, 'GET', '/api/engram/history-backfill/status')
    }
    // 辅助调用必须走当前在用的 deepseek，而不是历史日志里的 zai（否则会因 provider 无该模型而失败）。
    expect(llmCalls.length).toBeGreaterThan(0)
    expect(JSON.stringify(llmCalls)).toContain('deepseek')
    expect(JSON.stringify(llmCalls)).not.toContain('zai')
  })

  it('跨会话 pending 重放经持久化只读句柄读日志（load(id) 已移除）', { timeout: 60_000 }, async () => {
    // 回归：新版 dsh 的 sessionPersistence 只有句柄式 open(id,'read')+read()，已无 load(id)。
    // 适配层若还调 load，跨会话 pending 会被 catch 吞掉 TypeError 而永远保留（静默失效）。
    const loaded = await loadComposition(["    ingest: 'light'"], { sessionId: 'sess-foreign', turn: 1 })
    const pad = '这是一段足够长的具体描述，用来越过节流阈值。'.repeat(12)
    const events = [
      { type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'deepseek-v4' } } }, seq: 1, time: Date.now() },
      { type: 'turn/start', data: { turn: 1 }, seq: 2, time: Date.now() },
      { type: 'user/message', data: { content: [{ type: 'text', text: pad }] }, seq: 3, time: Date.now() },
      { type: 'assistant/message', data: { content: [{ type: 'text', text: '答' }] }, seq: 4, time: Date.now() },
    ]
    const calls: { id: string; access: string; reads: number; closed: boolean }[] = []
    loaded.provide('sessionPersistence' as never, makePersistenceDouble(
      { id: 'sess-foreign', createdAt: Date.now() - 1000, cwd: process.cwd() }, events, calls,
    ) as never)

    // 当前会话 id 与 pending 会话不同：preStep 第一步触发 pending 重放（fire-and-forget）。
    const fakeAgent = { id: 'sess-current', session: { id: 'sess-current', header: { cwd: process.cwd() }, snapshotEvents: () => [] } }
    const emitter = loaded as unknown as { emit: (name: string, ...args: unknown[]) => unknown }
    await (emitter.emit('agent/pre-step', {
      agent: fakeAgent, step: 1, turn: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter', messages: [] })) as Promise<unknown>)
    // 给异步重放（打开句柄 → 读日志 → 关闭）一个跑完的窗口。
    await new Promise(resolve => setTimeout(resolve, 600))

    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]?.id).toBe('sess-foreign')
    expect(calls[0]?.access).toBe('read')
    expect(calls[0]?.reads).toBeGreaterThan(0)
    // 只读句柄必须释放：否则每次重放都在后端漏一个句柄。
    expect(calls[0]?.closed).toBe(true)
  })

  it('项目宫殿随工作区切换：/workspaces 列出工作区，?project= 落到对应分库', { timeout: 60_000 }, async () => {
    const loaded = await loadComposition()
    const port = loaded.webServer.port
    // 造一个真实存在的「工作区」目录（无 git → cwd 全量哈希命名）。
    const workspacePath = await mkdtemp(join(tmpdir(), 'engram-ws-'))
    loaded.provide('workspaceRegistry' as never, {
      list: () => [{ id: 'ws-1', path: workspacePath, title: '测试工作区' }],
    } as never)
    const dbName = workspaceProjectDbName('ws-1')
    // 预置该项目宫殿里的一条记忆（先写后关，避免与插件连接并存）。
    const seeded = await openEngramStore(join(root!, 'engram', dbName))
    await seeded.write({ scope: 'project', kind: 'decision', content: '该工作区的项目约定', importance: 0.6 })
    await seeded.close()

    const workspaces = await call(port, 'GET', '/api/engram/workspaces')
    expect(workspaces.status).toBe(200)
    const items = (workspaces.json as {
      items: { dbName: string; title: string; path: string | null; kind: string; exists: boolean; memories: number | null }[]
      processDefault: { dbName: string } | null
    }).items
    const hit = items.find(item => item.dbName === dbName)
    expect(hit).toMatchObject({ title: '测试工作区', kind: 'workspace', exists: true, memories: 1 })
    expect(hit?.path).toBe(workspacePath)
    expect(items.some(item => item.kind === 'process')).toBe(true)

    // 显式选择该工作区：项目 scope 读到的正是它的库。
    const scoped = await call(port, 'GET', `/api/engram/list?scope=project&project=${dbName}&limit=10`)
    expect(scoped.status).toBe(200)
    expect((scoped.json as { records: { content: string }[] }).records.map(record => record.content))
      .toContain('该工作区的项目约定')

    // 未知选择器 → 404（面板据此回退「跟随当前工作区」）。
    const unknown = await call(port, 'GET', '/api/engram/list?scope=project&project=project-000000000000000000000000.db')
    expect(unknown.status).toBe(404)
    expect((unknown.json as { error: string }).error).toBe('unknown project')

    // 不带选择器 = 进程目录兜底（向后兼容），照常 200。
    expect((await call(port, 'GET', '/api/engram/list?scope=project&limit=5')).status).toBe(200)
  })

  it('未知配置键经 Loader 装载 loud 失败', { timeout: 60_000 }, async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-engram-bad-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-host-webserver'",
      '  config:',
      "    host: '127.0.0.1'",
      '    port: 0',
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: 'virtual:engram-llm'",
      "- name: '@kenz1117/dsh-engram'",
      '  config:',
      '    noSuchField: 1',
      '',
    ].join('\n'))
    const bad = new Context()
    bad.baseUrl = pathToFileURL(root).href + '/'
    await bad.plugin(Loader)
    bad.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-host-webserver', HttpServer],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['virtual:engram-llm', llmDouble],
      ['@kenz1117/dsh-engram', Engram],
    ])
    bad.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof bad.loader.internal>
    // 新 cordis 下插件 apply 抛错不再从 loader.create 传播，而是记入该插件
    // fiber 并使其进入 FAILED（不静默激活）。等装载链结束后经 fiber.await()
    // 重抛启动错误，loud 失败语义保持不变。
    await bad.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await bad.loader.await()
    const badEntry = [...bad.loader.entries()].find(entry => entry.options.name === '@kenz1117/dsh-engram')
    expect(badEntry).toBeDefined()
    await expect(badEntry!.fiber!.await()).rejects.toThrow(/unknown config key/)
  })
})


describe('migration policy through the real Loader and session tools', () => {
  for (const phase of ['boot', 'session'] as const) {
    for (const policy of ['eager', 'conservative'] as const) {
      it(`${phase}: ${policy} is applied before project-store access`, async () => {
        const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
        let cwd = process.cwd()
        let before: Buffer | undefined
        const seed = async (dbDir: string) => {
          const identity = resolveProjectIdentity(cwd)
          const path = join(dbDir, identity.legacyDbName)
          const store = await openEngramStore(path)
          await store.write({ scope: 'project', kind: 'fact', content: 'synthetic legacy memory', importance: 0.5 })
          await store.close()
          before = await readFile(path)
        }
        const loaded = await loadComposition(
          [`    legacyMigration: '${policy}'`, '    injectProfile: false', '    queryRewrite: false'],
          undefined,
          phase === 'boot' ? seed : undefined,
        )
        if (phase === 'session') {
          cwd = join(root!, 'workspace-a')
          await mkdir(cwd)
          loaded.provide('workspaceRegistry' as never, {
            list: () => [{ id: 'migration-ws', path: cwd, title: 'Migration fixture' }],
          } as never)
          await seed(join(root!, 'engram'))
        }
        if (phase === 'session') {
          const result = await loaded.tools.execute({
            name: 'engram_stats', arguments: { scope: 'project' },
            agent: { id: 'migration-agent', session: { id: 'migration-session', header: { cwd } } } as never,
            callId: 'migration-stats' as never, signal: new AbortController().signal,
          })
          expect(result.isError).not.toBe(true)
        }
        const identity = resolveProjectIdentity(cwd)
        const dbDir = join(root!, 'engram')
        const workspaceDbName = workspaceProjectDbName('migration-ws')
        const query = phase === 'boot' ? '' : `&project=${workspaceDbName}`
        const response = await call(loaded.webServer.port, 'GET', `/api/engram/list?scope=project${query}`)
        expect(response.status).toBe(200)
        const contents = (response.json as { records: { content: string }[] }).records.map(record => record.content)
        const logged = warnings.mock.calls.flat().join('\n')
        if (phase === 'session') {
          // A registered workspace owns a new stable-ID store. Legacy origin/cwd
          // stores remain untouched for explicit reviewed reassignment.
          expect(contents).toEqual([])
          expect(existsSync(join(dbDir, workspaceDbName))).toBe(true)
          expect(await readFile(join(dbDir, identity.legacyDbName))).toEqual(before)
          expect(readMigrationPointer(dbDir, identity)).toBeUndefined()
          return
        }

        expect(logged).toContain(identity.legacyDbName)
        expect(logged).toContain(identity.dbName)
        if (policy === 'eager') {
          expect(contents).toContain('synthetic legacy memory')
          expect(readMigrationPointer(dbDir, identity)?.claimedByCwd).toBe(cwd)
          expect(existsSync(join(dbDir, identity.legacyDbName))).toBe(false)
        } else {
          expect(contents).toEqual([])
          expect(existsSync(join(dbDir, identity.dbName))).toBe(true)
          expect(await readFile(join(dbDir, identity.legacyDbName))).toEqual(before)
          expect(readMigrationPointer(dbDir, identity)).toBeUndefined()
          expect(logged).toContain('do not overwrite it directly')
        }
      })
    }
  }
})


it('unload drains delayed startup consolidation before finalizing SQLite', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered: () => void = () => {}
  const started = new Promise<void>(resolve => { entered = resolve })
  let closed = false
  let readsAfterClose = 0
  const original = StoreModule.openEngramStore
  vi.spyOn(StoreModule, 'openEngramStore').mockImplementation(async (...args) => {
    const store = await original(...args)
    const stats = store.stats.bind(store)
    const close = store.close.bind(store)
    store.stats = async () => {
      entered()
      await gate
      if (closed) readsAfterClose += 1
      return stats()
    }
    store.close = async () => { closed = true; await close() }
    return store
  })
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const loaded = await loadComposition()
  await started
  closed = false // the fixture seed store closed before plugin startup
  const disposal = loaded.fiber.dispose()
  await new Promise(resolve => setTimeout(resolve, 25))
  const prematurelyClosed = closed
  release()
  await disposal
  expect(prematurelyClosed).toBe(false)
  expect(closed).toBe(true)
  expect(readsAfterClose).toBe(0)
  expect(warnings.mock.calls.flat().join(' ')).not.toMatch(/statement.*finalized|Consolidation failed/)
})


it.each(['reflection', 'ingestion'] as const)('unload drains active session-end %s before finalizing SQLite', async (job) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  let entered: () => void = () => {}
  const started = new Promise<void>(resolve => { entered = resolve })
  let closed = false
  let readsAfterClose = 0
  let cancelled = false
  const originalOpen = StoreModule.openEngramStore
  vi.spyOn(StoreModule, 'openEngramStore').mockImplementation(async (...args) => {
    const store = await originalOpen(...args)
    for (const key of Object.keys(store) as (keyof typeof store)[]) {
      const method = store[key]
      if (typeof method !== 'function') continue
      Object.assign(store, { [key]: (...params: unknown[]) => {
        if (key === 'close') closed = true
        else if (closed) readsAfterClose += 1
        return (method as (...params: unknown[]) => unknown)(...params)
      } })
    }
    return store
  })
  if (job === 'reflection') {
    const original = ReflectModule.reflectObservations
    vi.spyOn(ReflectModule, 'reflectObservations').mockImplementation(async deps => {
      const topActive = deps.store.topActive.bind(deps.store)
      const delayedStore = Object.create(deps.store) as typeof deps.store
      delayedStore.topActive = async (...args) => {
        entered()
        await gate
        cancelled = deps.signal.aborted
        return topActive(...args)
      }
      return original({ ...deps, store: delayedStore })
    })
  } else {
    const original = IngestModule.ingestFinalTurn
    vi.spyOn(IngestModule, 'ingestFinalTurn').mockImplementation(async deps => {
      entered()
      await gate
      cancelled = deps.signal?.aborted ?? false
      return original(deps)
    })
  }
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const loaded = await loadComposition([
    "    ingest: 'light'", "    reflect: 'auto'",
    "    provider: 'deepseek'", "    model: 'deepseek-v4'",
  ])
  closed = false
  readsAfterClose = 0 // exclude fixture setup before the plugin was loaded
  loaded.emit('session/disposed', { id: 'active-session', snapshotEvents: () => [] } as never)
  await started
  const entry = [...loaded.loader.entries()].find(candidate => candidate.options.name === '@kenz1117/dsh-engram')
  const disposal = entry!.fiber!.dispose()
  await new Promise(resolve => setTimeout(resolve, 25))
  const prematurelyClosed = closed
  release()
  await disposal
  expect(prematurelyClosed).toBe(false)
  expect(cancelled).toBe(true)
  expect(closed).toBe(true)
  expect(readsAfterClose).toBe(0)
  expect(warnings.mock.calls.flat().join(' ')).not.toMatch(/statement.*finalized|session-end .*exception/)
})
