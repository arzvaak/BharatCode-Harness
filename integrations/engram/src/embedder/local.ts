/**
 * Local transformers.js embedding implementation: onnx-community/granite-embedding-small-english-r2-ONNX, quantized weights (q8), offline inference.
 * The model is downloaded over the network on first use to cacheDir; all later runs are fully offline and data stays on the device.
 * @module @kenz1117/dsh-engram/embedder/local
 */

import { mkdir } from 'node:fs/promises'
import { EngramError } from '../types.ts'
import type { EngramEmbedder } from './interface.ts'

/** Model identifier (English Granite model, 384-dimensional output). */
export const ENGRAM_MODEL_ID = 'onnx-community/granite-embedding-small-english-r2-ONNX'

/** Process-wide singleton: repeated createLocalEmbedder calls share one model instance to avoid reloading weights. */
let cached: { dir: string; embedder: EngramEmbedder } | undefined

/**
 * Create a local embedder.
 * @param cacheDir - Model cache directory; created automatically if missing (0o700).
 * @param remoteHost - Model download endpoint; defaults to huggingface.co; a mirror can be configured for network-restricted environments (e.g. https://hf-mirror.com).
 * @returns Ready-to-use EngramEmbedder.
 * @throws EngramError(code=EMBEDDER_DOWNLOAD_FAILED) if model download/loading fails (the caller falls back accordingly).
 */
export async function createLocalEmbedder(cacheDir: string, remoteHost?: string): Promise<EngramEmbedder> {
  if (cached?.dir === cacheDir) return cached.embedder
  await mkdir(cacheDir, { recursive: true, mode: 0o700 })
  try {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = cacheDir
    if (remoteHost !== undefined && remoteHost !== '') env.remoteHost = remoteHost
    const extractor = await pipeline('feature-extraction', ENGRAM_MODEL_ID, { dtype: 'q8' })
    const embedder: EngramEmbedder = {
      model: ENGRAM_MODEL_ID,
      async embed(texts) {
        if (texts.length === 0) return []
        const output = await extractor([...texts], { pooling: 'mean', normalize: true })
        const lists = output.tolist() as number[][]
        return lists.map(list => {
          if (list.length !== 384) {
            throw new EngramError('EMBEDDING_DIMENSION_MISMATCH', `${ENGRAM_MODEL_ID} returned ${list.length} dimensions; expected 384.`)
          }
          return new Float32Array(list)
        })
      },
      // The module-level cached value owns the pipeline; close only releases this instance’s reference and does not destroy shared weights.
      close: async () => {
        if (cached?.embedder === embedder) cached = undefined
      },
    }
    cached = { dir: cacheDir, embedder }
    return embedder
  } catch (error) {
    throw new EngramError('EMBEDDER_DOWNLOAD_FAILED', 'Embedding model download/loading failed; retrieval has fallen back to keyword-only mode. Check the network and retry.', { cause: error })
  }
}
