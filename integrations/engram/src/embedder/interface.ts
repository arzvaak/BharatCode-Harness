/**
 * Replaceable embedding provider interface; implementations handle pooling and normalization.
 * @module @kenz1117/dsh-engram/embedder/interface
 */

/** Embedding provider contract. */
export interface EngramEmbedder {
  /**
   * Embed a batch; implementations may split it into smaller batches internally.
   * @param texts - Texts to embed.
   * @returns Normalized vectors in input order (384 dimensions for the default English model).
   */
  embed(texts: readonly string[]): Promise<Float32Array[]>
  /** Model identifier included in diagnostics. */
  readonly model: string
  /** Release implementation resources and singleton caches for test isolation. */
  close(): Promise<void>
}
