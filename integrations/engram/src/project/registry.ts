/**
 * Project-palace inventory maps registered workspaces and session directories
 * to memory databases for panel selection and current-workspace display.
 *
 * Design principles:
 * 1. Pure mapping with injected data sources; index.ts connects workspaceRegistry
 *    and sessionPersistence while this module handles mapping and deduplication.
 * 2. Stateless directory-to-database resolution using origin or complete cwd hashes;
 *    workspace renames and removal require no additional registry file.
 * 3. Priority: registered workspace, session-only cwd, then plugin process directory.
 *    Each Workspace ID owns a distinct palace; unregistered directories retain legacy resolution.
 * @module @kenz1117/dsh-engram/project/registry
 */

import { resolveProjectIdentity, workspaceProjectDbName } from './identity.ts'

/** Narrow view of ctx.workspaceRegistry.list(). */
export interface WorkspaceRef {
  /** Host-generated workspace UUID. */
  readonly id: string
  /** Canonical absolute directory path after realpath resolution. */
  readonly path: string
  /** User-editable display title, defaulting to the final path component. */
  readonly title: string
}

/** Project-palace source category. */
export type ProjectPalaceKind = 'workspace' | 'session' | 'process'

/** One project palace represents one project database. */
export interface ProjectPalace {
  /** Database filename used as the panel and API selection identifier. */
  readonly dbName: string
  /** Owning directory, or undefined when attribution is unavailable. */
  readonly path: string | undefined
  /** Display title. */
  readonly title: string
  /** Identity source: Git origin hash or complete cwd hash. */
  readonly source: 'origin' | 'cwd' | 'workspace'
  /** Source category: registered workspace, session cwd, or process fallback. */
  readonly kind: ProjectPalaceKind
  /** Host workspace identifier when kind is workspace. */
  readonly workspaceId?: string
}

/** Use the final Windows or POSIX path component as title; roots retain their full value. */
export function pathTitle(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  const tail = cut === -1 ? trimmed : trimmed.slice(cut + 1)
  return tail === '' ? trimmed : tail
}

/** Resolve a directory to a project palace with the caller-provided category. */
function palaceFor(path: string, kind: ProjectPalaceKind, title: string, workspaceId?: string): ProjectPalace {
  const identity = resolveProjectIdentity(path)
  return {
    dbName: workspaceId === undefined ? identity.dbName : workspaceProjectDbName(workspaceId),
    path,
    title,
    source: workspaceId === undefined ? identity.source : 'workspace',
    kind,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  }
}

/**
 * Assemble the project-palace inventory.
 *
 * Include registered workspaces even when their database files do not yet exist.
 * Missing workspace matches can silently redirect current-workspace selection to the process database.
 * @param input - Registered workspaces, session directories, and plugin process directory.
 * @returns Database-deduplicated inventory ordered by workspace, session, then process priority.
 */
export function listProjectPalaces(input: {
  readonly workspaces: readonly WorkspaceRef[]
  readonly sessionCwds: readonly string[]
  readonly processCwd: string
}): ProjectPalace[] {
  const palaces: ProjectPalace[] = []
  const seen = new Set<string>()
  const push = (palace: ProjectPalace): void => {
    if (seen.has(palace.dbName)) return
    seen.add(palace.dbName)
    palaces.push(palace)
  }
  for (const workspace of input.workspaces) {
    if (workspace.path === '') continue
    push(palaceFor(workspace.path, 'workspace', workspace.title === '' ? pathTitle(workspace.path) : workspace.title, workspace.id))
  }
  for (const cwd of input.sessionCwds) {
    if (cwd === '') continue
    if (!input.workspaces.some(workspace => workspace.path === cwd)) push(palaceFor(cwd, 'session', pathTitle(cwd)))
  }
  if (!input.workspaces.some(workspace => workspace.path === input.processCwd)) push(palaceFor(input.processCwd, 'process', `${pathTitle(input.processCwd)} (process directory)`))
  return palaces
}

/**
 * Select by database name first, then cwd; no selector uses the process-directory fallback.
 * @param palaces - Available inventory.
 * @param selector - Panel or API selection criteria.
 * @returns Selected palace, or undefined for an unknown selector so the caller can return 404.
 */
export function findProjectPalace(
  palaces: readonly ProjectPalace[],
  selector: { readonly dbName?: string | undefined; readonly cwd?: string | undefined },
): ProjectPalace | undefined {
  if (selector.dbName !== undefined && selector.dbName !== '') {
    return palaces.find(palace => palace.dbName === selector.dbName)
  }
  if (selector.cwd !== undefined && selector.cwd !== '') {
    const workspace = palaces.find(palace => palace.path === selector.cwd && palace.kind === 'workspace')
    if (workspace !== undefined) return workspace
    const dbName = resolveProjectIdentity(selector.cwd).dbName
    return palaces.find(palace => palace.dbName === dbName)
      ?? palaceFor(selector.cwd, 'session', pathTitle(selector.cwd))
  }
  return palaces.find(palace => palace.kind === 'process') ?? palaces[0]
}
