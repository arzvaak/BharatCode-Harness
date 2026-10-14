import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry, { ProjectKnowledge } from '@deepseek-ai/dsh-workspace'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { extractDocument } from '../src/document-extract.ts'

const recognition = vi.hoisted(() => ({ run: vi.fn(async () => ({ text: 'Scanned evidence', confidence: 93, language: 'eng' })) }))
vi.mock('../src/pdf-ocr.ts', () => ({ recognizePdfPage: recognition.run }))
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); recognition.run.mockClear() })
async function setup(pages = 1, textFirst = false, scannedBody = false) {
  const root = await mkdtemp(join(tmpdir(), 'bc-ocr-'))
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  ctx.provide('sessionPersistence', { list: async () => [] } as never)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(ProjectKnowledge)
  const project = await ctx.workspaceRegistry.create(root)
  // An image-free blank PDF has no text layer, exercising the same fallback as scans.
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] >>`, ...Array.from({ length: pages }, (_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${textFirst && index === 0 ? `/Resources << /Font << /F1 ${pages + 3} 0 R >> >> /Contents ${pages + 4} 0 R` : ''} >>`)]
  if (textFirst) {
    const stream = 'BT /F1 12 Tf 72 700 Td (Native text evidence) Tj ET'
      + (scannedBody ? '\nq 100 0 0 100 72 300 cm BI /W 1 /H 1 /BPC 8 /CS /G ID z EI Q' : '')
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  await writeFile(join(root, 'scan.pdf'), pdf)
  return { ctx, project }
}
it('automatically OCRs textless PDF pages and retains confidence receipts', async () => {
  const h = await setup()
  const result = await extractDocument(h.ctx, h.project.id, 'scan.pdf', new AbortController().signal)
  expect(result.method).toBe('pdf_ocr')
  expect(result.ocrPages).toEqual([{ page: 1, language: 'eng', confidence: 93 }])
  expect(result.omissions).toContain('OCR text may contain recognition errors; figures and visual layout were not extracted')
})
it('allows OCR opt-out without falsely claiming recognition', async () => {
  const h = await setup()
  await expect(extractDocument(h.ctx, h.project.id, 'scan.pdf', new AbortController().signal, 1, 200, { ocr: false })).rejects.toThrow('OCR disabled')
  expect(recognition.run).not.toHaveBeenCalled()
})
it('limits automatic OCR to twenty pages with explicit omissions', async () => {
  const h = await setup(21)
  const result = await extractDocument(h.ctx, h.project.id, 'scan.pdf', new AbortController().signal)
  expect(result.ocrPages).toHaveLength(20)
  expect(result.omissions).toContain('Page 21 OCR omitted: 20-page OCR limit reached; select a later page range')
})

it('preserves native text on mixed PDFs and records paper title and URL', async () => {
  const h = await setup(2, true)
  const result = await extractDocument(h.ctx, h.project.id, 'scan.pdf', new AbortController().signal, 1, 200,
    { title: 'Research paper', sourceUrl: 'https://arxiv.org/pdf/2501.00001' })
  expect(result.method).toBe('pdf_text_and_ocr')
  expect(result.ocrPages).toEqual([{ page: 2, language: 'eng', confidence: 93 }])
  const retained = h.ctx.projectKnowledge.read(result.id)
  expect(retained.title).toBe('Research paper')
  expect(retained.text).toContain('Source URL: https://arxiv.org/pdf/2501.00001')
  expect(retained.text).toContain('Native text evidence')
})

it('preserves sparse native evidence and records failed scanned-body OCR explicitly', async () => {
  const h = await setup(1, true, true)
  recognition.run.mockRejectedValueOnce(new Error('Missing OCR language model'))
  const result = await extractDocument(h.ctx, h.project.id, 'scan.pdf', new AbortController().signal)
  expect(result.method).toBe('pdf_text')
  expect(result.ocrPages).toEqual([])
  expect(result.omissions).toContain('Page 1 OCR failed: Missing OCR language model')
  expect(h.ctx.projectKnowledge.read(result.id).text).toContain('Native text evidence')
})
