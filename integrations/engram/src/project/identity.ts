/**
 * Project identity uses a normalized Git origin SHA-256 hash for database naming, falling
 * back to the complete cwd hash. Read Git config and worktree pointers directly
 * without subprocesses; migrate legacy database names at startup.
 * @module @kenz1117/dsh-engram/project/identity
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { LegacyMigrationPolicy } from '../config.ts'

/** Resolved project identity. */
export interface ProjectIdentity {
  readonly cwd: string
  /** Database filename: project-<hash>.db. */
  readonly dbName: string
  /** Identity source: normalized origin hash or cwd fallback. */
  readonly source: 'origin' | 'cwd'
  /** Legacy v0.4 cwd-based filename used to identify migration candidates. */
  readonly legacyDbName: string
}

/** Migration outcomes: renamed, coexisting, unnecessary, deferred, or previously claimed. */
export type MigrationOutcome = 'renamed' | 'kept-both' | 'none' | 'deferred' | 'already-migrated'

/** Legacy v0.4 naming uses the first 12 UTF-8 cwd bytes; retain only for migration detection. */
export function legacyProjectDbName(cwd: string): string {
  return `project-${Buffer.from(cwd).toString('hex').slice(0, 24)}.db`
}

/**
 * Without Git, use the first 24 hexadecimal characters of the complete cwd SHA-256 hash.
 * The legacy 12-byte prefix collided for directories sharing a prefix.
 * Rename legacy databases through migrateProjectDb at startup.
 */
export function cwdProjectDbName(cwd: string): string {
  return `project-${createHash('sha256').update(cwd).digest('hex').slice(0, 24)}.db`
}

/**
 * Normalize Git origin URLs: remove scheme and credentials, lowercase host, strip .git and trailing slashes.
 * SCP and HTTPS URLs resolve to the same identity; unparseable URLs return undefined.
 */
export function normalizeOriginUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  // SCP form: obtain the host between @ and : and the path after :.
  const scp = /^[^@\s]+@([^:\s]+):(.+)$/.exec(trimmed)
  let host: string
  let path: string
  if (scp !== null) {
    host = scp[1]!
    path = scp[2]!
  } else {
    // Add HTTPS to bare host/path values; URL parsing removes credentials.
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    try {
      const url = new URL(withScheme)
      host = url.host
      path = url.pathname
    } catch {
      return undefined
    }
  }
  // Normalize both SCP and URL paths into host/path by removing leading slashes.
  const normalizedPath = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '')
  if (host === '' || normalizedPath === '') return undefined
  return `${host.toLowerCase()}/${normalizedPath}`
}

/**
 * Resolve Git config from a .git directory or a worktree/submodule gitdir pointer.
 * Follow commondir when present to locate the main Git directory.
 * Return undefined if a required component is missing.
 */
export function resolveGitConfigPath(cwd: string): string | undefined {
  const dotGit = join(cwd, '.git')
  let stat
  try {
    stat = statSync(dotGit)
  } catch {
    return undefined
  }
  if (stat.isDirectory()) {
    return existsSync(join(dotGit, 'config')) ? join(dotGit, 'config') : undefined
  }
  if (!stat.isFile()) return undefined
  const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))
  if (pointer === null) return undefined
  const gitdir = resolve(cwd, pointer[1]!.trim())
  // Worktree config lives in the main Git directory referenced by commondir.
  let common = gitdir
  try {
    const commondir = readFileSync(join(gitdir, 'commondir'), 'utf8').trim()
    if (commondir !== '') common = resolve(gitdir, commondir)
  } catch {
    // Without commondir, gitdir is the actual Git directory, as with submodules.
  }
  const configPath = join(common, 'config')
  return existsSync(configPath) ? configPath : undefined
}

/** Read the origin URL using a minimal dependency-free INI line parser. */
export function readOriginUrl(configPath: string): string | undefined {
  let text: string
  try {
    text = readFileSync(configPath, 'utf8')
  } catch {
    return undefined
  }
  let inOrigin = false
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      inOrigin = /^\[remote\s+"origin"\]$/i.test(trimmed)
      continue
    }
    if (inOrigin) {
      const entry = /^url\s*=\s*(.+)$/.exec(trimmed)
      if (entry !== null) return entry[1]!.trim()
    }
  }
  return undefined
}

/**
 * Hash the normalized origin URL into 24 hexadecimal characters.
 * Fall back to hashing the complete cwd if Git, origin, or a parseable URL is unavailable.
 */
export function resolveProjectIdentity(cwd: string): ProjectIdentity {
  const legacyDbName = legacyProjectDbName(cwd)
  const configPath = resolveGitConfigPath(cwd)
  const origin = configPath === undefined ? undefined : readOriginUrl(configPath)
  const normalized = origin === undefined ? undefined : normalizeOriginUrl(origin)
  if (normalized === undefined) return { cwd, dbName: cwdProjectDbName(cwd), source: 'cwd', legacyDbName }
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 24)
  return { cwd, dbName: `project-${hash}.db`, source: 'origin', legacyDbName }
}

/** Stable workspace ownership is independent of origin URLs, title, and directory moves. */
export function workspaceProjectDbName(workspaceId: string): string {
  if (workspaceId === '') throw new Error('Workspace ID must not be empty')
  return `project-${createHash('sha256').update(`workspace:${workspaceId}`).digest('hex').slice(0, 24)}.db`
}

/** JSON sidecar records a completed claim; never used as a path to open a database. */
export interface MigrationPointer {
  readonly migratedTo: string
  readonly claimedByCwd: string
  readonly claimedAt: string
}

export function readMigrationPointer(dbDir: string, identity: ProjectIdentity): MigrationPointer | undefined {
  const path = join(dbDir, `${identity.legacyDbName}.migrated-to`)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null
    || !('migratedTo' in value) || typeof value.migratedTo !== 'string'
    || !/^project-[0-9a-f]{24}\.db$/.test(value.migratedTo)
    || !('claimedByCwd' in value) || typeof value.claimedByCwd !== 'string'
    || !('claimedAt' in value) || typeof value.claimedAt !== 'string'
    || !Number.isFinite(Date.parse(value.claimedAt))) {
    throw new Error(`dsh-engram: invalid migration pointer ${path}; inspect it manually`)
  }
  return value as MigrationPointer
}

/**
 * Eager keeps the existing rename policy, recording its ambiguous ownership in JSON.
 * Conservative leaves legacy bytes untouched; the caller may open an empty new store.
 * Coexisting databases are never merged or overwritten. This is not a cross-process lock
 * or an atomic transaction across the rename and sidecar write: stop other hosts first.
 */
export function migrateProjectDb(
  dbDir: string, identity: ProjectIdentity, policy: LegacyMigrationPolicy = 'eager',
): MigrationOutcome {
  if (identity.dbName === identity.legacyDbName) return 'none'
  const next = join(dbDir, identity.dbName)
  const legacy = join(dbDir, identity.legacyDbName)
  const hasNext = existsSync(next)
  const hasLegacy = existsSync(legacy)
  if (hasNext && hasLegacy) return 'kept-both'
  // Preserve previous claims even if a legacy file is later restored from backup.
  const pointer = readMigrationPointer(dbDir, identity)
  if (pointer !== undefined) {
    if (hasLegacy || pointer.migratedTo !== identity.dbName) return 'already-migrated'
    return 'none'
  }
  if (!hasNext && hasLegacy) {
    if (policy === 'conservative') return 'deferred'
    renameSync(legacy, next)
    try {
      writeFileSync(`${legacy}.migrated-to`, JSON.stringify({
        migratedTo: identity.dbName,
        claimedByCwd: identity.cwd,
        claimedAt: new Date().toISOString(),
      } satisfies MigrationPointer) + '\n', { flag: 'wx', mode: 0o600 })
    } catch (error) {
      // Do not attempt a rollback that could overwrite a concurrently restored old file.
      throw new Error(`dsh-engram: renamed ${identity.legacyDbName} to ${identity.dbName}, but could not record migration; inspect both paths before retrying`, { cause: error })
    }
    return 'renamed'
  }
  return 'none'
}

/** Shared guidance for plugin boot and session-cwd migration checks. */
export function migrationWarning(dbDir: string, identity: ProjectIdentity, outcome: MigrationOutcome): string | undefined {
  const names = `Old database ${identity.legacyDbName}; new database ${identity.dbName}`
  const manual = 'Before manual changes, stop affected hosts and back up every database and sidecar. The new database may already contain memories: do not overwrite it directly. Review using engram_review / engram_export and reassign memories manually.'
  switch (outcome) {
    case 'none': return undefined
    case 'renamed':
      return `[dsh-engram] Project database migrated (${names}); .migrated-to recorded. The old database may contain memories from directories sharing a prefix. ${manual}`
    case 'kept-both':
      return `[dsh-engram] Old and new project databases coexist; neither was merged or moved (${names}). ${manual}`
    case 'deferred':
      return `[dsh-engram] Conservative mode deferred legacy migration (${names}); the old database remains unchanged and a new empty database will open. ${manual}`
    case 'already-migrated': {
      const pointer = readMigrationPointer(dbDir, identity)
      return `[dsh-engram] Legacy database already has a migration record (${names}): ${JSON.stringify(pointer)}; the previously migrated database may contain memories for this directory. ${manual}`
    }
  }
}
