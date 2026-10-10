import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionCreateRequest, SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry, { ProjectKnowledge } from '@deepseek-ai/dsh-workspace'
import { SessionObservationReader } from '../../../session-query/session-query/src/observation.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { ProjectKnowledgeController } from '../src/knowledge.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

it('queues a handoff once, flushes before acknowledgement, and retries a failed admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bharatcode-handoff-'))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  ctx.provide('sessionPersistence', { list: async () => [] } as never)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(ProjectKnowledge)
  const project = await ctx.workspaceRegistry.create(root)
  const reader = new SessionObservationReader(ctx)
  ctx.provide('sessionQuery', { observeSession: reader.read.bind(reader) } as never)
  const admitted = new Set<string>()
  const prompt = vi.fn(async (request: SessionPromptRequest) => {
    if (!admitted.has(request.requestId))
      ctx.sessions.get(request.sessionId)?.append('agent/inbox/spliced', {
        target: 'next-turn',
        start: 0,
        inserted: [
          createUserMessage({
            content: request.content.map((part) => {
              if (part.type !== 'text') throw new Error('text-only fixture')
              return part
            }),
            source: { kind: 'user', rpcId: request.requestId },
          }),
        ],
      })
    admitted.add(request.requestId)
    return { accepted: true }
  })
  const create = vi.fn(async (request: SessionCreateRequest) => {
    if (request.sessionId === undefined) throw new Error('fixture requires a stable session id')
    if (ctx.sessions.get(request.sessionId) === undefined)
      ctx.sessions.create(request.sessionId, { meta: { cwd: root } })
    return { sessionId: request.sessionId }
  })
  ctx.provide('sessionController', { create, prompt } as never)
  ctx.provide('agents', { get: () => undefined } as never)
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  let failFlush = true
  ctx.on('session/flush', async () => {
    if (failFlush) throw new Error('disk unavailable')
  })
  const controller = new ProjectKnowledgeController(ctx)
  const handoff = await controller.prepareHandoff({
    requestId: 'implement',
    sourceProjectId: project.id,
    destinationProjectId: project.id,
    workflow: 'coding',
    objective: 'Implement the finding',
    revisionIds: [],
    constraints: [],
    questions: [],
  })
  const request = { id: handoff.id, mode: 'queue' as const }
  const signal = new AbortController().signal
  await expect(controller.submitHandoff(request, signal)).rejects.toThrow('disk unavailable')
  expect(ctx.projectKnowledge.handoff(handoff.id).status).toBe('prepared')
  expect(await controller.usingContext(handoff.destinationSessionId)).toEqual([])
  failFlush = false
  await Promise.all([controller.submitHandoff(request, signal), controller.submitHandoff(request, signal)])
  expect(admitted.size).toBe(1)
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ mode: 'queue', requestId: handoff.id }), signal)
  const observation = await reader.read(handoff.destinationSessionId, { projectionMode: 'none' })
  try {
    expect(observation.events.filter(event => event.type === 'project/handoff')).toHaveLength(1)
    expect(observation.events.filter(event => event.type === 'workflow/assignment')).toHaveLength(1)
  } finally {
    observation[Symbol.dispose]()
  }
  expect(ctx.projectKnowledge.handoff(handoff.id).status).toBe('submitted')
  expect(await controller.usingContext(handoff.destinationSessionId)).toHaveLength(1)
  const calls = prompt.mock.calls.length
  await controller.submitHandoff(request, signal)
  expect(prompt).toHaveBeenCalledTimes(calls)
})

it('replays a queued research-to-code task through production session persistence and inbox without duplicating its prompt', async () => {
  const { writeFile } = await import('node:fs/promises')
  const { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } = await import(
    '@deepseek-ai/dsh-agent-loop-testkit',
  )
  const { default: JsonlPersistence } = await import('@deepseek-ai/dsh-session-persistence-jsonl')
  const { createSessionTestController } = await import('../../session-controller/tests/test-remote.ts')
  const { MockAdapter, textResponse } = await import('../../../core/agent-loop/tests/mock-adapter.ts')
  const { MemoryMediaPool } = await import('../../../storage/storage-domain/tests/helpers/memory-backend.ts')
  const root = await mkdtemp(join(tmpdir(), 'bharatcode-handoff-restart-'))
  const pool = new MemoryMediaPool()
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const mount = async (hang: boolean) => {
    const ctx = new Context()
    cleanups.unshift(async () => {
      await ctx.fiber.dispose()
    })
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlPersistence, { root: join(root, '.host-sessions'), compression: 'none' })
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
    await ctx.plugin(WorkspaceRegistry)
    await ctx.plugin(ProjectKnowledge)
    await mountAgentLoopTestHarness(ctx)
    const adapter = new MockAdapter(
      hang ? [{ hangAfter: [] }] : [textResponse('Implemented with the research evidence.')],
    )
    ctx.llm.registerAdapter(['mock'], adapter)
    const sessions = createSessionTestController(ctx, {
      cwd: root,
      defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }),
    })
    return { ctx, adapter, sessions, knowledge: new ProjectKnowledgeController(ctx) }
  }
  const first = await mount(true)
  const project = await first.ctx.workspaceRegistry.create(root)
  const source = await first.sessions.create({ workspaceId: project.id })
  const destination = await first.sessions.create({ workspaceId: project.id })
  await first.knowledge.assignWorkflow({ sessionId: source.sessionId, workflow: 'research' })
  await first.knowledge.assignWorkflow({ sessionId: destination.sessionId, workflow: 'coding' })
  const signal = new AbortController().signal
  await first.sessions.prompt(
    {
      requestId: 'active-task' as never,
      sessionId: destination.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Current task' }],
    },
    signal,
  )
  await vi.waitFor(() => {
    expect(first.adapter.requests).toHaveLength(1)
  })
  await writeFile(join(root, 'finding.md'), 'Supported finding: compare file versions before saving.')
  const revision = await first.knowledge.register({ projectId: project.id, path: 'finding.md', kind: 'finding' })
  const prepared = await first.knowledge.prepareHandoff({
    requestId: 'research-code-restart',
    sourceProjectId: project.id,
    destinationProjectId: project.id,
    sourceSessionId: source.sessionId,
    destinationSessionId: destination.sessionId,
    workflow: 'coding',
    objective: 'Implement version checks.',
    revisionIds: [revision.id],
    constraints: ['Preserve drafts.'],
    questions: [],
  })
  await first.knowledge.submitHandoff({ id: prepared.id, mode: 'queue' }, signal)
  expect(first.ctx.agents.get(destination.sessionId)?.inbox.nextTurn).toHaveLength(1)
  await writeFile(join(root, 'finding.md'), 'Changed after the task was queued.')
  await first.ctx.fiber.dispose()
  const reopened = await mount(false)
  const retry = await reopened.knowledge.submitHandoff({ id: prepared.id, mode: 'queue' }, signal)
  expect(retry.context.evidence[0]?.text).toContain('compare file versions')
  await reopened.sessions.create({ workspaceId: project.id, sessionId: destination.sessionId })
  await vi.waitFor(() => {
    expect(reopened.adapter.requests).toHaveLength(1)
  })
  await reopened.sessions.prompt(
    {
      requestId: prepared.id as never,
      sessionId: destination.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: reopened.ctx.projectKnowledge.renderHandoff(prepared.id) }],
    },
    signal,
  )
  using observation = await reopened.ctx.sessionQuery.observeSession(destination.sessionId, { projectionMode: 'none' })
  expect(
    observation.events.filter(
      event =>
        event.type === 'user/message' &&
        event.data.source.kind === 'user' &&
        'rpcId' in event.data.source &&
        String(event.data.source.rpcId) === String(prepared.id),
    ),
  ).toHaveLength(1)
  expect(await reopened.knowledge.workflow(destination.sessionId)).toBe('coding')
  expect(await reopened.knowledge.inspect(revision.id)).toMatchObject({ status: 'stale' })
}, 30_000)
