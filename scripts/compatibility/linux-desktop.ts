/** Prepare a private development runtime and launch the actual Electron main/preload/Host under Xvfb. */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { prepareDevelopmentProject } from '../../apps/desktop/scripts/development-project.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../../apps/desktop/src/host-protocol.ts'
import { preparePrimaryRuntime, smokePrimaryRuntime } from '../primary-runtime/prepare.ts'

if (process.platform !== 'linux') throw new Error('Linux desktop compatibility requires a native Linux runner')
const root = resolve(import.meta.dirname, '../..')
const appRoot = join(root, 'apps/desktop')
const buildRoot = join(appRoot, '.desktop-build/linux-local')
const target = process.arch === 'x64' ? 'linux-x64' : 'linux-arm64'
const require = createRequire(join(appRoot, 'package.json'))
const electron: unknown = require('electron')
if (typeof electron !== 'string') throw new Error('Electron executable missing; run its install.js')
const temporary = mkdtempSync(join(tmpdir(), 'bharat-linux-desktop-'))
const runtimeRoot = process.env.BHARATCODE_COMPAT_RUNTIME ?? join(buildRoot, 'runtime')
const primary = join(runtimeRoot, 'primary-runtime')
try {
  const version = (JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as { version: string }).version
  if (!existsSync(join(primary, 'runtime.json'))) await preparePrimaryRuntime({
    target, output: runtimeRoot, cache: join(buildRoot, 'downloads'), version,
  })
  smokePrimaryRuntime(primary)
  const nodeVersion = execFileSync(electron, ['-p', 'process.versions.node'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8',
  }).trim()
  const pnpmVersion = (JSON.parse(readFileSync(require.resolve('pnpm'), 'utf8')) as { version: string }).version
  prepareDevelopmentProject({ projectDir: join(buildRoot, '../development/project'), cliDir: join(root, 'apps/cli'),
    hostDir: join(root, 'apps/desktop-host'), dependencyDir: join(root, 'node_modules/.pnpm/node_modules'), target,
    release: { schemaVersion: 1, version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion, pnpmVersion } })
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: join(temporary, 'home'),
    DSH_DESKTOP_PRIMARY_RUNTIME_DIR: primary, DSH_DESKTOP_OPEN_DEVTOOLS: '0', DSH_DESKTOP_WEB_PORT: '0', DSH_TELEMETRY_DISABLED: '1',
    BHARATCODE_COMPAT_DESKTOP_ROOT: temporary, BHARATCODE_COMPAT_APP_ROOT: appRoot,
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.DSH_PROFILE
  const child = spawn(electron, [join(root, 'scripts/compatibility/linux-desktop-observer.mjs')], { env, cwd: appRoot, stdio: 'inherit' })
  const completion = new Promise<void>((resolveRun, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0 && signal === null) resolveRun()
      else reject(new Error(`Linux desktop smoke exited ${String(code)} / ${String(signal)}`))
    })
  })
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 180_000)
  try { await completion } finally { clearTimeout(watchdog) }
} finally { rmSync(temporary, { recursive: true, force: true }) }
