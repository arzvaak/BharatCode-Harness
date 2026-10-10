import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalEmbedder, ENGRAM_MODEL_ID } from '../src/embedder/local.ts'

// Explicit opt-in must fail on download errors rather than silently skip.
describe.runIf(process.env.ENGRAM_E2E === '1')('createLocalEmbedder (English model download)', () => {
  it('downloads Granite and produces normalized 384-dimensional semantic vectors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'engram-model-'))
    const embedder = await createLocalEmbedder(dir, process.env.HF_ENDPOINT)
    try {
      expect(embedder.model).toBe('onnx-community/granite-embedding-small-english-r2-ONNX')
      expect(embedder.model).toBe(ENGRAM_MODEL_ID)
      const vectors = await embedder.embed([
        'The weather is sunny and pleasant today.',
        'It is a bright sunny day, perfect for a walk outside.',
        'The derivative of the sine function is the cosine function.',
      ])
      expect(vectors).toHaveLength(3)
      for (const vector of vectors) {
        expect(vector.length).toBe(384)
        expect(Array.from(vector).every(Number.isFinite)).toBe(true)
        expect(Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))).toBeCloseTo(1, 4)
      }
      const dot = (a: Float32Array, b: Float32Array): number =>
        a.reduce((sum, v, i) => sum + v * b[i]!, 0)
      expect(dot(vectors[0]!, vectors[1]!)).toBeGreaterThan(dot(vectors[0]!, vectors[2]!))
      expect(await embedder.embed([])).toEqual([])
    } finally {
      await embedder.close()
    }
  }, 300_000)
})
