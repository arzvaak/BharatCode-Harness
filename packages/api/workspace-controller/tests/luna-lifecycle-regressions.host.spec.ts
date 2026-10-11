import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ArtifactRevisionId, WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { expect, it, vi } from 'vitest'
import { executeCapturedNotebook } from '../src/notebook-runner.ts'
import { ProjectKnowledgeController } from '../src/knowledge.ts'

vi.mock('../src/notebook-runner.ts', () => ({ executeCapturedNotebook: vi.fn() }))

function gate<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function statusOf(state: string): string {
  const parsed: unknown = JSON.parse(state)
  if (parsed === null || typeof parsed !== 'object' || !('status' in parsed) || typeof parsed.status !== 'string')
    throw new Error('Invalid app call journal state')
  return parsed.status
}

it('cancels a notebook when its delayed output capture finishes before journal commit', async () => {
  vi.mocked(executeCapturedNotebook).mockResolvedValue({
    notebook: '{}',
    environment: 'test environment',
    status: 'completed',
    detail: '',
  })
  const projectId = 'project' as WorkspaceId
  const sessionId = 'session' as SessionId
  const notebookId = 'notebook' as ArtifactRevisionId
  const project = {
    id: projectId,
    path: '/project',
    sessionIds: [sessionId],
  }
  const record = {
    id: 'analysis-1',
    projectId,
    title: 'Analysis',
    revision: 'prepared',
    updatedAt: 'now',
    payload: {
      kind: 'analysis' as const,
      notebook: notebookId,
      inputs: [],
      code: '{}',
      kernel: 'python',
      environment: 'test',
      parameters: {},
      outputs: [],
      status: 'prepared' as const,
      detail: '',
    },
  }
  const captureEntered = gate()
  const releaseCapture = gate()
  const saves: Array<{ payload: typeof record.payload; revision: string }> = []
  let producer: { done: Promise<{ status: string }>; cancel: () => void } | undefined
  const ctx = new Context()
  ctx.provide(
    'workspaceRegistry',
    { get: (id: WorkspaceId) => (id === projectId ? project : undefined) } as never,
  )
  ctx.provide('projectKnowledge', {
    workflowRecords: () => [record],
    read: (id: ArtifactRevisionId) => ({
      id,
      projectId,
      path: 'notebook.ipynb',
      title: 'Notebook',
      text: '{}',
      kind: 'note',
      revision: 'r',
      capturedAt: 'now',
    }),
    saveWorkflowRecord: async (request: { payload: typeof record.payload }) => {
      const value = { payload: request.payload, revision: `r${saves.length + 1}` }
      saves.push(value)
      return { ...record, ...value }
    },
    captureAnalysisOutput: async () => {
      captureEntered.resolve()
      await releaseCapture.promise
      return { id: 'output' as ArtifactRevisionId, title: 'Executed output' }
    },
  } as never)
  ctx.provide('jobs', {
    start: ({ run }: { run: (job: { id: string; updateProgress: () => void; append: () => void }) => typeof producer }) => {
      producer = run({
        id: 'job-1',
        updateProgress: () => {},
        append: () => {},
      })
      return 'job-1'
    },
  } as never)
  const controller = new ProjectKnowledgeController(ctx)

  await expect(controller.executeNotebook(projectId, record.id, sessionId)).resolves.toBe('job-1')
  await captureEntered.promise
  producer!.cancel()
  releaseCapture.resolve()
  await expect(producer!.done).resolves.toMatchObject({ status: 'killed' })

  expect(saves.map(value => value.payload.status)).toEqual(['running', 'running', 'cancelled'])
  expect(saves.at(-1)?.payload.outputs).toEqual(['output'])
  expect(saves.at(-1)?.payload.detail).toContain('Captured output retained')
  await ctx.fiber.dispose()
})

it.each([
  { change: 'connection generation' },
  { change: 'app permissions' },
  { change: 'resource URI' },
])('rejects an MCP app call if $change changes during intent persistence', async ({ change }) => {
  const projectId = 'project' as WorkspaceId
  const sessionId = 'session' as SessionId
  const persistEntered = gate()
  const releasePersist = gate()
  let generation = 'generation-1'
  let resourceUri = 'ui://host'
  let allowedTools = ['do_work']
  let applicationReads = 0
  const saves: Array<{ payload: { state: string } }> = []
  const execute = vi.fn(async () => ({ isError: false, value: { ok: true }, content: [] }))
  const ctx = new Context()
  ctx.provide(
    'workspaceRegistry',
    { list: () => [{ id: projectId, sessionIds: [sessionId] }] } as never,
  )
  ctx.provide('agents', { get: () => ({ id: sessionId }) } as never)
  ctx.provide('mcpResources', {
    applications: async () => {
      applicationReads += 1
      return [
        {
          server: 'server',
          tool: 'host',
          generation,
          title: 'Host',
          resourceUri,
          allowedTools,
        },
      ]
    },
  } as never)
  ctx.provide('tools', { execute } as never)
  ctx.provide('projectKnowledge', {
    saveWorkflowRecord: async (request: {
      id: string
      projectId: WorkspaceId
      title: string
      payload: { state: string }
    }) => {
      if (saves.length === 0) {
        persistEntered.resolve()
        await releasePersist.promise
      }
      saves.push({ payload: request.payload })
      return { ...request, revision: `r${saves.length}`, updatedAt: 'now' }
    },
  } as never)
  const controller = new ProjectKnowledgeController(ctx)
  const pending = controller.applicationCall(
    sessionId,
    'server',
    'host',
    'generation-1',
    'do_work',
    '{}',
    new AbortController().signal,
  )
  await persistEntered.promise
  if (change === 'connection generation') generation = 'generation-2'
  if (change === 'app permissions') allowedTools = []
  if (change === 'resource URI') resourceUri = 'ui://replacement'
  releasePersist.resolve()

  await expect(pending).rejects.toThrow('MCP app connection or permissions changed')
  expect(applicationReads).toBe(2)
  expect(execute).not.toHaveBeenCalled()
  expect(saves.map(value => statusOf(value.payload.state))).toEqual(['pending', 'failed'])
  await ctx.fiber.dispose()
})
