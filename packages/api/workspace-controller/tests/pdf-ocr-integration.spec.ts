/** Opt-in integration uses native PDF rendering and the actual WASM recognition model. */
import { afterEach, expect, it } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry, { ProjectKnowledge } from '@deepseek-ai/dsh-workspace'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { extractDocument } from '../src/document-extract.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanups.splice(0)) await fn() })
function scannedPdf(nativeHeader = '') {
  const canvas = createCanvas(1800, 1200)
  const context = canvas.getContext('2d')
  context.fillStyle = 'white'; context.fillRect(0, 0, 1800, 1200)
  context.fillStyle = 'black'; context.font = '52px sans-serif'
  context.fillText('SCANNED RESEARCH PAPER', 100, 160)
  context.font = '40px sans-serif'
  context.fillText('Native OCR captures full paper evidence.', 100, 270)
  context.fillText('The measured sample contains 42 observations.', 100, 350)
  const image = canvas.toBuffer('image/jpeg')
  const content = `q 600 0 0 400 0 0 cm /Scan Do Q${nativeHeader === '' ? '' : ` BT /F1 12 Tf 20 380 Td (${nativeHeader}) Tj ET`}`
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 6 0 R >> /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1800 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`), image, Buffer.from('\nendstream')]),
    Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')]
  const chunks = [Buffer.from('%PDF-1.4\n')]; const offsets = [0]; let length = chunks[0]?.length ?? 0
  objects.forEach((object, index) => {
    offsets.push(length)
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')])
    chunks.push(chunk); length += chunk.length
  })
  chunks.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`))
  return Buffer.concat(chunks)
}
it.skipIf(process.env['BC_TEST_REAL_OCR'] !== '1').each(['', 'Page 1'])('recognizes scanned bodies with native header %j and captures immutable receipts', async (nativeHeader) => {
  const root = await mkdtemp(join(tmpdir(), 'bc-real-ocr-'))
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  ctx.provide('sessionPersistence', { list: async () => [] } as never)
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(ProjectKnowledge)
  const project = await ctx.workspaceRegistry.create(root)
  const original = scannedPdf(nativeHeader)
  await writeFile(join(root, 'scan.pdf'), original)
  const task = getDocument({ data: new Uint8Array(original) })
  try {
    const pdf = await task.promise
    expect((await (await pdf.getPage(1)).getTextContent()).items.length).toBe(nativeHeader === '' ? 0 : 1)
  } finally { await task.destroy() }
  const result = await extractDocument(ctx, project.id, 'scan.pdf', new AbortController().signal)
  expect(result.method).toBe(nativeHeader === '' ? 'pdf_ocr' : 'pdf_text_and_ocr')
  expect(result.ocrPages[0]?.language).toBe('eng')
  expect(result.ocrPages[0]?.confidence).toBeGreaterThan(70)
  const captured = ctx.projectKnowledge.read(result.id)
  expect(captured.text).toContain('SCANNED RESEARCH PAPER')
  expect(captured.text).toContain('42 observations')
  expect(captured.text).toContain(`SHA-256: ${result.inputDigest}`)
  expect(captured.text).toContain('## Page 1')
  expect(await readFile(join(root, 'scan.pdf'))).toEqual(original)
}, 90_000)

it.skipIf(process.env['BC_TEST_REAL_OCR'] !== '1')('stops missing-model initialization and its nested worker so a CLI exits naturally', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'bc-ocr-missing-'))
  cleanups.push(async () => { await rm(cache, { recursive: true, force: true }) })
  const source = fileURLToPath(new URL('../src/pdf-ocr.ts', import.meta.url))
  const code = `(async () => {
    const { recognizePdfPage } = await import(${JSON.stringify(source)});
    const page = { getViewport: ({scale}) => ({width:100*scale,height:100*scale}),
      render: () => ({promise:Promise.resolve(),cancel(){}}) };
    try { await recognizePdfPage(page, AbortSignal.timeout(1000), 'zzz'); }
    catch(error) { console.log('MISSING_MODEL_STOPPED', error.message); }
  })().catch(error => { console.error(error); process.exitCode = 1; });`
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '-e', code], {
    cwd: process.cwd(), timeout: 5000, env: { ...process.env, BC_OCR_LANG_PATH: cache, BC_OCR_CACHE_PATH: cache },
  })
  expect(result.stdout).toContain('MISSING_MODEL_STOPPED')
  expect(result.stdout).toContain('ENOENT')
}, 10_000)
it.skipIf(process.env['BC_TEST_REAL_OCR'] !== '1')('terminates a stalled real model download and nested network handles', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'bc-ocr-stalled-'))
  cleanups.push(async () => { await rm(cache, { recursive: true, force: true }) })
  const source = fileURLToPath(new URL('../src/pdf-ocr.ts', import.meta.url))
  const code = `(async () => {
    const { createServer } = await import('node:http');
    const { recognizePdfPage } = await import(${JSON.stringify(source)});
    const controller = new AbortController();
    const server = createServer(() => {
      console.log('MODEL_REQUEST_STALLED');
      setTimeout(() => controller.abort(new Error('stalled model deadline')), 30);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    process.env.BC_OCR_LANG_PATH = 'http://127.0.0.1:' + server.address().port;
    const guard = setTimeout(() => controller.abort(new Error('model request never started')), 3000);
    const page = { getViewport: ({scale}) => ({width:100*scale,height:100*scale}),
      render: () => ({promise:Promise.resolve(),cancel(){}}) };
    try { await recognizePdfPage(page, controller.signal, 'zzz'); }
    catch(error) { console.log('STALLED_MODEL_STOPPED', error.message); }
    clearTimeout(guard);
    await new Promise(resolve => server.close(resolve));
  })().catch(error => { console.error(error); process.exitCode = 1; });`
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '-e', code], {
    cwd: process.cwd(), timeout: 5000, env: { ...process.env, BC_OCR_CACHE_PATH: cache },
  })
  expect(result.stdout).toContain('MODEL_REQUEST_STALLED')
  expect(result.stdout).toContain('STALLED_MODEL_STOPPED stalled model deadline')
}, 10_000)
