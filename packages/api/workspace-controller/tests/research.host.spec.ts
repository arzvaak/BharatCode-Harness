import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry, { ProjectKnowledge } from '@deepseek-ai/dsh-workspace'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { prepareResearchCitation } from '../../../workspace/workspace/src/research-markdown.ts'
import { ResearchOperations } from '../src/research.ts'
import { unzipSync, strFromU8 } from 'fflate'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'bc-research-host-'))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  ctx.provide('sessionPersistence', { list: async () => [] } as never)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(ProjectKnowledge)
  const project = await ctx.workspaceRegistry.create(root)
  return { root, ctx, project, ops: new ResearchOperations(ctx) }
}
it('captures note citations against exact source revisions, retries idempotently and exports source copies', async () => {
  const h = await setup()
  const source = await h.ctx.projectKnowledge.captureText({
    projectId: h.project.id,
    identity: 'https://example.org/paper',
    title: 'Paper',
    text: 'Exact evidence.',
    kind: 'source',
  })
  await h.ops.create(h.project.id, 'notes/A.md', 'A')
  const text = prepareResearchCitation('# A\nA finding', {
    id: source.id,
    title: source.title,
    url: '../sources/captured/' + source.id + '.md',
    quote: source.text,
    start: 0,
    end: source.text.length,
  })
  await writeFile(join(h.root, 'notes/A.md'), text)
  const result = await h.ops.captureCitations(h.project.id, 'notes/A.md', text)
  expect(result.issues).toEqual([])
  expect(result.linked).toBe(1)
  expect((await h.ops.captureCitations(h.project.id, 'notes/A.md', text)).artifact.id).toBe(result.artifact.id)
  expect(h.ctx.projectKnowledge.related(result.artifact.id)).toHaveLength(1)
  expect(h.ctx.projectKnowledge.related(result.artifact.id)[0]?.passage?.quote).toBe('Exact evidence.')
  const zip = await h.ops.export(h.project.id)
  const files = unzipSync(Buffer.from(zip.base64, 'base64'))
  expect(strFromU8(files['sources/captured/' + source.id + '.md']!)).toContain('Exact evidence.')
  expect(strFromU8(files['notes/A.md']!)).toContain('../sources/captured/')
  expect(zip.issues).toEqual([])
  await writeFile(join(h.root, 'notes/A.md'), '# external change')
  await expect(h.ops.captureCitations(h.project.id, 'notes/A.md', text)).rejects.toThrow('changed')
  expect(await readFile(join(h.root, 'notes/A.md'), 'utf8')).toBe('# external change')
})
it('reports incomplete citations without losing saved text and rejects unverified passages', async () => {
  const h = await setup()
  await h.ops.create(h.project.id, 'A.md', 'A')
  const text = prepareResearchCitation('# A', {
    id: 'missing',
    title: 'Missing source',
    url: 'sources/captured/missing.md',
    quote: 'Fake',
    start: 0,
    end: 4,
  })
  await writeFile(join(h.root, 'A.md'), text)
  expect((await h.ops.captureCitations(h.project.id, 'A.md', text)).issues.join()).toContain('missing')
  expect(await readFile(join(h.root, 'A.md'), 'utf8')).toBe(text)
  const source = await h.ctx.projectKnowledge.captureText({
    projectId: h.project.id,
    identity: 'test',
    title: 'Paper',
    text: 'Real',
    kind: 'source',
  })
  const forged = text.replaceAll('missing', source.id)
  await writeFile(join(h.root, 'A.md'), forged)
  expect((await h.ops.captureCitations(h.project.id, 'A.md', forged)).issues.join()).toContain('quote')
})
it('does not admit notes merely by indexing and rejects unregistered or escaping project requests', async () => {
  const h = await setup()
  await writeFile(join(h.root, 'Private.md'), '# Private')
  expect((await h.ops.list(h.project.id)).total).toBe(1)
  expect(h.ctx.projectKnowledge.search({ projectId: h.project.id, query: '' }).hits).toHaveLength(0)
  await expect(h.ops.list('unknown' as never)).rejects.toThrow('Unknown')
  await expect(h.ops.create(h.project.id, '../escape.md', 'Escape')).rejects.toThrow()
})
it('does not verify a quotation merely because it appears in the source title', async () => {
  const h = await setup()
  const source = await h.ctx.projectKnowledge.captureText({
    projectId: h.project.id,
    identity: 'title-confusion',
    title: 'Real',
    text: 'Real',
    kind: 'source',
  })
  const text = prepareResearchCitation('# Note', {
    id: source.id,
    title: 'Real',
    url: 'sources/captured/' + source.id + '.md',
    quote: 'Wrong',
    start: 0,
    end: 4,
  })
  await writeFile(join(h.root, 'Note.md'), text)
  const receipt = await h.ops.captureCitations(h.project.id, 'Note.md', text)
  expect(receipt.linked).toBe(0)
  expect(receipt.issues.join()).toContain('quote')
})
it('exports later available sources even when an earlier citation is missing', async () => {
  const h = await setup()
  const source = await h.ctx.projectKnowledge.captureText({ projectId: h.project.id, identity: 'available', title: 'Available', text: 'Good source', kind: 'source' })
  let text = prepareResearchCitation('# Note\n\nFinding', { id: 'missing', title: 'Missing', url: 'sources/captured/missing.md', quote: 'Missing', start: 0, end: 7 })
  text = prepareResearchCitation(text, { id: source.id, title: source.title, url: 'sources/captured/' + source.id + '.md', quote: source.text, start: 0, end: source.text.length })
  await writeFile(join(h.root, 'Note.md'), text)
  const result = await h.ops.export(h.project.id)
  const files = unzipSync(Buffer.from(result.base64, 'base64'))
  expect(strFromU8(files['sources/captured/' + source.id + '.md']!)).toBe(source.text)
  expect(result.issues.join()).toContain('missing')
})
