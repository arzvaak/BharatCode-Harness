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

it('preserves a bounded conversation snapshot and its sequence source attribution across restart', async () => {
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

it('anchors a claim to the selected immutable passage and preserves it after source changes', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'paper.md'), 'Repeated. Evidence 😀. Repeated.')
  await writeFile(join(h.root, 'claim.md'), 'The claim')
  const paper = await h.knowledge.register({ projectId: h.workspace.id, path: 'paper.md', kind: 'source' })
  const claim = await h.knowledge.register({ projectId: h.workspace.id, path: 'claim.md', kind: 'finding' })
  const passage = { start: 10, end: 22, quote: 'Evidence 😀.' }
  const link = await h.knowledge.link({ projectId: h.workspace.id, from: claim.id, to: paper.id, relation: 'supports', passage })
  expect(h.knowledge.related(claim.id)).toContainEqual(link)
  await writeFile(join(h.root, 'paper.md'), 'New version')
  expect((await h.knowledge.inspect(paper.id)).status).toBe('stale')
  expect(h.knowledge.read(paper.id).text.slice(passage.start, passage.end)).toBe(passage.quote)
  await expect(h.knowledge.link({ projectId: h.workspace.id, from: claim.id, to: paper.id, relation: 'cites', passage: { ...passage, start: 0 } })).rejects.toThrow('Passage')
})

it('preserves writing canon separately from tentative ideas and rejects conflicting saves', async () => {
  const h = await harness()
  const payload = { kind: 'writing' as const, specialization: 'novel' as const, brief: 'A novel', style: 'Direct', outline: ['Scene'], canon: ['Established'], tentative: ['Possible'], characters: ['Hero'], chronology: [], scenes: [{ title: 'Opening', objective: 'Introduce the hero' }], sourceIds: [] }
  const first = await h.knowledge.saveWorkflowRecord({ id: 'writing-project', projectId: h.workspace.id, title: 'Writing', expectedRevision: null, payload })
  expect(h.knowledge.workflowRecords(h.workspace.id)[0]?.payload).toEqual(payload)
  await expect(h.knowledge.saveWorkflowRecord({ id: first.id, projectId: h.workspace.id, title: 'Writing', expectedRevision: null, payload })).rejects.toThrow('changed')
  const next = await h.knowledge.saveWorkflowRecord({ id: first.id, projectId: h.workspace.id, title: 'Writing', expectedRevision: first.revision, payload: { ...payload, tentative: ['Another possibility'] } })
  expect(next.payload).toMatchObject({ canon: ['Established'], tentative: ['Another possibility'] })
})

it('freezes analysis identity and permits only explicit lifecycle transitions', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'analysis.ipynb'), '{"cells":[]}')
  const notebook = await h.knowledge.register({ projectId: h.workspace.id, path: 'analysis.ipynb', kind: 'note' })
  const payload = { kind: 'analysis' as const, notebook: notebook.id, inputs: [], code: notebook.text, kernel: 'python3', environment: 'test', parameters: {}, outputs: [], status: 'prepared' as const, detail: '' }
  const first = await h.knowledge.saveWorkflowRecord({ id: 'run', projectId: h.workspace.id, title: 'Analysis', expectedRevision: null, payload })
  await expect(h.knowledge.saveWorkflowRecord({ id: first.id, projectId: h.workspace.id, title: 'Analysis', expectedRevision: first.revision, payload: { ...payload, status: 'completed', jobId: 'probe', outputs: [notebook.id] } })).rejects.toThrow('transition')
  const output = await h.knowledge.captureAnalysisOutput(h.workspace.id, first.id, 'Executed notebook', notebook.text)
  const running = await h.knowledge.saveWorkflowRecord({ id: first.id, projectId: h.workspace.id, title: 'Analysis', expectedRevision: first.revision, payload: { ...payload, status: 'running' } })
  await expect(h.knowledge.saveWorkflowRecord({ id: first.id, projectId: h.workspace.id, title: 'Analysis', expectedRevision: running.revision, payload: { ...payload, code: 'print(2)', status: 'completed', jobId: 'probe', outputs: [output.id] } })).rejects.toThrow('immutable')
  const completed = await h.knowledge.saveWorkflowRecord({ id: first.id, projectId: h.workspace.id, title: 'Analysis', expectedRevision: running.revision, payload: { ...payload, status: 'completed', jobId: 'probe', outputs: [output.id] } })
  expect(completed.payload).toMatchObject({ status: 'completed' })
})

it('rejects forged analysis identity and preserves terminal outcomes across restart', async () => {
  const h = await harness()
  await writeFile(join(h.root, 'run.ipynb'), '{"cells":[]}')
  const notebook = await h.knowledge.register({ projectId: h.workspace.id, path: 'run.ipynb', kind: 'note' })
  const payload = { kind: 'analysis' as const, notebook: notebook.id, inputs: [], code: notebook.text, kernel: 'python3', environment: 'test', parameters: {}, outputs: [], status: 'prepared' as const, detail: '' }
  const request = { id: 'run', projectId: h.workspace.id, title: 'Run', expectedRevision: null, payload }
  await expect(h.knowledge.saveWorkflowRecord({ ...request, payload: { ...payload, status: 'completed', jobId: 'fake', outputs: [notebook.id] } })).rejects.toThrow('start prepared')
  await expect(h.knowledge.saveWorkflowRecord({ ...request, payload: { ...payload, code: 'different code' } })).rejects.toThrow('captured notebook')
  const first = await h.knowledge.saveWorkflowRecord(request)
  const running = await h.knowledge.saveWorkflowRecord({ ...request, expectedRevision: first.revision, payload: { ...payload, status: 'running', jobId: 'job' } })
  await expect(h.knowledge.saveWorkflowRecord({ ...request, expectedRevision: running.revision, payload: { ...payload, status: 'completed', jobId: 'job', outputs: [notebook.id] } })).rejects.toThrow('does not belong')
  await h.dispose()
  const reopened = await harness(h.pool, h.root)
  const recovered = reopened.knowledge.workflowRecords(h.workspace.id)[0]!
  expect(recovered.payload).toMatchObject({ status: 'failed', jobId: 'job' })
  await expect(reopened.knowledge.saveWorkflowRecord({ ...request, expectedRevision: recovered.revision, payload: { ...payload, status: 'failed', jobId: 'replaced' } })).rejects.toThrow('immutable')
})

it('retains the latest file lookup beyond the search budget and validates comment bounds', async () => {
  const h = await harness(undefined, undefined, 1)
  await writeFile(join(h.root, 'older.md'), 'Original quote')
  const older = await h.knowledge.register({ projectId: h.workspace.id, path: 'older.md', kind: 'source' })
  await writeFile(join(h.root, 'newer.md'), 'Newer')
  await h.knowledge.register({ projectId: h.workspace.id, path: 'newer.md', kind: 'source' })
  expect(h.knowledge.latestForPath(h.workspace.id, 'older.md')?.id).toBe(older.id)
  const request = { id: 'comment', projectId: h.workspace.id, title: 'Comment', expectedRevision: null, payload: { kind: 'comment' as const, artifact: older.id, start: 0, end: 100, quote: older.text, comment: 'Review', resolved: false } }
  await expect(h.knowledge.saveWorkflowRecord(request)).rejects.toThrow('passage')
  const value = await h.knowledge.saveWorkflowRecord({ ...request, payload: { ...request.payload, end: older.text.length } })
  expect(value.payload).toMatchObject({ quote: older.text })
})

it('deduplicates virtual source captures and restores exact evidence after reopening storage', async () => {
  const h = await harness()
  const request = { projectId: h.workspace.id, identity: 'https://example.org/paper', title: 'Paper excerpt', text: 'Immutable web evidence', kind: 'source' as const }
  const source = await h.knowledge.captureText(request)
  expect((await h.knowledge.captureText(request)).id).toBe(source.id)
  expect(await h.knowledge.inspect(source.id)).toMatchObject({ status: 'captured' })
  await expect(h.knowledge.captureText({ ...request, text: 'x'.repeat(5000) })).rejects.toThrow()
  await h.dispose()
  const reopened = await harness(h.pool, h.root)
  expect(reopened.knowledge.read(source.id).text).toBe('Immutable web evidence')
})

it('records a new immutable capture when source content reverts to an earlier revision', async () => {
  const h = await harness()
  const request = { projectId: h.workspace.id, path: 'paper.md', kind: 'source' as const }
  await writeFile(join(h.root, request.path), 'A')
  const first = await h.knowledge.register(request)
  await writeFile(join(h.root, request.path), 'B')
  const second = await h.knowledge.register(request)
  await writeFile(join(h.root, request.path), 'A')
  const reverted = await h.knowledge.register(request)
  expect(reverted.id).not.toBe(first.id)
  expect(reverted.revision).toBe(first.revision)
  expect(h.knowledge.search({ projectId: h.workspace.id, query: '' }).hits[0]?.id).toBe(reverted.id)
  expect((await h.knowledge.register(request)).id).toBe(reverted.id)
  expect(h.knowledge.read(second.id).text).toBe('B')
})
