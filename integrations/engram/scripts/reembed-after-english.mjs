#!/usr/bin/env node
/** Preview missing or wrong-dimension vectors; --apply --maintenance-window backs up databases before re-embedding. */
import { DatabaseSync } from 'node:sqlite'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const MODEL_ID = 'onnx-community/granite-embedding-small-english-r2-ONNX'
const EXPECTED_DIMENSIONS = 384
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const maintenanceWindow = args.includes('--maintenance-window')
const offline = args.includes('--offline')
const positional = args.filter(arg => arg !== '--apply' && arg !== '--maintenance-window' && arg !== '--offline')
if (positional.length > 1) throw new Error('Usage: reembed-after-english.mjs [dbDir] [--apply --maintenance-window] [--offline]')
if (apply && !maintenanceWindow) throw new Error('Stop all Engram hosts before re-embedding, then pass --apply --maintenance-window.')
const dbDir = positional[0] ?? join(homedir(), '.dsh', 'engram')
const dbPaths = readdirSync(dbDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && (entry.name === 'user.db' || /^project-[a-f0-9]{24}\.db$/.test(entry.name)))
  .map(entry => join(dbDir, entry.name))
if (dbPaths.length === 0) {
  console.log(`[reembed] No database files found in ${dbDir}.`)
  process.exit(0)
}

const expectedBytes = EXPECTED_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT
const pending = []
for (const path of dbPaths) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN embedding IS NULL OR length(embedding) != ? THEN 1 ELSE 0 END) AS stale FROM nodes').get(expectedBytes)
    pending.push({ path, total: Number(row.total), stale: Number(row.stale ?? 0) })
  } finally {
    db.close()
  }
}

for (const item of pending) console.log(`[reembed] ${basename(item.path)}: ${item.stale}/${item.total} vectors need ${EXPECTED_DIMENSIONS}-dimension embeddings.`)
console.log('[reembed] This check validates vector size only; databases do not record embedding model identity.')
const staleRows = pending.reduce((sum, item) => sum + item.stale, 0)
if (staleRows === 0) {
  console.log(`[reembed] All stored vectors have the expected ${EXPECTED_DIMENSIONS}-dimension size. No changes made.`)
  process.exit(0)
}
if (!apply) {
  console.log('[reembed] Preview only. Stop all Engram hosts, then rerun with --apply --maintenance-window to back up and re-embed these rows.')
  process.exit(0)
}

// Load this dependency only when explicitly writing; preview needs no model or network.
const { DatabaseSync: WritableDatabaseSync, backup } = await import('node:sqlite')
const { pipeline, env } = await import('@huggingface/transformers')
env.cacheDir = join(dbDir, 'models')
if (offline) env.allowRemoteModels = false
if (process.env.HF_ENDPOINT) env.remoteHost = process.env.HF_ENDPOINT
const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8', local_files_only: offline })
const embed = async text => {
  const output = await extractor([text], { pooling: 'mean', normalize: true })
  const vector = new Float32Array(output.tolist()[0])
  if (vector.length !== EXPECTED_DIMENSIONS) throw new Error(`${MODEL_ID} returned ${vector.length} dimensions; expected ${EXPECTED_DIMENSIONS}.`)
  return vector
}

const backupDir = join(dbDir, `backup-before-granite-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`)
mkdirSync(backupDir, { mode: 0o700 })
for (const path of dbPaths) {
  const db = new WritableDatabaseSync(path, { readOnly: true })
  try {
    await backup(db, join(backupDir, basename(path)))
  } finally {
    db.close()
  }
}
console.log(`[reembed] Database backups saved to ${backupDir}`)

let patched = 0
for (const { path } of pending) {
  const db = new WritableDatabaseSync(path)
  try {
    const rows = db.prepare('SELECT id, content FROM nodes WHERE embedding IS NULL OR length(embedding) != ?').all(expectedBytes)
    const prepared = []
    for (const row of rows) prepared.push({ row, vector: await embed(row.content) })
    if (prepared.length === 0) continue
    const update = db.prepare('UPDATE nodes SET embedding = ? WHERE id = ? AND content = ? AND (embedding IS NULL OR length(embedding) != ?)')
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const { row, vector } of prepared) {
        patched += Number(update.run(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength), row.id, row.content, expectedBytes).changes)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  } finally {
    db.close()
  }
}
console.log(`[reembed] Updated ${patched} vectors with ${MODEL_ID}.`)
