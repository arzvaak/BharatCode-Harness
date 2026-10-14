/** Portable OCR of bounded PDF rasters; cached models never modify the source PDF. */
import type { PDFPageProxy } from 'pdfjs-dist'
import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

let queue: Promise<void> = Promise.resolve()
let cached: { language: string; worker: Worker } | undefined
let idle: ReturnType<typeof setTimeout> | undefined

/** Await an operation while honoring cancellation, including model downloads. */
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let cancel: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    cancel = (): void => {
      const reason: unknown = signal.reason
      reject(reason instanceof Error ? reason : new Error(String(reason)))
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
  try { return await Promise.race([operation, aborted]) }
  finally { signal.removeEventListener('abort', cancel) }
}

// This static provider-owned bootstrap gives the host a handle before Tesseract model loading starts.
// Terminating this enclosing worker also terminates its nested Tesseract worker threads.
const workerBootstrap = `
const { parentPort, workerData } = require('node:worker_threads');
const { createWorker, OEM, PSM } = require(workerData.modulePath);
const fail = error => parentPort.postMessage({ type: 'error', message: String(error?.message ?? error) });
(async () => {
  const worker = await createWorker(workerData.language, OEM.LSTM_ONLY, {
    cachePath: workerData.cachePath,
    ...(workerData.langPath === undefined ? {} : { langPath: workerData.langPath }),
    errorHandler: fail,
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '216' });
  parentPort.on('message', async image => {
    try {
      const { data } = await worker.recognize(Buffer.from(image));
      parentPort.postMessage({ type: 'result', text: data.text.trim(), confidence: data.confidence });
    } catch (error) { fail(error); }
  });
  parentPort.postMessage({ type: 'ready' });
})().catch(fail);
`
const require = createRequire(import.meta.url)

/** Wait for the enclosing worker protocol, keeping initialization cancellable. */
async function receive(worker: Worker, expected: 'ready' | 'result', signal: AbortSignal) {
  signal.throwIfAborted()
  return await new Promise<{ text: string; confidence: number }>((resolve, reject) => {
    const cleanup = (): void => {
      worker.off('message', message); worker.off('error', fail); worker.off('exit', exited)
      signal.removeEventListener('abort', cancel)
    }
    const fail = (error: Error): void => { cleanup(); reject(error) }
    const cancel = (): void => {
      const reason: unknown = signal.reason
      fail(reason instanceof Error ? reason : new Error(String(reason)))
    }
    const exited = (code: number): void => { fail(new Error(`OCR worker exited before ${expected} (code ${code})`)) }
    const message = (value: unknown): void => {
      if (typeof value !== 'object' || value === null || !('type' in value)) return
      if (value.type === 'error' && 'message' in value) { fail(new Error(String(value.message))); return }
      if (value.type !== expected) return
      if (expected === 'ready') { cleanup(); resolve({ text: '', confidence: 0 }); return }
      if ('text' in value && typeof value.text === 'string' && 'confidence' in value && typeof value.confidence === 'number') {
        cleanup(); resolve({ text: value.text, confidence: value.confidence })
      } else fail(new Error('Invalid OCR worker response'))
    }
    worker.on('message', message); worker.on('error', fail); worker.on('exit', exited)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

/** Render and recognize one textless page, serializing work to bound native/WASM memory. */
export async function recognizePdfPage(page: PDFPageProxy, inputSignal: AbortSignal, language = 'eng') {
  if (!/^[a-z]{3}(?:_[a-z]+)?(?:\+[a-z]{3}(?:_[a-z]+)?){0,2}$/u.test(language))
    throw new Error('OCR language must contain one to three Tesseract language codes, such as eng or eng+kor')
  inputSignal.throwIfAborted()
  // The deadline includes queueing, model initialization, rendering and recognition.
  const deadline = AbortSignal.timeout(60_000)
  const signal = AbortSignal.any([inputSignal, deadline])
  const previous = queue
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  queue = previous.then(async () => { await gate })
  try { await abortable(previous, signal) } catch (error) { release(); throw error }
  if (idle !== undefined) clearTimeout(idle)
  let active: Worker | undefined
  let stopping: Promise<number> | undefined
  const cancel = (): void => {
    if (active !== undefined) {
      const worker = active
      active = undefined
      if (cached?.worker === worker) cached = undefined
      stopping = worker.terminate().catch(() => 0)
    }
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    const { createCanvas } = await import('@napi-rs/canvas')
    const base = page.getViewport({ scale: 1 })
    if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0)
      throw new Error('Invalid PDF page dimensions for OCR')
    const scale = Math.min(3, 3000 / Math.max(base.width, base.height), Math.sqrt(9_000_000 / (base.width * base.height)))
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)))
    let image: Buffer
    try {
      // PDFjs accepts native canvas contexts at runtime; its public type models DOM canvas.
      const render = page.render({ canvas: null, canvasContext: canvas.getContext('2d') as never, viewport, background: '#ffffff' })
      const stopRender = (): void => { render.cancel() }
      signal.addEventListener('abort', stopRender, { once: true })
      try { await abortable(render.promise, signal) }
      finally { signal.removeEventListener('abort', stopRender) }
      image = canvas.toBuffer('image/png')
    } finally { canvas.width = 1; canvas.height = 1 }
    signal.throwIfAborted()
    if (cached !== undefined && cached.language !== language) {
      const old = cached.worker
      cached = undefined
      await abortable(old.terminate(), signal)
    }
    if (cached === undefined) {
      const cachePath = process.env['BC_OCR_CACHE_PATH'] ?? join(homedir(), '.cache', 'bharatcode', 'ocr')
      const langPath = process.env['BC_OCR_LANG_PATH']
      await mkdir(cachePath, { recursive: true })
      signal.throwIfAborted()
      active = new Worker(workerBootstrap, { eval: true, execArgv: [], workerData: {
        language, cachePath, langPath, modulePath: require.resolve('tesseract.js'),
      } })
      // Keep late errors after a completed request from becoming uncaught host errors.
      active.on('error', () => {})
      const enclosing = active
      enclosing.on('exit', () => { if (cached?.worker === enclosing) cached = undefined })
      await receive(active, 'ready', signal)
      cached = { language, worker: active }
    } else active = cached.worker
    const pending = receive(active, 'result', signal)
    active.postMessage(image)
    const result = await pending
    return { text: result.text, confidence: result.confidence, language }
  } catch (error) {
    cancel()
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    if (stopping !== undefined) await stopping
    if (cached !== undefined) {
      idle = setTimeout(() => {
        const worker = cached?.worker
        cached = undefined
        if (worker !== undefined) void worker.terminate().catch(() => {})
      }, 30_000)
      idle.unref()
    }
    release()
  }
}
