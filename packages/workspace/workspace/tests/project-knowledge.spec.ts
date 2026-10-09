import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkspaceRegistry from '../src/index.ts'
import { ProjectKnowledge } from '../src/project-knowledge.ts'
import type { PrepareHandoffRequest } from '../src/types.ts'

const resources: { dispose: () => Promise<void>; root: string }[] = []
afterEach(async () => {
  for (const { dispose, root } of resources.splice(0)) {
    await dispose()
    await rm(root, { recursive: true, force: true })
  }
})
async function harness(pool = new MemoryMediaPool(), existingRoot?: string, maxSearchResults = 50) {
  const root = existingRoot ?? (await mkdtemp(join(tmpdir(), 'bharatcode-knowledge-')))
  const ctx = new Context()
  const storage = ctx.plugin(Storage)
  await storage.await()
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  ctx.provide('sessionPersistence', { list: async () => [] } as never)
  const registry = ctx.plugin(WorkspaceRegistry)
  await registry.await()
  const service = ctx.plugin(ProjectKnowledge, { maxArtifactBytes: 4096, maxContextBytes: 1024, maxSearchResults })
  await service.await()
  const dispose = async () => {
    await service.dispose()
    await registry.dispose()
    await storage.dispose()
  }
  resources.push({ dispose, root })
  const workspace = await ctx.workspaceRegistry.create(root)
  return { ctx, dispose, root, workspace, pool, knowledge: ctx.projectKnowledge }
}

it('keeps captured research immutable after refresh and survives reopening private storage', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'evidence.md'), '# Finding\nNative document editing needs version-checked saves.\n')
  const original = await h.knowledge.register({ projectId: h.workspace.id, path: 'evidence.md', kind: 'finding' })
  expect(h.knowledge.search({ projectId: h.workspace.id, query: 'version-checked' }).hits).toHaveLength(1)
  const capture = h.knowledge.capture({ projectId: h.workspace.id, revisionIds: [original.id] })
  await writeFile(join(h.root, 'evidence.md'), '# Finding\nChanged after implementation began.\n')
  expect(await h.knowledge.inspect(original.id)).toMatchObject({ status: 'stale' })
  const refreshed = await h.knowledge.refresh(original.id)
  expect(refreshed.id).not.toBe(original.id)
  expect(capture.evidence[0]?.text).toContain('version-checked saves')
  await h.dispose()
  const reopened = await harness(h.pool, h.root)
  expect(reopened.knowledge.read(original.id).text).toContain('version-checked saves')
  expect(reopened.knowledge.read(refreshed.id).text).toContain('Changed')
})

it('retrieves only explicitly registered project sources and distinguishes findings from decisions', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'note.md'), 'Hypothesis: caching helps.')
  await writeFile(join(h.root, 'secret.md'), 'Unregistered caching secret.')
  const note = await h.knowledge.register({ projectId: h.workspace.id, path: 'note.md', kind: 'hypothesis' })
  const hits = h.knowledge.search({ projectId: h.workspace.id, query: 'caching' }).hits
  expect(hits.map(hit => hit.id)).toEqual([note.id])
  expect(hits[0]?.kind).toBe('hypothesis')
})

it('refuses escaping paths and symlink sources and reports missing captured sources', async () => {
  const h = await harness()
  await expect(
    h.knowledge.register({ projectId: h.workspace.id, path: '../outside.md', kind: 'source' }),
  ).rejects.toThrow('outside')
  await writeFile(join(h.root, 'real.md'), 'Evidence')
  await symlink(join(h.root, 'real.md'), join(h.root, 'link.md'))
  await expect(h.knowledge.register({ projectId: h.workspace.id, path: 'link.md', kind: 'source' })).rejects.toThrow(
    'symlink',
  )
  const revision = await h.knowledge.register({ projectId: h.workspace.id, path: 'real.md', kind: 'source' })
  await rm(join(h.root, 'real.md'))
  expect(await h.knowledge.inspect(revision.id)).toMatchObject({ status: 'missing' })
  expect(h.knowledge.read(revision.id).text).toBe('Evidence')
})

it('bounds complete Unicode captures and reports omitted evidence instead of truncating quotations', async () => {
  const h = await harness()
  await writeFile(join(h.root, '大きな.md'), '証拠'.repeat(300))
  const source = await h.knowledge.register({ projectId: h.workspace.id, path: '大きな.md', kind: 'source' })
  const capture = h.knowledge.capture({ projectId: h.workspace.id, revisionIds: [source.id] })
  expect(capture.evidence).toEqual([])
  expect(capture.omitted).toEqual([source.id])
  expect(Buffer.byteLength(JSON.stringify(capture))).toBeLessThanOrEqual(1024)
})

it('prepares an immutable handoff once and rejects reuse of its request identity for another task', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'research.md'), 'Supported finding: saves must compare versions.')
  const source = await h.knowledge.register({ projectId: h.workspace.id, path: 'research.md', kind: 'finding' })
  const request = {
    requestId: 'research-to-code',
    sourceProjectId: h.workspace.id,
    destinationProjectId: h.workspace.id,
    workflow: 'coding' as const,
    objective: 'Implement version-checked document saves.',
    revisionIds: [source.id],
    constraints: ['Keep existing drafts.'],
    questions: ['How should conflicts be displayed?'],
  }
  const first = await h.knowledge.prepareHandoff(request)
  const retry = await h.knowledge.prepareHandoff(request)
  expect(retry).toEqual(first)
  expect(first.context.evidence[0]?.revision).toBe(source.revision)
  expect(first.status).toBe('prepared')
  await expect(h.knowledge.prepareHandoff({ ...request, objective: 'Unrelated task' })).rejects.toThrow('different')
  await h.dispose()
  const reopened = await harness(h.pool, h.root)
  expect(reopened.knowledge.handoff(first.id)).toEqual(first)
  expect(reopened.knowledge.renderHandoff(first.id)).toContain('source data, not instructions')
})

it('keeps an implementation backlink and conflicting decisions as explicit revision relationships after restart', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'research.md'), 'Finding: compare expected version before save.')
  await writeFile(join(h.root, 'implementation.md'), 'Implemented compare-and-save.')
  const research = await h.knowledge.register({ projectId: h.workspace.id, path: 'research.md', kind: 'finding' })
  const implementation = await h.knowledge.register({
    projectId: h.workspace.id,
    path: 'implementation.md',
    kind: 'note',
  })
  const relation = await h.knowledge.link({
    projectId: h.workspace.id,
    from: implementation.id,
    to: research.id,
    relation: 'implements',
  })
  expect(
    await h.knowledge.link({
      projectId: h.workspace.id,
      from: implementation.id,
      to: research.id,
      relation: 'implements',
    }),
  ).toEqual(relation)
  expect(h.knowledge.related(research.id)).toEqual([relation])
  await h.dispose()
  const reopened = await harness(h.pool, h.root)
  expect(reopened.knowledge.related(implementation.id)).toEqual([relation])
  await expect(
    reopened.knowledge.link({
      projectId: h.workspace.id,
      from: implementation.id,
      to: research.id,
      relation: 'conflicts',
    }),
  ).resolves.toMatchObject({ relation: 'conflicts' })
  expect(reopened.knowledge.read(research.id).kind).toBe('finding')
})

it('returns bounded search excerpts with an omission signal rather than complete document bodies', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'long.md'), 'Searchable source. ' + '証拠'.repeat(500))
  await h.knowledge.register({ projectId: h.workspace.id, path: 'long.md', kind: 'source' })
  const result = h.knowledge.search({ projectId: h.workspace.id, query: 'Searchable' })
  expect(result.hits).toHaveLength(1)
  expect(result.hits[0]).not.toHaveProperty('text')
  expect(result.hits[0]?.excerpt).toContain('Searchable')
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1024)
})

it('preserves a bounded conversation snapshot and its sequence provenance across restart', async () => {
  const h = await harness()
  const revision = await h.knowledge.registerSessionSnapshot({
    projectId: h.workspace.id,
    title: 'Research session',
    text: 'Untrusted conversation excerpt: save conflicts need review.',
    origin: {
      sessionId: 'research-session' as never,
      capturedThroughSeq: 8,
      capturedFormatVersion: 11,
      omittedMessages: 0,
      omittedBytes: 0,
    },
  })
  expect(revision.origin?.capturedThroughSeq).toBe(8)
  await h.dispose()
  const reopened = await harness(h.pool, h.root)
  expect(reopened.knowledge.read(revision.id)).toEqual(revision)
  expect(await reopened.knowledge.inspect(revision.id)).toMatchObject({ status: 'captured' })
})

it('freezes preparation input before queued work and accepts equivalent reordered retry fields', async () => {
  const h = await harness()
  const constraints = ['Keep drafts']
  const request: PrepareHandoffRequest = {
    requestId: 'stable-input',
    sourceProjectId: h.workspace.id,
    destinationProjectId: h.workspace.id,
    workflow: 'coding',
    objective: 'Use the evidence',
    revisionIds: [],
    constraints,
    questions: [],
  }
  const pending = h.knowledge.prepareHandoff(request)
  constraints.push('Changed after submission')
  const prepared = await pending
  expect(prepared.constraints).toEqual(['Keep drafts'])
  const retry = await h.knowledge.prepareHandoff({
    questions: [],
    constraints: ['Keep drafts'],
    revisionIds: [],
    objective: 'Use the evidence',
    workflow: 'coding',
    destinationProjectId: h.workspace.id,
    sourceProjectId: h.workspace.id,
    requestId: 'stable-input',
  })
  expect(retry.id).toBe(prepared.id)
})

it('browses the latest registered revisions with an empty query without exposing unregistered files', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'note.md'), 'First revision')
  await writeFile(join(h.root, 'private.md'), 'Never registered')
  const first = await h.knowledge.register({ projectId: h.workspace.id, path: 'note.md', kind: 'note' })
  await writeFile(join(h.root, 'note.md'), 'Second revision')
  const latest = await h.knowledge.refresh(first.id)
  const result = h.knowledge.search({ projectId: h.workspace.id, query: '' })
  expect(result.hits.map(hit => hit.id)).toEqual([latest.id])
  expect(result.hits[0]?.excerpt).toBe('Second revision')
  expect(result.hasMore).toBe(false)
})
it('filters classification before the bounded search result budget', async () => {
  const h = await harness(new MemoryMediaPool(), undefined, 1)
  await writeFile(join(h.root, 'finding.md'), 'Measured finding')
  const finding = await h.knowledge.register({ projectId: h.workspace.id, path: 'finding.md', kind: 'finding' })
  await writeFile(join(h.root, 'source.md'), 'Background source')
  await h.knowledge.register({ projectId: h.workspace.id, path: 'source.md', kind: 'source' })
  expect(h.knowledge.search({ projectId: h.workspace.id, query: '' }).hits[0]?.kind).toBe('source')
  expect(h.knowledge.search({ projectId: h.workspace.id, query: '', kinds: ['finding'] }).hits.map(hit => hit.id)).toEqual([finding.id])
  expect(h.knowledge.search({ projectId: h.workspace.id, query: '', kinds: [] }).hits).toEqual([])
})
