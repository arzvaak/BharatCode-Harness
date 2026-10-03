/** Launch the source-built Linux desktop with pinned local runtime resources. */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { prepareDevelopmentProject } from './development-project.ts'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { preparePrimaryRuntime, smokePrimaryRuntime } from '../../../scripts/primary-runtime/prepare.ts'

if (process.platform !== 'linux' || (process.arch !== 'x64' && process.arch !== 'arm64')) {
  throw new Error('local Linux desktop requires Linux x64 or arm64')
}
const appRoot = resolve(import.meta.dirname, '..')
const root = resolve(appRoot, '..', '..')
const target = process.arch === 'x64' ? 'linux-x64' : 'linux-arm64'
const buildRoot = join(appRoot, '.desktop-build', 'linux-local')
const runtime = join(buildRoot, 'runtime')
const version = (JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as { version: string }).version
const require = createRequire(import.meta.url)
const electron: unknown = require('electron')
if (typeof electron !== 'string') throw new Error('Electron executable is missing')
const pnpmVersion = (JSON.parse(readFileSync(require.resolve('pnpm'), 'utf8')) as { version: string }).version
const nodeVersion = execFileSync(electron, ['-p', 'process.versions.node'], {
  encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
}).trim()
for (const file of [join(appRoot, 'lib', 'main.js'), join(root, 'apps', 'desktop-host', 'lib', 'index.js')]) {
  if (!existsSync(file)) throw new Error(`Missing ${file}; run pnpm build first`)
}
const primaryRuntime = join(runtime, 'primary-runtime')
if (!existsSync(join(primaryRuntime, 'runtime.json'))) {
  await preparePrimaryRuntime({ target, output: runtime, cache: join(buildRoot, 'downloads'), version })
  smokePrimaryRuntime(primaryRuntime)
}
prepareDevelopmentProject({
  projectDir: join(appRoot, '.desktop-build', 'development', 'project'),
  cliDir: join(root, 'apps', 'cli'), hostDir: join(root, 'apps', 'desktop-host'),
  dependencyDir: join(root, 'node_modules', '.pnpm', 'node_modules'),
  release: { schemaVersion: 1, version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion, pnpmVersion },
  target,
})
// A harness session exports DSH_HOME for its own profile and
// ELECTRON_RUN_AS_NODE for Node-mode children; neither belongs to this GUI
// main process. The launcher is self-contained: its own home, its own
// Electron user data (so the single-instance lock cannot collide with an
// installed Desktop already running), and an explicit opt-in override.
const userData = process.env.DSH_DESKTOP_USER_DATA_DIR ?? join(buildRoot, 'electron-user-data')
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DSH_HOME: process.env.DSH_DESKTOP_LOCAL_HOME ?? join(buildRoot, 'home'),
  DSH_DESKTOP_PRIMARY_RUNTIME_DIR: primaryRuntime,
  // Start the Host on this launcher's own Node.js: sharp segfaults in
  // Electron's Node mode on Linux (https://sharp.pixelplumbing.com/install#electron-and-linux).
  DSH_DESKTOP_HOST_NODE: process.execPath,
  DSH_DESKTOP_OPEN_DEVTOOLS: '0',
}
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [appRoot, `--user-data-dir=${userData}`], {
  cwd: appRoot, stdio: 'inherit', env,
})
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
