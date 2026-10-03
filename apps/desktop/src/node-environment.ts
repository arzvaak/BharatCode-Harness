/** Electron Node-mode startup, with private shell launchers scoped to package installation. */

import { spawnSync } from 'node:child_process'
import { accessSync, constants, realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Select Electron's Node mode and the shell launcher used by package scripts.
 * @param executable - Electron executable running the application.
 * @param bin - Directory containing the node shell launcher.
 * @param environment - Caller environment preserved for plugin execution.
 * @returns Environment for a Node-mode child process.
 */
export function desktopNodeEnvironment(executable: string, bin: string | undefined, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    ELECTRON_RUN_AS_NODE: '1',
    ...(bin === undefined ? {} : { DSH_DESKTOP_NODE_EXECUTABLE: executable, PATH: `${bin}${delimiter}${environment.PATH ?? ''}` }),
  }
}

/**
 * Probe one candidate executable for a standalone Node.js runtime.
 * @param candidate - Absolute path of the executable to probe.
 * @returns True when it runs Node.js 20+ outside Electron's Node mode.
 */
function isStandaloneNode(candidate: string): boolean {
  const probe = spawnSync(candidate, ['-p', 'process.versions.node + "|" + (process.versions.electron || "")'], {
    encoding: 'utf8',
    timeout: 5_000,
  })
  if (probe.status !== 0) return false
  const [version = '', electronVersion = ''] = probe.stdout.trim().split('|')
  if (electronVersion !== '') return false
  const major = Number(version.split('.')[0])
  return Number.isSafeInteger(major) && major >= 20
}

/**
 * Resolve the executable that starts the Desktop Host child.
 *
 * `DSH_DESKTOP_HOST_NODE` always wins. On Linux the Host must be a standalone
 * Node.js: sharp's prebuilt libvips binaries segfault when loaded from
 * Electron's Node mode (`ELECTRON_RUN_AS_NODE`) — the documented conflict at
 * https://sharp.pixelplumbing.com/install#electron-and-linux — so image
 * attachment processing would crash the Host child. macOS and Windows keep
 * Electron's Node mode because no such conflict is known there.
 *
 * @param environment - Environment carrying the override and the PATH search.
 * @param platform - Platform to resolve for.
 * @param override - Optional explicit executable (`DSH_DESKTOP_HOST_NODE`).
 * @returns The Host executable, or undefined when the caller keeps Electron.
 */
export function resolveHostNode(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform, override?: string): string | undefined {
  if (override !== undefined && override !== '') return override
  if (platform !== 'linux') return undefined
  for (const directory of (environment.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    const candidate = join(directory, 'node')
    try {
      accessSync(candidate, constants.X_OK)
    } catch {
      continue
    }
    if (!isStandaloneNode(candidate)) continue
    try {
      return realpathSync(candidate)
    } catch {
      return candidate
    }
  }
  return undefined
}
