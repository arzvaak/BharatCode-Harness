#!/usr/bin/env node
/**
 * Backfill missing embeddings for active memories after the local model is available.
 * Usage: node scripts/backfill-embeddings.mjs [dbDir]
 * Defaults to ~/.dsh/engram and only updates active rows with NULL embeddings.
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pipeline, env } from '@huggingface/transformers'

const dbDir = process.argv[2] ?? join(homedir(), '.dsh', 'engram')
const modelCacheDir = join(dbDir, 'models')
const MODEL_ID = 'onnx-community/granite-embedding-small-english-r2-ONNX'
const EXPECTED_DIMENSIONS = 384

const dbs = (existsSync(dbDir) ? readdirSync(dbDir, { withFileTypes: true }) : [])
  .filter(entry => entry.isFile() && (entry.name === 'user.db' || /^project-[a-f0-9]{24}\.db$/.test(entry.name)))
  .map(entry => join(dbDir, entry.name))
  .filter(path => {
    try {
      const db = new DatabaseSync(path, { readOnly: true })
      db.close()
      return true
    } catch {
      return false
    }
  })
if (dbs.length === 0) {
  console.log('[backfill] No memory databases found; nothing to backfill.')
  process.exit(0)
}

env.cacheDir = modelCacheDir
// Override the download endpoint via HF_ENDPOINT (for a mirror); the cached model requires no network access.
if (process.env.HF_ENDPOINT) env.remoteHost = process.env.HF_ENDPOINT
const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })
const embed = async text => {
  const output = await extractor([text], { pooling: 'mean', normalize: true })
  const vector = new Float32Array(output.tolist()[0])
  if (vector.length !== EXPECTED_DIMENSIONS) throw new Error(`${MODEL_ID} returned ${vector.length} dimensions; expected ${EXPECTED_DIMENSIONS}.`)
  return vector
}

let patched = 0
for (const path of dbs) {
  const db = new DatabaseSync(path)
  const rows = db.prepare("SELECT id, content FROM nodes WHERE status = 'active' AND embedding IS NULL").all()
  if (rows.length === 0) {
    console.log(`[backfill] ${path}: No entries with missing embeddings.`)
    db.close()
    continue
  }
  const prepared = []
  for (const row of rows) prepared.push({ row, vector: await embed(row.content) })
  const update = db.prepare('UPDATE nodes SET embedding = ? WHERE id = ? AND content = ? AND embedding IS NULL')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const { row, vector } of prepared) {
      const changes = update.run(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength), row.id, row.content).changes
      patched += Number(changes)
      if (changes > 0) console.log(`[backfill] ${path}: ${row.content.slice(0, 24)}… ✓`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    throw error
  }
  db.close()
}
console.log(`[backfill] Complete: backfilled ${patched} embeddings in total.`)
