/** Approve pnpm's pending dependency scripts in the current profile's workspace settings. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isAlias, isMap, isNode, isScalar, parseDocument, visit } from 'yaml'
import { ManagementFailure } from './failure.ts'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

async function readPolicy(dir: string) {
  let text: string
  try { text = await readFile(join(dir, 'pnpm-workspace.yaml'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    text = '{}\n'
  }
  const document = parseDocument(text)
  if (document.errors[0] !== undefined) throw document.errors[0]
  if (!isMap(document.contents)) throw new Error('pnpm-workspace.yaml must be a YAML mapping')
  const builds = document.get('allowBuilds')
  if (builds !== undefined && !isMap(builds)) throw new Error('allowBuilds must be a YAML mapping')
  visit(builds ?? null, (_key, node) => {
    if (isAlias(node) || (isNode(node) && 'anchor' in node && node.anchor)) {
      throw new Error('allowBuilds must not contain YAML anchors or aliases')
    }
  })
  const pending = isMap(builds) ? builds.items.flatMap(({ key, value }) =>
    isScalar(key) && typeof key.value === 'string' && !/[*?]/.test(key.value)
      && isScalar(value) && value.value === 'set this to true or false' ? [key.value] : []) : []
  return { document, pending }
}

/** Read package names left undecided by pnpm 11, including after installation cleanup.
 * @param dir Current profile directory.
 * @returns Exact package names awaiting a build decision; wildcard rules are excluded.
 */
export async function readPendingBuilds(dir: string): Promise<string[]> {
  return (await readPolicy(dir)).pending
}

/** Persist approval without running scripts; the caller holds the profile manifest lock.
 * @param dir Current profile directory.
 * @param names Explicit package names from the pending build list.
 * @throws If a name is no longer pending or allowBuilds contains YAML anchors or aliases; no approvals are written.
 */
export async function approveBuilds(dir: string, names: readonly string[]): Promise<void> {
  const { document, pending } = await readPolicy(dir)
  if (names.some(name => !pending.includes(name))) throw new ManagementFailure('stale-approval')
  if (names.length === 0) return
  for (const name of names) document.setIn(['allowBuilds', name], true)
  await writeFileAtomic(join(dir, 'pnpm-workspace.yaml'), String(document), { mode: 0o600 })
}

/**
 * Record pnpm's undecided selectors when a non-interactive install cannot write them.
 * @param dir - Profile containing the package manager's modules metadata.
 * @returns Pending exact selectors; no script is approved or executed.
 */
export async function recordPendingBuilds(dir: string): Promise<string[]> {
  const { document, pending } = await readPolicy(dir)
  let text: string
  try { text = await readFile(join(dir, 'node_modules', '.modules.yaml'), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return pending
    throw error
  }
  if (text.length > 1024 * 1024) throw new Error('pnpm modules metadata exceeds limit')
  const metadata = parseDocument(text)
  if (metadata.errors.length > 0) throw metadata.errors[0]
  const ignored = metadata.toJS().ignoredBuilds as unknown
  if (ignored === undefined) return pending
  if (!Array.isArray(ignored) || ignored.length > 1000 || ignored.some(name =>
    typeof name !== 'string' || name.length === 0 || name.length > 4096 || /[\n\r\x00*?]/.test(name)))
    throw new Error('Invalid undecided build selectors')
  for (const name of ignored as string[]) {
    if (document.getIn(['allowBuilds', name]) === undefined)
      document.setIn(['allowBuilds', name], 'set this to true or false')
  }
  await writeFileAtomic(join(dir, 'pnpm-workspace.yaml'), String(document), { mode: 0o600 })
  return (await readPolicy(dir)).pending
}
