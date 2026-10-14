/** Agent operations use the same durable evidence registry as the workspace UI. */
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
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
import { discoverProjectSources } from '../src/source-capture.ts'
import { zipSync, strToU8 } from 'fflate'
import { paperPdf } from './helpers/paper-pdf.ts'
import { HttpFetchProvider } from '../../../web/web-fetch-http/src/provider.ts'

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

it('curates the live Sources view and emits a refresh without resurrecting discovered files', async () => {
  const h = await setup()
  await mkdir(join(h.root, 'sources'))
  await writeFile(join(h.root, 'sources', 'paper.md'), 'Paper evidence')
  const initial = await h.controller.search({ projectId: h.project.id, query: '' })
  const id = initial.hits[0]!.id
  const changes = [{ id, status: 'removed', reason: 'Discovery duplicate' }]
  const watch = h.controller.watch(h.project.id, new AbortController().signal)[Symbol.asyncIterator]()
  expect((await watch.next()).value).toBe(0)
  const preview = await h.call('project_sources', { action: 'curate', input: { changes } })
  expect(preview.isError, JSON.stringify(preview)).toBe(false)
  const version = (preview.value as { version: string }).version
  expect((await h.call('project_sources', { action: 'curate', input: { changes, apply: true, expectedVersion: version } })).isError).toBe(false)
  expect((await watch.next()).value).toBeGreaterThan(0)
  await watch.return?.(undefined)
  expect((await h.controller.search({ projectId: h.project.id, query: '' })).hits).toHaveLength(0)
  expect((await h.call('project_sources', { action: 'read', input: { id } })).isError).toBe(false)
  const restored = await h.call('project_sources', { action: 'restore', input: { ids: [id], reason: 'Needed again' } })
  expect(restored.isError, JSON.stringify(restored)).toBe(false)
  const restoreVersion = (restored.value as { version: string }).version
  await h.call('project_sources', { action: 'restore', input: { ids: [id], reason: 'Needed again', apply: true, expectedVersion: restoreVersion } })
  expect((await h.controller.search({ projectId: h.project.id, query: '' })).hits).toHaveLength(1)
})

it('imports URLs with per-source receipts, retaining good evidence and rejecting interstitials', async () => {
  const h = await setup()
  await h.ctx.plugin(WebRuntime)
  applyWebFetchTool(h.ctx, 1000, 2000)
  h.ctx.web.registerFetchProvider({ id: 'fixture', available: () => true,
    fetch: async ({ url }) => ({ url, statusCode: url.endsWith('/missing') ? 404 : 200,
      body: { kind: 'html', content: url.endsWith('/challenge') ? '<title>Just a moment...</title>Verify you are human'
        : '<h1>Paper</h1><p>Full paper evidence</p>' }, truncated: false }) })
  const result = await h.call('research_sources', { action: 'fetch_many', input: {
    urls: ['https://example.org/paper', 'https://example.org/paper', 'https://example.org/missing', 'https://example.org/challenge'] } })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  const receipts = (result.value as { receipts: { id?: string; error?: string }[] }).receipts
  expect(receipts).toHaveLength(3)
  expect(receipts[0]?.id).toBeDefined()
  expect(receipts[1]?.error).toContain('404')
  expect(receipts[2]?.error).toContain('challenge')
  const bank = h.ctx.projectKnowledge.search({ projectId: h.project.id, query: 'Full paper evidence' })
  expect(bank.hits).toHaveLength(1)
})

it('imports parsed arXiv abstracts as one resumable corpus, with no XML or stub records', async () => {
  const h = await setup()
  await h.ctx.plugin(WebRuntime)
  applyWebFetchTool(h.ctx, 1000, 2000)
  h.ctx.web.registerFetchProvider({ id: 'arxiv-fixture', available: () => true,
    fetch: async ({ url }) => {
      const params = new URL(url).searchParams
      const start = Number(params.get('start'))
      return { url, statusCode: 200, truncated: false, body: { kind: 'text', content:
        `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
        <opensearch:totalResults>2</opensearch:totalResults><opensearch:startIndex>${start}</opensearch:startIndex>
        <entry><id>http://arxiv.org/abs/2610.0000${start + 1}v1</id><title>Agent &amp; Harness ${start}</title>
        <summary>Complete abstract ${start}</summary><published>2026-10-13T00:00:00Z</published><updated>2026-10-13T00:00:00Z</updated>
        <author><name>Researcher</name></author><category term="cs.AI" /></entry></feed>` } }
    } })
  const first = await h.call('research_sources', { action: 'arxiv', input: { query: 'all:harness', pageSize: 1 } })
  expect(first.isError, JSON.stringify(first)).toBe(false)
  expect(first.value).toMatchObject({ nextStart: 1, complete: false, imported: 1 })
  const second = await h.call('research_sources', { action: 'arxiv', input: { query: 'all:harness', pageSize: 1, start: 1 } })
  expect(second.isError, JSON.stringify(second)).toBe(false)
  expect(second.value).toMatchObject({ complete: true, imported: 2 })
  const sources = h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits
  expect(sources).toHaveLength(1)
  const corpus = h.ctx.projectKnowledge.read(sources[0]!.id).text
  expect(corpus).toContain('Complete abstract 0')
  expect(corpus).toContain('Complete abstract 1')
  expect(corpus).not.toContain('<feed')
  expect((await h.call('research_check', { action: 'sources', input: { requiredTexts: ['2610.00001', '2610.00002'] } })).value).toMatchObject({ ok: true })
})

it('extracts and captures DOCX and PPTX text in document order without helper scripts', async () => {
  const h = await setup()
  await writeFile(join(h.root, 'paper.docx'), zipSync({ 'word/document.xml': strToU8(
    '<w:document xmlns:w="word"><w:body><w:p><w:r><w:t>First &amp; </w:t></w:r><w:r><w:t>second</w:t></w:r></w:p><w:p><w:r><w:t>Next paragraph</w:t></w:r></w:p></w:body></w:document>') }))
  const docx = await h.call('document_extract', { action: 'extract', input: { path: 'paper.docx' } })
  expect(docx.isError, JSON.stringify(docx)).toBe(false)
  expect(docx.value).toMatchObject({ method: 'docx_xml', segments: 2 })
  const id = (docx.value as { id: Parameters<typeof h.ctx.projectKnowledge.read>[0] }).id
  expect(h.ctx.projectKnowledge.read(id).text).toContain('First & second')
  expect(h.ctx.projectKnowledge.read(id).text).toContain('Next paragraph')
  await writeFile(join(h.root, 'deck.pptx'), zipSync({
    'ppt/slides/slide10.xml': strToU8('<p:sld xmlns:p="ppt" xmlns:a="text"><a:p><a:r><a:t>Last slide</a:t></a:r></a:p></p:sld>'),
    'ppt/slides/slide2.xml': strToU8('<p:sld xmlns:p="ppt" xmlns:a="text"><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:sld>') }))
  const pptx = await h.call('document_extract', { action: 'extract', input: { path: 'deck.pptx' } })
  expect(pptx.isError, JSON.stringify(pptx)).toBe(false)
  const slides = h.ctx.projectKnowledge.read((pptx.value as { id: typeof id }).id).text
  expect(slides.indexOf('First slide')).toBeLessThan(slides.indexOf('Last slide'))
  expect(pptx.value).toMatchObject({ method: 'pptx_xml', segments: 2 })
  expect((await h.call('document_extract', { action: 'extract', input: { path: '../outside.docx' } })).isError).toBe(true)
})

it('extracts native PDF text with page labels and retains an immutable source receipt', async () => {
  const h = await setup()
  const content = 'BT /F1 12 Tf 72 720 Td (Evidence from PDF) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = pdf.length
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  await writeFile(join(h.root, 'paper.pdf'), pdf)
  const result = await h.call('document_extract', { action: 'extract', input: { path: 'paper.pdf' } })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  expect(result.value).toMatchObject({ method: 'pdf_text', segments: 1, omissions: [] })
  const id = (result.value as { id: Parameters<typeof h.ctx.projectKnowledge.read>[0] }).id
  expect(h.ctx.projectKnowledge.read(id).text).toContain('Page 1')
  expect(h.ctx.projectKnowledge.read(id).text).toContain('Evidence from PDF')
})

it('follows PPTX presentation relationships after slides have been reordered', async () => {
  const h = await setup()
  await writeFile(join(h.root, 'reordered.pptx'), zipSync({
    'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="ppt" xmlns:r="rels"><p:sldIdLst><p:sldId id="300" r:id="rId9"/><p:sldId id="301" r:id="rId2"/></p:sldIdLst></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="rId9" Target="slides/slide10.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>'),
    'ppt/slides/slide10.xml': strToU8('<sld><p><r><t>Presented first</t></r></p></sld>'),
    'ppt/slides/slide2.xml': strToU8('<sld><p><r><t>Presented second</t></r></p></sld>'),
  }))
  const result = await h.call('document_extract', { action: 'extract', input: { path: 'reordered.pptx' } })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  const text = h.ctx.projectKnowledge.read((result.value as { id: Parameters<typeof h.ctx.projectKnowledge.read>[0] }).id).text
  expect(text.indexOf('Presented first')).toBeLessThan(text.indexOf('Presented second'))
  expect(text).toContain('## Slide 1\n\nPresented first')
})

it('refreshes an arXiv corpus when the API result set shrinks without retaining removed papers', { timeout: 15000 }, async () => {
  const h = await setup()
  await h.ctx.plugin(WebRuntime)
  applyWebFetchTool(h.ctx, 1000, 2000)
  let empty = false
  h.ctx.web.registerFetchProvider({ id: 'changing-arxiv', available: () => true,
    fetch: async ({ url }) => ({ url, statusCode: 200, truncated: false, body: { kind: 'text', content:
      empty ? '<feed><totalResults>0</totalResults><startIndex>0</startIndex></feed>'
        : '<feed><totalResults>1</totalResults><startIndex>0</startIndex><entry><id>https://arxiv.org/abs/2610.00001v1</id><title>Removed later</title><summary>Abstract</summary><published>2026-10-01</published><updated>2026-10-01</updated></entry></feed>' } }) })
  expect((await h.call('research_sources', { action: 'arxiv', input: { query: 'all:changing' } })).value).toMatchObject({ complete: true, imported: 1 })
  empty = true
  const refreshed = await h.call('research_sources', { action: 'arxiv', input: { query: 'all:changing' } })
  expect(refreshed.value).toMatchObject({ complete: true, imported: 0, nextStart: null })
})

it('refuses native retrieval when web_fetch is unavailable in the calling scope', async () => {
  const h = await setup()
  await h.ctx.plugin(WebRuntime)
  h.ctx.web.registerFetchProvider({ id: 'disabled-fixture', available: () => true,
    fetch: async ({ url }) => ({ url, statusCode: 200, body: { kind: 'text', content: 'Evidence' }, truncated: false }) })
  const result = await h.call('research_sources', { action: 'fetch', input: { url: 'https://example.org/paper' } })
  expect(result.isError).toBe(true)
  expect(h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits).toHaveLength(0)
})

it('downloads and retains full arXiv paper PDF bytes and captured full text', async () => {
  const h = await setup()
  await h.ctx.plugin(WebRuntime)
  applyWebFetchTool(h.ctx, 1000, 2000)
  const bytes = paperPdf()
  h.ctx.web.registerFetchProvider({ id: 'full-paper', available: () => true,
    fetch: async ({ url }) => ({ url, statusCode: 200, body: { kind: 'text', content: 'Abstract only' }, truncated: false }),
    fetchDocument: async ({ url }) => ({ url, statusCode: 200, contentType: 'application/pdf', bytes }) })
  const result = await h.call('research_sources', { action: 'paper', input: { arxivId: '2610.00001v2' } })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  expect(result.value).toMatchObject({ url: 'https://arxiv.org/pdf/2610.00001v2', downloaded: true, extracted: true })
  const receipt = result.value as { path: string; sourceId: Parameters<typeof h.ctx.projectKnowledge.read>[0] }
  expect(await readFile(join(h.root, receipt.path))).toEqual(bytes)
  expect(h.ctx.projectKnowledge.read(receipt.sourceId).text).toContain('Full paper evidence beyond its abstract')
  expect(h.ctx.projectKnowledge.read(receipt.sourceId).text).toContain('https://arxiv.org/pdf/2610.00001v2')
  expect(h.ctx.projectKnowledge.sourceBank({ projectId: h.project.id }).counts.active).toBe(1)
  expect((await h.controller.search({ projectId: h.project.id, query: '' })).captureIssues ?? []).toEqual([])
  expect((await h.call('research_sources', { action: 'paper', input: { arxivId: '2610.00001v2' } })).isError).toBe(false)
  expect(h.ctx.projectKnowledge.sourceBank({ projectId: h.project.id }).counts.active).toBe(1)
})

it.runIf(process.env.BC_LIVE_RESEARCH_PDF === '1')('retrieves a real full arXiv paper and retains its original and page text',
  { timeout: 120000 }, async () => {
    const h = await setup()
    await h.ctx.plugin(WebRuntime)
    applyWebFetchTool(h.ctx, 60000, 200000)
    h.ctx.web.registerFetchProvider(new HttpFetchProvider({ maxResponseBytes: 5000000, maxDocumentBytes: 32 * 1024 * 1024,
      maxBodyChars: 100000, timeoutMs: 60000, maxRedirects: 5, userAgent: 'BharatCode-research-verification/1.0' }))
    const result = await h.call('research_sources', { action: 'paper', input: { arxivId: '1706.03762', ocr: false } })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ downloaded: true, extracted: true })
    const receipt = result.value as { path: string; sourceId: Parameters<typeof h.ctx.projectKnowledge.read>[0]; sha256: string }
    expect((await readFile(join(h.root, receipt.path))).subarray(0, 5).toString()).toBe('%PDF-')
    expect(h.ctx.projectKnowledge.read(receipt.sourceId).text).toContain('Attention Is All You Need')
    expect(h.ctx.projectKnowledge.read(receipt.sourceId).text).toContain('## Page 2')
  })

it('does not capture omitted or invisible HTML as successful publication evidence', async () => {
  const h = await setup()
  await h.ctx.plugin(WebRuntime)
  applyWebFetchTool(h.ctx, 1000, 2000)
  h.ctx.web.registerFetchProvider({ id: 'omitted-html', available: () => true,
    fetch: async ({ url }) => ({ url, statusCode: 200, truncated: false, body: { kind: 'html', content:
      url.endsWith('/nested') ? '<div>'.repeat(520) + 'Real evidence' + '</div>'.repeat(520) : '<script>Invisible</script>' } }) })
  for (const path of ['nested', 'invisible']) {
    const result = await h.call('research_sources', { action: 'fetch', input: { url: `https://example.org/${path}` } })
    expect(result.isError).toBe(true)
  }
  expect(h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits).toHaveLength(0)
})
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
it('coalesces overlapping Sources searches while discovery commits invalidate the Research view', async () => {
  const h = await setup()
  await mkdir(join(h.root, 'sources'))
  await writeFile(join(h.root, 'sources/one.md'), 'First source')
  await writeFile(join(h.root, 'sources/two.md'), 'Second source')
  const register = vi.spyOn(h.ctx.projectKnowledge, 'register')
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    h.controller.search({ projectId: h.project.id, query: '' })))
  expect(results.every(result => result.hits.length === 2)).toBe(true)
  expect(register).toHaveBeenCalledTimes(2)
  await h.controller.search({ projectId: h.project.id, query: '' })
  expect(register).toHaveBeenCalledTimes(2)
})
it('shares discovery across caller contexts without cancelling another viewer', async () => {
  const h = await setup()
  await mkdir(join(h.root, 'sources'))
  await writeFile(join(h.root, 'sources/one.md'), 'First revision')
  const register = vi.spyOn(h.ctx.projectKnowledge, 'register')
  const abort = new AbortController()
  const cancelled = discoverProjectSources(h.ctx.extend({}), h.project.id, abort.signal)
  const active = discoverProjectSources(h.ctx.extend({}), h.project.id)
  abort.abort(new Error('viewer closed'))
  await expect(cancelled).rejects.toThrow('viewer closed')
  expect((await active).receipts).toHaveLength(1)
  expect(register).toHaveBeenCalledTimes(1)
  await discoverProjectSources(h.ctx.extend({}), h.project.id)
  expect(register).toHaveBeenCalledTimes(1)
  await writeFile(join(h.root, 'sources/one.md'), 'Changed revision')
  expect((await discoverProjectSources(h.ctx, h.project.id)).receipts).toHaveLength(1)
  expect(register).toHaveBeenCalledTimes(2)
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
