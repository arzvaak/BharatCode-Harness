import { afterEach, expect, it, vi } from 'vitest'
import { recognizePdfPage } from '../src/pdf-ocr.ts'
import type { PDFPageProxy } from 'pdfjs-dist'
const worker = vi.hoisted(() => ({
  recognize: vi.fn(async () => ({ data: { text: ' recognized ', confidence: 88 } })),
  terminate: vi.fn(async () => {}), setParameters: vi.fn(async () => {}),
  size: { width: 0, height: 0 },
}))
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  return { Worker: class extends EventEmitter {
    stopped = false
    constructor() { super(); queueMicrotask(() => { this.emit('message', { type: 'ready' }) }) }
    postMessage() {
      void worker.recognize().then((result) => {
        if (!this.stopped) this.emit('message', { type: 'result', text: result.data.text.trim(), confidence: result.data.confidence })
      }).catch((error: unknown) => this.emit('error', error))
    }
    async terminate() { this.stopped = true; return 1 }
  } }
})
vi.mock('@napi-rs/canvas', () => ({ createCanvas: (width: number, height: number) => {
  worker.size = { width, height }
  return { width, height, getContext: () => ({}), toBuffer: () => Buffer.from('raster') }
} }))
afterEach(() => { vi.restoreAllMocks(); worker.recognize.mockReset().mockResolvedValue({ data: { text: ' recognized ', confidence: 88 } }) })
function page(width = 612, height = 792) {
  return { getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }) } as unknown as PDFPageProxy
}
it('rejects path-like or excessive language selections before model access', async () => {
  for (const language of ['../../eng', 'eng/kor', 'eng+kor+fra+deu'])
    await expect(recognizePdfPage(page(), new AbortController().signal, language)).rejects.toThrow('OCR language')
})
it('caps raster dimensions and returns explicit language and confidence', async () => {
  const result = await recognizePdfPage(page(100_000, 100_000), new AbortController().signal)
  expect(result).toEqual({ text: 'recognized', language: 'eng', confidence: 88 })
  expect(worker.size).toEqual({ width: 3000, height: 3000 })
})
it('cancels active recognition and releases the worker queue for the next page', async () => {
  const controller = new AbortController()
  worker.recognize.mockImplementationOnce(async () => { controller.abort(new Error('cancel OCR')); return await new Promise<never>(() => {}) })
  await expect(recognizePdfPage(page(), controller.signal)).rejects.toThrow('cancel OCR')
  expect(await recognizePdfPage(page(), new AbortController().signal)).toMatchObject({ text: 'recognized' })
})
it('rejects already aborted extraction before native rendering', async () => {
  const controller = new AbortController(); controller.abort(new Error('pre-cancel'))
  await expect(recognizePdfPage(page(), controller.signal)).rejects.toThrow('pre-cancel')
})
it('honors the per-page deadline during recognition', async () => {
  const deadline = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal)
  worker.recognize.mockImplementationOnce(async () => {
    deadline.abort(new DOMException('OCR page deadline', 'TimeoutError'))
    return await new Promise<never>(() => {})
  })
  await expect(recognizePdfPage(page(), new AbortController().signal)).rejects.toThrow('OCR page deadline')
})
it('cancels PDF rendering when extraction is aborted', async () => {
  const controller = new AbortController()
  let cancelled = false
  const renderingPage = { getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }), render: () => {
    void Promise.resolve().then(() => { controller.abort(new Error('cancel raster')) })
    return { promise: new Promise<never>(() => {}), cancel: () => { cancelled = true } }
  } } as unknown as PDFPageProxy
  await expect(recognizePdfPage(renderingPage, controller.signal)).rejects.toThrow('cancel raster')
  expect(cancelled).toBe(true)
})
