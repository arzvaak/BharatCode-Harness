/** Typed, revision-checked project workflow records in a separate private domain. */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { defineDomain, domainTable, type DomainFacility, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ArtifactRevisionId, WorkspaceId } from './types.ts'
const artifactId = z.string().transform(value => value as ArtifactRevisionId)
const writing = z.object({
  kind: z.literal('writing'),
  specialization: z.enum(['general', 'novel', 'drama', 'game', 'recap']),
  brief: z.string(),
  style: z.string(),
  outline: z.array(z.string()),
  canon: z.array(z.string()),
  tentative: z.array(z.string()),
  characters: z.array(z.string()),
  chronology: z.array(z.string()),
  scenes: z.array(z.object({ title: z.string(), objective: z.string() })),
  sourceIds: z.array(artifactId),
})
const analysis = z.object({
  kind: z.literal('analysis'),
  notebook: artifactId,
  inputs: z.array(artifactId),
  code: z.string(),
  kernel: z.string().min(1),
  environment: z.string().min(1),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  outputs: z.array(artifactId),
  status: z.enum(['prepared', 'running', 'completed', 'cancelled', 'failed']),
  detail: z.string(),
  jobId: z.string().optional(),
})
const verification = z.object({
  kind: z.literal('verification'),
  change: artifactId,
  commit: z.string().min(1),
  browserSession: z.string().min(1),
  method: z.enum(['playwright', 'devtools', 'manual', 'test']),
  status: z.enum(['passed', 'failed', 'cancelled']),
  evidence: z.array(artifactId).min(1),
  detail: z.string(),
})
const comment = z.object({
  kind: z.literal('comment'),
  artifact: artifactId,
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string(),
  comment: z.string().min(1),
  resolved: z.boolean(),
})
const qualification = z.object({
  kind: z.literal('qualification'),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  platform: z.enum(['linux', 'win32', 'darwin']),
  checks: z.array(
    z.object({
      name: z.enum(['static', 'packed-install', 'lifecycle', 'workflow']),
      status: z.enum(['passed', 'failed']),
      evidence: z.array(artifactId).min(1),
    }),
  ),
})
const app = z.object({
  kind: z.literal('app'),
  server: z.string().min(1),
  tool: z.string().min(1),
  resourceUri: z.string().startsWith('ui://'),
  sessionId: z.string().min(1),
  state: z
    .string()
    .max(256 * 1024)
    .refine((value) => {
      try {
        JSON.parse(value)
        return true
      } catch {
        return false
      }
    }),
})
export const workflowPayloadSchema = z.discriminatedUnion('kind', [writing, analysis, verification, comment, qualification, app])
export type WorkflowPayload = z.infer<typeof workflowPayloadSchema>
export interface WorkflowRecord {
  id: string
  projectId: WorkspaceId
  title: string
  revision: string
  updatedAt: string
  payload: WorkflowPayload
}
export interface SaveWorkflowRecord {
  id: string
  projectId: WorkspaceId
  title: string
  expectedRevision: string | null
  payload: WorkflowPayload
}
const recordSchema = z.object({
  id: z.string(),
  projectId: z.string().transform(value => value as WorkspaceId),
  title: z.string(),
  revision: z.string(),
  updatedAt: z.string(),
  payload: workflowPayloadSchema,
})
const domainSpec = defineDomain({
  name: 'project_workflow_journal',
  version: 1,
  tables: { records: domainTable<string, WorkflowRecord>(recordSchema) },
})
export class WorkflowJournal {
  private table?: KvTable<string, WorkflowRecord>
  private tail: Promise<void> = Promise.resolve()
  async open(storage: DomainFacility): Promise<() => Promise<void>> {
    const domain = await storage.open(domainSpec)
    this.table = domain.table('records')
    for (const [key, record] of this.table.entries())
      if (record.payload.kind === 'analysis' && record.payload.status === 'running')
        await this.table.put(key, {
          ...record,
          revision: randomUUID(),
          updatedAt: new Date().toISOString(),
          payload: {
            ...record.payload,
            status: 'failed',
            detail: 'Execution interrupted by host restart; outputs were not accepted.',
          },
        })
    return () => domain.close()
  }
  private records(): KvTable<string, WorkflowRecord> {
    if (this.table === undefined) throw new Error('Workflow journal is unavailable')
    return this.table
  }
  list(projectId: WorkspaceId): readonly WorkflowRecord[] {
    return [...this.records().entries()]
      .map(([, value]) => value)
      .filter(value => value.projectId === projectId)
      .map(value => structuredClone(value))
  }
  save(request: SaveWorkflowRecord, validate: (payload: WorkflowPayload) => void): Promise<WorkflowRecord> {
    const detached = structuredClone(request)
    const operation = this.tail.then(async () => {
      const payload = workflowPayloadSchema.parse(detached.payload)
      if (
        detached.id.trim() === '' ||
        detached.title.trim() === '' ||
        Buffer.byteLength(JSON.stringify(detached), 'utf8') > 1024 * 1024
      )
        throw new Error('Workflow record identity, title or size is invalid')
      const key = createHash('sha256')
        .update(JSON.stringify([detached.projectId, detached.id]))
        .digest('hex')
      const previous = this.records().get(key)
      if ((previous?.revision ?? null) !== detached.expectedRevision)
        throw new Error('Workflow record changed. Reload before saving.')
      if (payload.kind === 'analysis' && previous === undefined && payload.status !== 'prepared')
        throw new Error('Analysis must start prepared')
      if (
        payload.kind === 'analysis' &&
        payload.status === 'completed' &&
        (payload.jobId === undefined || payload.outputs.length === 0)
      )
        throw new Error('Completed analysis requires an executed job and captured output')
      if (previous !== undefined && previous.payload.kind !== payload.kind) throw new Error('Workflow record kind cannot change')
      if (previous?.payload.kind === 'analysis' && payload.kind === 'analysis') {
        if (
          ['completed', 'failed', 'cancelled'].includes(previous.payload.status) &&
          JSON.stringify(previous.payload) !== JSON.stringify(payload)
        )
          throw new Error('Terminal analysis outcomes are immutable')
        const allowed: Record<Extract<WorkflowPayload, { kind: 'analysis' }>['status'], readonly string[]> = {
          prepared: ['running', 'cancelled'],
          running: ['completed', 'failed', 'cancelled'],
          completed: [],
          failed: [],
          cancelled: [],
        }
        if (payload.status !== previous.payload.status && !allowed[previous.payload.status].includes(payload.status))
          throw new Error('Invalid analysis state transition')
        if (
          JSON.stringify([
            previous.payload.notebook,
            previous.payload.inputs,
            previous.payload.code,
            previous.payload.kernel,
            previous.payload.environment,
            previous.payload.parameters,
          ]) !==
          JSON.stringify([
            payload.notebook,
            payload.inputs,
            payload.code,
            payload.kernel,
            payload.environment,
            payload.parameters,
          ])
        )
          throw new Error('Analysis inputs and execution identity are immutable')
      }
      validate(payload)
      const value: WorkflowRecord = {
        id: detached.id,
        projectId: detached.projectId,
        title: detached.title,
        revision: randomUUID(),
        updatedAt: new Date().toISOString(),
        payload,
      }
      await this.records().put(key, value)
      return structuredClone(value)
    })
    this.tail = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
}
