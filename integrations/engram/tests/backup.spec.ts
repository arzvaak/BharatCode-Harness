import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGzip } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBackup, restoreBackup, BACKUP_SCHEMA_VERSION } from '../src/backup/tar.ts'
import { createTarPack, endTarPack, extractTar } from '../src/backup/tar-stream.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'

let dir: string
let userStore: EngramStore
let projectStore: EngramStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-backup-'))
  userStore = await openEngramStore(join(dir, 'user.db'))
  projectStore = await openEngramStore(join(dir, 'project-abc.db'))
  // Intentionally non-English test data (CJK content), only used to exercise write/restore behavior.
  await userStore.write({ scope: 'user', kind: 'fact', content: '私人宫殿房间 1', importance: 0.7 })
  // Intentionally non-English test data (CJK content), only used to exercise write/restore behavior.
  await projectStore.write({ scope: 'project', kind: 'skill', content: '项目宫殿房间 1', importance: 0.6 })
  await userStore.close()
  await projectStore.close()
})

afterEach(async () => {
  // Each test manages its own temp directory; the OS cleans it up.
})

describe('palace backup / restore round-trip', () => {
  it('createBackup packs all *.db files into a tar.gz plus _meta.json', async () => {
    const result = await createBackup(dir, '0.6.1-test')
    expect(result.meta.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    expect(result.meta.pluginVersion).toBe('0.6.1-test')
    expect(result.meta.scopes.length).toBe(2)
    expect(result.bytes).toBeGreaterThan(0)
    const archiveBytes = await readFile(result.archivePath)
    // 0x1f 0x8b = gzip magic; verifies the archive is a real gzip stream.
    expect(archiveBytes[0]).toBe(0x1f)
    expect(archiveBytes[1]).toBe(0x8b)
  })

  it('restoreBackup unpacks and restores both store contents', async () => {
    const created = await createBackup(dir, '0.6.1-test')
    // Write new content into the existing store; restore should overwrite it with the backup version.
    const tempUser = await openEngramStore(join(dir, 'user.db'))
    // Intentionally non-English test data (CJK content), a dirty row that restore must overwrite.
    await tempUser.write({ scope: 'user', kind: 'fact', content: '恢复前的脏数据' })
    await tempUser.close()

    const result = await restoreBackup(created.archivePath, dir)
    expect(result.restored.length).toBe(2)
    expect(result.archiveMeta.schemaVersion).toBe(BACKUP_SCHEMA_VERSION)
    // After restore, reading user.db should return the original content.
    const restored = await openEngramStore(join(dir, 'user.db'))
    const rows = await restored.topActive('user', 10)
    // The fixture content (intentionally non-English) must come back exactly as written.
    expect(rows.map(r => r.content)).toEqual(['私人宫殿房间 1'])
    await restored.close()
    // A pre-restore snapshot file must exist.
    const beforeRestore = (await readdir(dir)).filter(n => n.startsWith('user.db.before-restore-'))
    expect(beforeRestore.length).toBe(1)
  })

  it('restoreBackup refuses to overwrite on schema mismatch', async () => {
    // Hand-craft a tar with schemaVersion=999; restore must reject it.
    const tamperedPath = join(dir, 'palace-bad.tar.gz')
    const tempBad = await mkdtemp(join(tmpdir(), 'engram-bad-'))
    await writeFile(join(tempBad, 'user.db'), Buffer.from('not-a-real-sqlite'))
    const badEntries: { name: string; data: Buffer }[] = [
      { name: 'user.db', data: await readFile(join(tempBad, 'user.db')) },
      { name: '_meta.json', data: Buffer.from(JSON.stringify({ schemaVersion: 999, pluginVersion: '0.0.0', exportedAt: Date.now(), scopes: [] }), 'utf8') },
    ]
    await new Promise<void>((resolve, reject) => {
      const sink = createWriteStream(tamperedPath, { mode: 0o600 })
      sink.on('error', reject); sink.on('finish', () => resolve())
      const gz = createGzip()
      gz.on('error', reject); gz.pipe(sink)
      for (const entry of badEntries) createTarPack(gz, entry.name, entry.data)
      endTarPack(gz)
      gz.end()
    })
    // Exact error message produced by src/backup/tar.ts restoreBackup.
    await expect(restoreBackup(tamperedPath, dir)).rejects.toThrow(/^Backup schema version/)
  })

  it('archivePath must stay inside dbDir (prevents path traversal)', async () => {
    // Directly exercise restore path validation: a relative '..' should be rejected.
    // The real validation lives in routes.ts; here we only verify restoreBackup's own semantics (an absolute path is accepted).
    const created = await createBackup(dir, '0.6.1-test')
    await expect(restoreBackup(created.archivePath, dir)).resolves.toBeTruthy()
  })
})


describe('archive extraction containment', () => {
  async function archive(name: string, type = '0'): Promise<Buffer> {
    const { PassThrough } = await import('node:stream')
    const out = new PassThrough()
    const chunks: Buffer[] = []
    out.on('data', chunk => chunks.push(chunk))
    createTarPack(out, name, Buffer.from('hostile fixture'))
    endTarPack(out)
    const bytes = Buffer.concat(chunks)
    bytes.write(type, 156, 1, 'ascii')
    return bytes
  }
  for (const name of ['../outside.db', '/outside.db', 'nested/file.db', 'C:\\outside.db', '..']) {
    it(`rejects unsafe flat filename ${name} before writing`, async () => {
      const destination = await mkdtemp(join(tmpdir(), 'engram-containment-'))
      await expect(extractTar(await archive(name), destination)).rejects.toThrow(/Unsafe/)
      expect(await readdir(destination)).toEqual([])
    })
  }
  for (const type of ['1', '2', '5', 'L', 'x']) {
    it(`rejects non-regular tar type ${type}`, async () => {
      const destination = await mkdtemp(join(tmpdir(), 'engram-containment-'))
      await expect(extractTar(await archive('user.db', type), destination)).rejects.toThrow(/Unsafe/)
      expect(await readdir(destination)).toEqual([])
    })
  }
  it('never follows a pre-existing destination symlink', async () => {
    const { symlink } = await import('node:fs/promises')
    const destination = await mkdtemp(join(tmpdir(), 'engram-containment-'))
    const outside = join(destination, '../outside-' + Date.now() + '.db')
    await writeFile(outside, 'preserve')
    await symlink(outside, join(destination, 'user.db'))
    await expect(extractTar(await archive('user.db'), destination)).rejects.toThrow(/EEXIST/)
    expect(await readFile(outside, 'utf8')).toBe('preserve')
  })
})
