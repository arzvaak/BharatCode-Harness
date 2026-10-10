import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'

it('previews legacy and missing vectors without changing stored memories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'engram-migration-preview-'))
  const path = join(directory, 'user.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE nodes(id TEXT PRIMARY KEY, content TEXT, embedding BLOB)')
  const insert = db.prepare('INSERT INTO nodes VALUES (?, ?, ?)')
  insert.run('legacy', 'Legacy memory', new Uint8Array(512 * 4))
  insert.run('current', 'Current memory', new Uint8Array(384 * 4))
  insert.run('missing', 'Missing vector', null)
  db.close()
  const result = spawnSync(process.execPath, ['scripts/reembed-after-english.mjs', directory], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('user.db: 2/3 vectors')
  expect(result.stdout).toContain('databases do not record embedding model identity')
  expect(result.stdout).toContain('Preview only')
  const verify = new DatabaseSync(path, { readOnly: true })
  try {
    expect(verify.prepare('SELECT length(embedding) AS bytes FROM nodes WHERE id = ?').get('legacy')?.bytes).toBe(2048)
    expect(verify.prepare('SELECT content FROM nodes WHERE id = ?').get('legacy')?.content).toBe('Legacy memory')
    expect(verify.prepare('SELECT length(embedding) AS bytes FROM nodes WHERE id = ?').get('current')?.bytes).toBe(1536)
    expect(verify.prepare('SELECT embedding FROM nodes WHERE id = ?').get('missing')?.embedding).toBeNull()
    expect(verify.prepare('SELECT COUNT(*) AS count FROM nodes').get()?.count).toBe(3)
  } finally {
    verify.close()
  }
  const unsafe = spawnSync(process.execPath, ['scripts/reembed-after-english.mjs', directory, '--apply'], { encoding: 'utf8' })
  expect(unsafe.status).not.toBe(0)
  expect(unsafe.stderr).toContain('--maintenance-window')
  expect(await readdir(directory)).toEqual(['user.db'])
})
