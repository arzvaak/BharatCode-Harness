/**
 * Back up user/project databases and metadata into one .tar.gz archive.
 * Restore checks _meta.json schema compatibility and preserves current databases as .before-restore-<ts>.
 * Design principles:
 * 1. Archive entries use relative database names and _meta.json, avoiding absolute-path disclosure.
 * 2. Metadata schema compatibility is checked explicitly before replacing databases.
 * 3. Failed preflight validation leaves existing databases untouched.
 * @module @kenz1117/dsh-engram/backup/tar
 */

import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzip, createGzip } from 'node:zlib'
import { promisify } from 'node:util'
import { createTarPack, endTarPack, extractTar } from './tar-stream.ts'
import type { EngramScope } from '../types.ts'

const gunzipAsync = promisify<Buffer, Buffer>(gunzip)

/** Independent archive-metadata schema version, decoupled from database schema upgrades. */
export const BACKUP_SCHEMA_VERSION = 1

/** Backup metadata serialized in _meta.json. */
export interface BackupMeta {
  readonly schemaVersion: number
  readonly pluginVersion: string
  readonly exportedAt: number
  readonly scopes: readonly { readonly scope: EngramScope; readonly recordCount: number; readonly edgeCount: number }[]
}

export interface BackupResult {
  readonly archivePath: string
  readonly meta: BackupMeta
  readonly bytes: number
}

/**
 * Archive all database files in dbDir together with _meta.json.
 * @param dbDir - Plugin data directory containing user.db and project databases.
 * @param pluginVersion - Plugin version recorded in metadata, matching package.json.
 */
export async function createBackup(dbDir: string, pluginVersion: string): Promise<BackupResult> {
  await mkdir(dbDir, { recursive: true, mode: 0o700 })
  const files = (await readdir(dbDir)).filter(name => name.endsWith('.db'))
  // Build a mutable local array exposed through the readonly BackupMeta['scopes'] contract.
  const scopes: { scope: EngramScope; recordCount: number; edgeCount: number }[] = []
  const entries: { name: string; data: Buffer }[] = []
  for (const name of files) {
    const path = join(dbDir, name)
    const statResult = await stat(path)
    if (!statResult.isFile()) continue
    entries.push({ name, data: await readFileBuffer(path) })
    // Record file scope without querying record counts; restored stores can be inspected separately.
    scopes.push({ scope: name === 'user.db' ? 'user' : 'project', recordCount: 0, edgeCount: 0 })
  }
  const meta: BackupMeta = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    pluginVersion,
    exportedAt: Date.now(),
    scopes,
  }
  entries.push({ name: '_meta.json', data: Buffer.from(JSON.stringify(meta, null, 2), 'utf8') })
  const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
  const archivePath = join(dbDir, `palace-backup-${stamp}.tar.gz`)
  await writeTarGz(archivePath, entries)
  return { archivePath, meta, bytes: (await stat(archivePath)).size }
}

/** Read a small backup file asynchronously into a Buffer. */
async function readFileBuffer(path: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises')
  return readFile(path)
}

/**
 * Write archive entries with the built-in tar implementation and zlib.createGzip.
 */
async function writeTarGz(outPath: string, entries: ReadonlyArray<{ name: string; data: Buffer }>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const sink = createWriteStream(outPath, { mode: 0o600 })
    sink.on('error', reject)
    sink.on('finish', () => resolve())
    const gz = createGzip()
    gz.on('error', reject)
    gz.pipe(sink)
    for (const entry of entries) createTarPack(gz, entry.name, entry.data)
    endTarPack(gz)
    gz.end()
  })
}

/** Preserve current databases as .before-restore-<ts> before replacement; enabled by default. */
export interface RestoreOptions {
  readonly keepCurrent?: boolean
}

/** Restore result summary. */
export interface RestoreResult {
  readonly restored: readonly string[]
  readonly archiveMeta: BackupMeta
}

/**
 * Extract into a temporary directory, validate metadata, then move databases into dbDir.
 * Preflight validation failures throw without changing existing databases.
 */
export async function restoreBackup(archivePath: string, dbDir: string, options: RestoreOptions = {}): Promise<RestoreResult> {
  const tempDir = join(dbDir, `.restore-tmp-${Date.now()}`)
  await mkdir(tempDir, { recursive: true, mode: 0o700 })
  try {
    await untarGz(archivePath, tempDir)
    const metaRaw = await readFileBuffer(join(tempDir, '_meta.json')).then(buf => buf.toString('utf8'))
    const meta = JSON.parse(metaRaw) as BackupMeta
    if (meta.schemaVersion !== BACKUP_SCHEMA_VERSION) {
      throw new Error(`Backup schema version ${meta.schemaVersion} is incompatible with current version ${BACKUP_SCHEMA_VERSION}; upgrade the plugin or restore using an older version.`)
    }
    if (typeof meta.pluginVersion !== 'string' || meta.pluginVersion === '') {
      throw new Error('Backup _meta.json is missing pluginVersion and may be corrupted')
    }
    const restored: string[] = []
    if (options.keepCurrent !== false) {
      const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
      for (const name of (await readdir(dbDir)).filter(n => n.endsWith('.db'))) {
        const path = join(dbDir, name)
        await rename(path, `${path}.before-restore-${stamp}`)
      }
    }
    for (const name of (await readdir(tempDir)).filter(n => n.endsWith('.db'))) {
      const target = join(dbDir, name)
      await rename(join(tempDir, name), target)
      restored.push(target)
    }
    return { restored, archiveMeta: meta }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

/** Decompress the archive into a buffer, then extract tar entries into the destination. */
async function untarGz(archivePath: string, destDir: string): Promise<void> {
  const compressed = await readFileBuffer(archivePath)
  const tar = await gunzipAsync(compressed)
  await extractTar(tar, destDir)
}
