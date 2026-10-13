/** Agent operations use the same durable evidence registry as the workspace UI. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry, { ProjectKnowledge } from '@deepseek-ai/dsh-workspace'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { WorkspaceController } from '../src/index.ts'
import WebRuntime from '@deepseek-ai/dsh-web'
import { applyWebFetchTool } from '../../../web/tool-web/src/fetch.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bharatcode-agent-sources-'))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  ctx.provide('sessionPersistence', { list: async () => [] } as never)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(ProjectKnowledge)
  const session = ctx.sessions.create(SessionId('research-owner'), { meta: { cwd: root } })
  const project = await ctx.workspaceRegistry.create(root)
  await project.attachSession(session.id)
  ctx.provide('sessionController', {} as never)
  ctx.provide('sessionQuery', {} as never)
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  ctx.provide('agents', { get: () => undefined } as never)
  await ctx.plugin(WorkspaceController)
  const controller = ctx.projectKnowledgeController
  await ctx.fiber.await()
  const agent = { session } as Agent
  const call = (name: string, args: unknown = {}) =>
    ctx.tools.execute({
      name,
      arguments: args,
      agent,
      callId: ToolCallId('source-test'),
      signal: new AbortController().signal,
    })
  const register = (name: string, value: unknown, fail = false) =>
    ctx.tools.register(
      defineTool({
        name,
        description: 'fixture provider',
        parameters: {},
        output: { schema: { type: 'json' }, render: () => [{ type: 'text', text: 'Fetched source content' }] },
        async execute() {
          if (fail) throw new Error('retrieval failed')
          return value as never
        },
      }),
    )
  return { ctx, root, project, session, agent, controller, call, register }
}
it('automatically captures successful web reads in Sources without asking the model to save', async () => {
  const h = await setup()
  h.register('web_fetch', {
    url: 'https://example.org/paper',
    statusCode: 200,
    body: { type: 'text', text: 'Evidence' },
    truncated: false,
  })
  const result = await h.call('web_fetch', { url: 'https://example.org/paper' })
  expect(result.isError).toBe(false)
  const sources = h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits
  expect(sources).toHaveLength(1)
  expect(sources[0]?.kind).toBe('source')
  expect(h.ctx.projectKnowledge.read(sources[0]!.id).text).toContain('Fetched source content')
  expect(JSON.stringify(result.content)).toContain('Source captured')
  await h.call('web_fetch', { url: 'https://example.org/paper' })
  expect(h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits).toHaveLength(1)
})
it('captures files written in sources and preserves changed revisions', async () => {
  const h = await setup()
  await mkdir(join(h.root, 'sources'))
  const path = join(h.root, 'sources/paper.md')
  await writeFile(path, 'Original research')
  h.register('write', { path, after: 'Original research', before: null, operation: 'create' })
  expect((await h.call('write', { file_path: path })).isError).toBe(false)
  const first = h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits[0]!
  expect(first).toBeDefined()
  await writeFile(path, 'Revised research')
  await h.call('write', { file_path: path })
  const latest = h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits[0]!
  expect(latest.id).not.toBe(first.id)
  expect(h.ctx.projectKnowledge.read(first.id).text).toBe('Original research')
})
it('does not capture failed web retrievals or unrelated code files', async () => {
  const h = await setup()
  h.register('web_fetch', {}, true)
  h.register('read', { path: join(h.root, 'app.ts') })
  await h.call('web_fetch', { url: 'https://example.org' })
  await h.call('read', { file_path: join(h.root, 'app.ts') })
  expect(h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits).toHaveLength(0)
})
it('publishes all workspace feature tools and research instructions to the model', async () => {
  const h = await setup()
  const assembly = await h.ctx.systemPrompt.assemble({ scope: h.agent, agent: h.agent })
  expect(assembly.tools.map(value => value.name)).toEqual(
    expect.arrayContaining([
      'project_sources',
      'research_notes',
      'workspace_records',
      'workspace_review',
      'workspace_handoff',
      'workspace_apps',
      'workspace_manage',
      'workspace_drafts',
    ]),
  )
  expect(assembly.sections.map(value => value.text).join('\n')).toContain('automatically')
  expect(assembly.sections.map(value => value.text).join('\n')).toContain('research_notes.store')
  expect(assembly.sections.map(value => value.text).join('\n')).toContain('read back')
  expect(assembly.tools.find(value => value.name === 'research_notes')?.description).toContain('store:')
})
it('registers an existing file via the agent tool and rejects cross-project source reads', async () => {
  const h = await setup()
  await writeFile(join(h.root, 'existing.md'), 'Existing evidence')
  const saved = await h.call('project_sources', { action: 'register', input: { path: 'existing.md', kind: 'source' } })
  expect(saved.isError, JSON.stringify(saved)).toBe(false)
  const source = h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits[0]!
  const otherRoot = join(h.root, 'other')
  await mkdir(otherRoot)
  const other = await h.ctx.workspaceRegistry.create(otherRoot)
  await writeFile(join(otherRoot, 'secret.md'), 'Other project private source')
  const privateSource = await h.ctx.projectKnowledge.register({
    projectId: other.id,
    path: 'secret.md',
    kind: 'source',
  })
  const rejected = await h.call('project_sources', { action: 'read', input: { id: privateSource.id } })
  expect(rejected.isError).toBe(true)
  expect(JSON.stringify(rejected.content)).not.toContain('Other project private source')
  expect((await h.call('project_sources', { action: 'read', input: { id: source.id } })).isError).toBe(false)
})
it('reports capture failures without disguising a successful provider read', async () => {
  const h = await setup()
  h.register('web_fetch', { url: 'https://example.org', statusCode: 200, truncated: false })
  vi.spyOn(h.ctx.projectKnowledge, 'captureText').mockRejectedValue(new Error('disk full'))
  const result = await h.call('web_fetch', { url: 'https://example.org' })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result.content)).toContain('Source capture failed')
})
it('pushes project-scoped knowledge invalidations after durable source changes', async () => {
  const h = await setup()
  const abort = new AbortController()
  const stream = h.controller.watch(h.project.id, abort.signal)[Symbol.asyncIterator]()
  expect(await stream.next()).toMatchObject({ value: 0 })
  const update = stream.next()
  await h.ctx.projectKnowledge.captureText({
    projectId: h.project.id,
    identity: 'https://example.org',
    title: 'Source',
    text: 'Evidence',
    kind: 'source',
  })
  expect(await update).toMatchObject({ value: 1 })
  abort.abort()
  expect(await stream.next()).toMatchObject({ done: true })
})

it('preserves downstream canonical replacements without capturing the original private rendering', async () => {
  const h = await setup()
  h.register('web_fetch', { url: 'https://example.org', statusCode: 200, secret: 'private' })
  h.ctx.on('tools/post-execute', async () => ({ kind: 'accept', value: { redacted: true } }))
  const result = await h.call('web_fetch', { url: 'https://example.org' })
  expect(result.value).toEqual({ redacted: true })
  expect(h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits).toHaveLength(0)
})
it('does not archive evidence blocked by downstream result policy', async () => {
  const h = await setup()
  h.register('web_fetch', { url: 'https://example.org', statusCode: 200 })
  h.ctx.on('tools/post-execute', async () => ({ kind: 'block', feedback: [{ type: 'text', text: 'blocked' }] }))
  expect((await h.call('web_fetch', { url: 'https://example.org' })).isError).toBe(true)
  expect(h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits).toHaveLength(0)
})
it('resolves the canonical project for an attached session opened through a symlink', async () => {
  const h = await setup()
  const alias = join(h.root, 'alias')
  await symlink(h.root, alias)
  const session = h.ctx.sessions.create(SessionId('alias-owner'), { meta: { cwd: alias } })
  await h.project.attachSession(session.id)
  const result = await h.ctx.tools.execute({
    name: 'workspace_manage',
    arguments: { action: 'current' },
    agent: { session } as Agent,
    callId: ToolCallId('alias'),
    signal: new AbortController().signal,
  })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  expect(result.value).toMatchObject({ id: h.project.id })
})
it('captures the real web tool returned evidence with its URL and truncation coverage', async () => {
  const h = await setup()
  await h.ctx.plugin(WebRuntime)
  h.ctx.web.registerFetchProvider({
    id: 'fixture',
    available: () => true,
    fetch: async () => ({
      url: 'https://example.org/paper',
      statusCode: 200,
      body: { kind: 'text', content: 'Real provider evidence' },
      truncated: true,
    }),
  })
  applyWebFetchTool(h.ctx, 1000, 2000)
  const result = await h.call('web_fetch', { url: 'https://example.org/paper' })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  const saved = h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits[0]!
  expect(h.ctx.projectKnowledge.read(saved.id).text).toContain('Real provider evidence')
  expect(h.ctx.projectKnowledge.read(saved.id).text).toContain('Returned excerpt; source was truncated')
})
it('requires host approval for sensitive actions even when the model asserts userAuthorized', async () => {
  const h = await setup()
  for (const [name, action, input] of [
    ['workspace_manage', 'delete', { userAuthorized: true }],
    ['workspace_handoff', 'submit', { id: 'fake', mode: 'queue', userAuthorized: true }],
    ['workspace_review', 'replay_request', { turn: 0, step: 0, removeTools: [], userAuthorized: true }],
    ['workspace_drafts', 'clear', { path: 'text.md', expectedRevision: '1', userAuthorized: true }],
  ] as const)
    expect((await h.call(name, { action, input })).isError).toBe(true)
  expect(h.ctx.workspaceRegistry.get(h.project.id)).toBeDefined()
})
it('isolates private recovery drafts by the owning session and checks revisions', async () => {
  const h = await setup()
  const result = await h.call('workspace_drafts', {
    action: 'save',
    input: { path: 'text.md', text: 'Private unsaved draft', baseVersion: 'base', expectedDraftRevision: null },
  })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  const other = h.ctx.sessions.create(SessionId('other-owner'), { meta: { cwd: h.root } })
  await h.project.attachSession(other.id)
  const read = await h.ctx.tools.execute({
    name: 'workspace_drafts',
    arguments: { action: 'read', input: { path: 'text.md' } },
    agent: { session: other } as Agent,
    callId: ToolCallId('private'),
    signal: new AbortController().signal,
  })
  expect(read.value).toBe(null)
  expect(
    (
      await h.call('workspace_drafts', {
        action: 'save',
        input: { path: 'text.md', text: 'stale', baseVersion: 'base', expectedDraftRevision: null },
      })
    ).isError,
  ).toBe(true)
})

it('recovers existing sources on Sources search and captures later shell-generated files', async () => {
  const h = await setup()
  await mkdir(join(h.root, 'sources'))
  await writeFile(join(h.root, 'sources/shell.md'), 'Source saved before tools were available')
  const first = await h.controller.search({ projectId: h.project.id, query: '' })
  expect(first.hits).toHaveLength(1)
  await writeFile(join(h.root, 'sources/later.md'), 'Source saved through shell')
  h.register('bash', { exitCode: 0 })
  const result = await h.call('bash', { command: 'download sources' })
  expect(result.isError).toBe(false)
  expect(h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits).toHaveLength(2)
  expect(JSON.stringify(result.content)).toContain('Project Sources discovery')
})
it('reports invalid source discovery while keeping existing evidence readable', async () => {
  const h = await setup()
  await mkdir(join(h.root, 'sources'))
  await writeFile(join(h.root, 'sources/good.md'), 'Good evidence')
  await writeFile(join(h.root, 'sources/binary.txt'), Buffer.from([0, 255]))
  const result = await h.controller.search({ projectId: h.project.id, query: '' })
  expect(result.hits).toHaveLength(1)
  expect(result.captureIssues).toHaveLength(1)
})

it('captures extensionless text and reports binary research files needing extraction', async () => {
  const h = await setup()
  await mkdir(join(h.root, 'sources'))
  await writeFile(join(h.root, 'sources/notes'), 'Extensionless source notes')
  await writeFile(join(h.root, 'sources/paper.pdf'), Buffer.from([37, 80, 68, 70, 0, 255]))
  const result = await h.controller.search({ projectId: h.project.id, query: '' })
  expect(result.hits[0]?.path).toBe('sources/notes')
  expect(result.captureIssues?.join(' ')).toContain('paper.pdf')
})
it('provides research note tools with explicit source-backed citation proposals', async () => {
  const h = await setup()
  await writeFile(join(h.root, 'Note.md'), '# Note\n\nFinding')
  const source = await h.ctx.projectKnowledge.captureText({ projectId: h.project.id, identity: 'tool-source', title: 'Study', text: 'Exact passage', kind: 'source' })
  const listed = await h.call('research_notes', { action: 'list', input: {} })
  expect(listed.isError).toBe(false)
  const prepared = await h.call('research_notes', { action: 'prepare_citation', input: { path: 'Note.md', expectedText: '# Note\n\nFinding', sourceId: source.id, start: 0, end: 13 } })
  expect(prepared.isError).toBe(false)
  expect(JSON.stringify(prepared)).toContain('proposedText')
  expect(await import('node:fs/promises').then(fs => fs.readFile(join(h.root, 'Note.md'), 'utf8'))).toBe('# Note\n\nFinding')
})

it('stores nonempty linked knowledge with exact citations through the model tool and reads it back', async () => {
  const h = await setup()
  const source = await h.ctx.projectKnowledge.captureText({ projectId: h.project.id, identity: 'study', title: 'Study', text: 'Exact passage', kind: 'source' })
  const input = { path: 'notes/Finding.md', title: 'Finding', text: '# Finding\n\nUseful synthesis. See [[Research]].', citations: [{ sourceId: source.id, start: 0, end: 13 }] }
  const saved = await h.call('research_notes', { action: 'store', input })
  expect(saved.isError, JSON.stringify(saved)).toBe(false)
  expect(JSON.stringify(saved)).toContain('"linked":1')
  const inspected = await h.call('research_notes', { action: 'inspect', input: { path: input.path } })
  expect(JSON.stringify(inspected)).toContain('Useful synthesis')
  expect(JSON.stringify(inspected)).toContain('Exact passage')
  const reopened = await h.controller.researchInspect(h.project.id, input.path)
  expect(reopened.text).toContain('[[Research]]')
  expect(reopened.text).toContain('research-citation:')
  expect((await h.controller.researchList(h.project.id)).notes.map(note => note.path)).toContain(input.path)
  expect((await h.call('research_notes', { action: 'store', input: { ...input, text: 'Overwrite' } })).isError).toBe(true)
  expect((await h.controller.researchInspect(h.project.id, input.path)).text).toBe(reopened.text)
})

it('rejects empty knowledge and invalid source citations before creating a note', async () => {
  const h = await setup()
  const source = await h.ctx.projectKnowledge.captureText({ projectId: h.project.id, identity: 'short', title: 'Short', text: 'Short', kind: 'source' })
  const otherRoot = join(h.root, 'other')
  await mkdir(otherRoot)
  const other = await h.ctx.workspaceRegistry.create(otherRoot)
  const privateSource = await h.ctx.projectKnowledge.captureText({ projectId: other.id, identity: 'private', title: 'Private', text: 'Secret', kind: 'source' })
  for (const input of [
    { path: 'Empty.md', title: 'Empty', text: '   ' },
    { path: 'Invalid.md', title: 'Invalid', text: 'Finding', citations: [{ sourceId: 'missing', start: 0, end: 3 }] },
    { path: '../Outside.md', title: 'Outside', text: 'Finding' },
    { path: 'Range.md', title: 'Range', text: 'Finding', citations: [{ sourceId: source.id, start: 0, end: 100 }] },
    { path: 'Private.md', title: 'Private', text: 'Finding', citations: [{ sourceId: privateSource.id, start: 0, end: 6 }] },
    { path: 'Oversized.md', title: 'Oversized', text: '界'.repeat(800_000) },
  ]) expect((await h.call('research_notes', { action: 'store', input })).isError).toBe(true)
  expect((await h.controller.researchList(h.project.id)).notes).toHaveLength(0)
})

it('returns an incomplete receipt when note evidence capture fails while keeping the saved Markdown', async () => {
  const h = await setup()
  vi.spyOn(h.ctx.projectKnowledge, 'register').mockRejectedValueOnce(new Error('Storage unavailable'))
  const saved = await h.call('research_notes', { action: 'store', input: { path: 'Finding.md', title: 'Finding', text: '# Finding\n\nRetained knowledge' } })
  expect(saved.isError).toBe(false)
  expect(JSON.stringify(saved)).toContain('Storage unavailable')
  expect(JSON.stringify(saved)).not.toContain('artifactId')
  expect((await h.controller.researchInspect(h.project.id, 'Finding.md')).text).toContain('Retained knowledge')
})

it('generates portable relative citation links for Windows note paths', async () => {
  const h = await setup()
  const source = await h.ctx.projectKnowledge.captureText({ projectId: h.project.id, identity: 'windows', title: 'Study', text: 'Exact passage', kind: 'source' })
  const saved = await h.call('research_notes', { action: 'store', input: { path: 'notes\\Finding.md', title: 'Finding', text: '# Finding\n\nKnowledge', citations: [{ sourceId: source.id, start: 0, end: 13 }] } })
  expect(saved.isError).toBe(false)
  const note = await h.controller.researchInspect(h.project.id, 'notes/Finding.md')
  expect(note.text).toContain(`../sources/captured/${source.id}.md`)
  await writeFile(join(h.root, 'notes/Existing.md'), '# Existing\n\nKnowledge')
  const proposal = await h.call('research_notes', { action: 'prepare_citation', input: { path: 'notes\\Existing.md', expectedText: '# Existing\n\nKnowledge', sourceId: source.id, start: 0, end: 13 } })
  expect(proposal.isError).toBe(false)
  expect(JSON.stringify(proposal)).toContain(`../sources/captured/${source.id}.md`)
  expect(JSON.stringify(proposal)).toContain('notes/Existing.md')
})
