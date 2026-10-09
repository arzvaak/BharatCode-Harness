import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cwdProjectDbName, legacyProjectDbName, migrateProjectDb, normalizeOriginUrl, resolveProjectIdentity,
} from '../src/project/identity.ts'

const ORIGIN_CONFIG = [
  '[core]',
  '\trepositoryformatversion = 0',
  '[remote "origin"]',
  '\turl = git@github.com:kenz1117/dsh-engram.git',
  '\tfetch = +refs/heads/*:refs/remotes/origin/*',
].join('\n')

/** Create a plain repo directory with an origin remote. */
async function makeRepo(originUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'engram-id-'))
  await mkdir(join(dir, '.git'), { recursive: true })
  await writeFile(join(dir, '.git', 'config'), ORIGIN_CONFIG.replace('git@github.com:kenz1117/dsh-engram.git', originUrl))
  return dir
}

describe('normalizeOriginUrl', () => {
  it('normalizes equivalent forms: scp / https / credentials / uppercase host / trailing suffix', () => {
    const expected = 'github.com/kenz1117/dsh-engram'
    expect(normalizeOriginUrl('git@github.com:kenz1117/dsh-engram.git')).toBe(expected)
    expect(normalizeOriginUrl('https://github.com/kenz1117/dsh-engram')).toBe(expected)
    expect(normalizeOriginUrl('https://user:token@github.com/kenz1117/dsh-engram.git')).toBe(expected)
    expect(normalizeOriginUrl('ssh://git@GitHub.com/kenz1117/dsh-engram/')).toBe(expected)
    expect(normalizeOriginUrl('github.com/kenz1117/dsh-engram.git/')).toBe(expected)
  })

  it('normalizes different repos differently', () => {
    expect(normalizeOriginUrl('https://github.com/a/b')).not.toBe(normalizeOriginUrl('https://github.com/a/c'))
  })

  it('returns undefined when unparseable', () => {
    expect(normalizeOriginUrl('')).toBeUndefined()
    expect(normalizeOriginUrl('   ')).toBeUndefined()
  })
})

describe('resolveProjectIdentity', () => {
  it('plain repo: named by the first 24 hex chars of the sha256 of the normalized origin', async () => {
    const dir = await makeRepo('git@github.com:kenz1117/dsh-engram.git')
    const identity = resolveProjectIdentity(dir)
    expect(identity.source).toBe('origin')
    expect(identity.dbName).toMatch(/^project-[0-9a-f]{24}\.db$/)
    // Different URL forms of the same origin yield the same db name.
    const twin = await makeRepo('https://github.com/kenz1117/dsh-engram')
    expect(resolveProjectIdentity(twin).dbName).toBe(identity.dbName)
    // The legacy name is kept for migration.
    expect(identity.legacyDbName).toBe(legacyProjectDbName(dir))
  })

  it('worktree: the .git file follows the gitdir + commondir pointers to the main repo config', async () => {
    // Main repo: repo/.git/config has origin; worktree: wt/.git file points at repo/.git/worktrees/wt1.
    const repo = await makeRepo('https://github.com/kenz1117/dsh-engram')
    const wtGitdir = join(repo, '.git', 'worktrees', 'wt1')
    await mkdir(wtGitdir, { recursive: true })
    await writeFile(join(wtGitdir, 'commondir'), '../..\n')
    const wt = await mkdtemp(join(tmpdir(), 'engram-wt-'))
    await writeFile(join(wt, '.git'), `gitdir: ${wtGitdir}\n`)
    const identity = resolveProjectIdentity(wt)
    expect(identity.source).toBe('origin')
    expect(identity.dbName).toBe(resolveProjectIdentity(repo).dbName)
  })

  it('falls back to a full cwd hash name when .git is missing or has no origin', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'engram-nogit-'))
    const identity = resolveProjectIdentity(bare)
    expect(identity.source).toBe('cwd')
    expect(identity.dbName).toBe(cwdProjectDbName(bare))
    expect(identity.dbName).toMatch(/^project-[0-9a-f]{24}\.db$/)
    // The legacy truncated name is kept for migration; directories sharing a prefix no longer share a db.
    expect(identity.legacyDbName).toBe(legacyProjectDbName(bare))
    const sibling = await mkdtemp(join(tmpdir(), 'engram-nogit-'))
    expect(resolveProjectIdentity(sibling).dbName).not.toBe(identity.dbName)
    expect(legacyProjectDbName(sibling)).toBe(identity.legacyDbName)

    const noOrigin = await mkdtemp(join(tmpdir(), 'engram-noorigin-'))
    await mkdir(join(noOrigin, '.git'), { recursive: true })
    await writeFile(join(noOrigin, '.git', 'config'), '[core]\n\tbare = false\n')
    expect(resolveProjectIdentity(noOrigin).source).toBe('cwd')
  })
})

describe('migrateProjectDb', () => {
  it('origin db missing and legacy db present → rename migration', async () => {
    const dir = await makeRepo('git@github.com:kenz1117/dsh-engram.git')
    const identity = resolveProjectIdentity(dir)
    const dbDir = await mkdtemp(join(tmpdir(), 'engram-mig-'))
    await writeFile(join(dbDir, identity.legacyDbName), 'old-data')
    expect(migrateProjectDb(dbDir, identity)).toBe('renamed')
    expect(existsSync(join(dbDir, identity.dbName))).toBe(true)
    expect(existsSync(join(dbDir, identity.legacyDbName))).toBe(false)
  })

  it('both old and new dbs present → leave files untouched', async () => {
    const dir = await makeRepo('git@github.com:kenz1117/dsh-engram.git')
    const identity = resolveProjectIdentity(dir)
    const dbDir = await mkdtemp(join(tmpdir(), 'engram-mig-'))
    await writeFile(join(dbDir, identity.legacyDbName), 'old-data')
    await writeFile(join(dbDir, identity.dbName), 'new-data')
    expect(migrateProjectDb(dbDir, identity)).toBe('kept-both')
    expect(existsSync(join(dbDir, identity.legacyDbName))).toBe(true)
    expect(existsSync(join(dbDir, identity.dbName))).toBe(true)
  })

  it('legacy truncated cwd-fallback db is also migrated to the full-hash name', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'engram-nogit-'))
    const identity = resolveProjectIdentity(bare)
    const dbDir = await mkdtemp(join(tmpdir(), 'engram-mig-'))
    await writeFile(join(dbDir, identity.legacyDbName), 'old-data')
    expect(migrateProjectDb(dbDir, identity)).toBe('renamed')
    expect(existsSync(join(dbDir, identity.dbName))).toBe(true)
    expect(existsSync(join(dbDir, identity.legacyDbName))).toBe(false)
  })

  it('neither db present → no migration', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'engram-nogit-'))
    const dbDir = await mkdtemp(join(tmpdir(), 'engram-mig-'))
    expect(migrateProjectDb(dbDir, resolveProjectIdentity(bare))).toBe('none')
    const repo = await makeRepo('git@github.com:kenz1117/dsh-engram.git')
    expect(migrateProjectDb(dbDir, resolveProjectIdentity(repo))).toBe('none')
  })
})
