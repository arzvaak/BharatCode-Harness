import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import {
  parseResearchMarkdown,
  resolveResearchLink,
  researchReadingText,
  prepareResearchCitation,
} from '../src/research-markdown.ts'
import { ResearchLibrary } from '../src/research-library.ts'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bc-research-'))
  roots.push(root)
  return root
}
it('parses links and metadata without treating code as knowledge', () => {
  const note = parseResearchMarkdown(
    '---\naliases: [Cell, 电池]\ntags: [energy]\ncustom: keep\n---\n# Battery\n[[Ageing#Heat|Temperature]] and [Paper](../sources/paper.md).\n`[[Fake]]`\n```md\n[[Fake too]]\n```\n![[figure.png]]\n[ref][study]\n[study]: https://example.org/paper',
  )
  expect(note.title).toBe('Battery')
  expect(note.aliases).toEqual(['Cell', '电池'])
  expect(note.tags).toEqual(['energy'])
  expect(note.links.map(link => link.target)).toEqual([
    'Ageing#Heat',
    '../sources/paper.md',
    'figure.png',
    'https://example.org/paper',
  ])
  expect(note.headings).toEqual(['Battery'])
})
it('resolves exact paths, relative Markdown and aliases but preserves ambiguity', () => {
  const notes = ['notes/A.md', 'notes/B.md', 'other/B.md'].map(path => ({
    path,
    ...parseResearchMarkdown('# ' + path.split('/').at(-1) + '\n'),
  }))
  notes[0]!.aliases = ['Alpha']
  expect(resolveResearchLink(notes, 'notes/A.md', { target: 'B', wiki: true })).toMatchObject({
    status: 'ambiguous',
    candidates: ['notes/B.md', 'other/B.md'],
  })
  expect(resolveResearchLink(notes, 'notes/A.md', { target: 'notes/B#Heat', wiki: true })).toMatchObject({
    status: 'resolved',
    path: 'notes/B.md',
    heading: 'Heat',
  })
  expect(resolveResearchLink(notes, 'notes/A.md', { target: 'B.md', wiki: false })).toMatchObject({
    status: 'resolved',
    path: 'notes/B.md',
  })
  expect(resolveResearchLink(notes, 'notes/B.md', { target: 'Alpha', wiki: true })).toMatchObject({
    status: 'resolved',
    path: 'notes/A.md',
  })
  expect(resolveResearchLink(notes, 'notes/A.md', { target: '../../escape.md', wiki: false }).status).toBe('invalid')
})
it('converts only real wikilinks for reading and allocates portable citations', () => {
  expect(researchReadingText('[[Cell|Battery]] `[[Code]]`\n```\n[[Code]]\n```')).toContain(
    '[Battery](research-wiki/Cell)',
  )
  expect(researchReadingText('`[[Code]]`')).toBe('`[[Code]]`')
  const result = prepareResearchCitation('Existing[^source-1]\n\n[^source-1]: old', {
    id: 'abc',
    title: 'Paper',
    url: 'https://example.org/paper',
    quote: 'A useful claim',
    start: 0,
    end: 14,
  })
  expect(result).toContain('[^source-2]')
  expect(result).toContain('https://example.org/paper')
  expect(result).toContain('research-citation:abc:0:14')
})
it('discovers a vault unchanged, refreshes external edits, excludes metadata and rejects unsafe creation', async () => {
  const root = await fixture()
  await mkdir(join(root, '.obsidian'))
  await mkdir(join(root, 'notes'))
  await writeFile(join(root, '.obsidian/config.json'), '{"keep":true}')
  await writeFile(join(root, 'notes/A.md'), '# A\n[[B]]')
  await writeFile(join(root, 'notes/B.md'), '# B')
  const lib = new ResearchLibrary(root)
  expect((await lib.list()).notes.map(n => n.path)).toEqual(['notes/A.md', 'notes/B.md'])
  expect((await lib.inspect('notes/B.md')).backlinks.map(n => n.path)).toEqual(['notes/A.md'])
  await writeFile(join(root, 'notes/B.md'), '# Externally changed')
  expect((await lib.list('Externally')).notes[0]?.title).toBe('Externally changed')
  await expect(lib.create('../bad.md', 'Bad')).rejects.toThrow()
  await expect(lib.create('notes/A.md', 'Overwrite')).rejects.toThrow()
  const outside = await fixture()
  await symlink(outside, join(root, 'escape'))
  await expect(lib.create('escape/bad.md', 'Bad')).rejects.toThrow()
  await lib.create('notes/새 노트.md', '새 노트')
  expect(await readFile(join(root, '.obsidian/config.json'), 'utf8')).toBe('{"keep":true}')
  expect(await readFile(join(root, 'notes/A.md'), 'utf8')).toBe('# A\n[[B]]')
})
it('bounds discovery, paginates deterministically and exports readable resources with omissions', async () => {
  const root = await fixture()
  await mkdir(join(root, 'notes'))
  await mkdir(join(root, 'attachments'))
  await writeFile(join(root, 'notes/A.md'), '# A\n![Figure](../attachments/figure.png)\n[[B]]\n[Missing](gone.pdf)')
  await writeFile(join(root, 'notes/B.md'), '# B\n[Run](../study.ipynb)')
  await writeFile(join(root, 'attachments/figure.png'), new Uint8Array([137, 80, 78, 71]))
  await writeFile(join(root, 'study.ipynb'), '{"cells":[]}')
  const lib = new ResearchLibrary(root, { pageSize: 1 })
  const first = await lib.list()
  expect(first.notes).toHaveLength(1)
  expect(first.cursor).toBeTruthy()
  expect((await lib.list('', first.cursor)).notes[0]?.path).toBe('notes/B.md')
  const exported = await lib.exportVault([])
  const files = unzipSync(exported.bytes)
  expect(strFromU8(files['notes/A.md']!)).toContain('[[B]]')
  expect(files['attachments/figure.png']).toEqual(new Uint8Array([137, 80, 78, 71]))
  expect(strFromU8(files['study.ipynb']!)).toBe('{"cells":[]}')
  expect(exported.issues.join(' ')).toContain('gone.pdf')
  const bounded = await new ResearchLibrary(root, { maxFiles: 1 }).list()
  expect(bounded.issues.join(' ')).toContain('limit')
})
it('keeps wikilink-looking labels within Markdown links from creating overlapping replacements', () => {
  const text = '[ [[A]] ](B.md)'
  expect(parseResearchMarkdown(text).links.map(link => link.target)).toEqual(['B.md'])
  expect(researchReadingText(text)).not.toContain('research-wiki/A')
})
it('keeps multiple citation references outside footnote definitions', () => {
  const cite = (id: string) => ({ id, title: id, url: `sources/captured/${id}.md`, quote: 'Q', start: 0, end: 1 })
  const once = prepareResearchCitation('# Note\n\nFinding', cite('one'))
  const twice = prepareResearchCitation(once, cite('two'))
  expect(twice.indexOf('[^source-2]')).toBeLessThan(twice.indexOf('[^source-1]:'))
  expect(twice).not.toContain('-->[^source-2]')
})
it('resolves percent-encoded filename hashes and refuses duplicate basenames even at the vault root', () => {
  const notes = ['A#B.md', 'Foo.md', 'folder/Foo.md'].map(path => ({ path, ...parseResearchMarkdown('# Note') }))
  expect(resolveResearchLink(notes, 'Home.md', { target: 'A%23B.md', wiki: false })).toMatchObject({ status: 'resolved', path: 'A#B.md' })
  expect(resolveResearchLink(notes, 'Home.md', { target: 'Foo', wiki: true }).status).toBe('ambiguous')
})
it('hides recoverable citation locators in reading mode while keeping literal code unchanged', () => {
  const text = prepareResearchCitation('# Note\n\nFinding', { id: 'source', title: 'Study', url: 'sources/Study.md', quote: 'Evidence', start: 0, end: 8 })
  expect(researchReadingText(text)).not.toContain('research-citation:')
  expect(researchReadingText('`<!-- research-citation:source:0:8 -->`')).toContain('research-citation:')
})
it('preserves trailing quotation newlines and discovers figures inside Markdown links', async () => {
  const { researchCitationMarkers } = await import('../src/research-markdown.ts')
  const text = prepareResearchCitation('# Note', { id: 'source', title: 'Study', url: 'study.md', quote: 'first\n', start: 0, end: 6 })
  expect(researchCitationMarkers(text)[0]?.quotedText).toBe('first\n')
  const linked = '[![Figure](attachments/a.png)](B.md)'
  expect(parseResearchMarkdown(linked).links.map(link => link.target)).toEqual(['B.md', 'attachments/a.png'])
  expect(researchReadingText(linked)).toContain('![Figure](attachments/a.png)')
})
