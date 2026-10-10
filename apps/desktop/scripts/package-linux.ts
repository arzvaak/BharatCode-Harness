/** Build the self-contained Linux x64 preview through the production runtime pipeline. */
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createPackagingRun } from './packaging-run.mjs'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { desktopBuildCommitEnvironment, readDesktopBuildCommit } from './desktop-build-commit.mjs'
import { execFileSync } from 'node:child_process'
import { resolveDesktopBuildVersion } from './desktop-build-version.mjs'
import { withoutDesktopUploadCredentials, withoutWindowsSigningEnvironment } from './package-target.ts'

const appRoot = resolve(import.meta.dirname, '..')
const root = resolve(appRoot, '..', '..')

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Linux preview packaging requires a native Linux x64 host')
  const { values } = parseArgs({ options: { dir: { type: 'boolean', default: false } } })
  const pnpm = process.env.npm_execpath
  if (!pnpm) throw new Error('Invoke through pnpm run package:linux:x64')
  const paths = desktopTargetBuildPaths('linux-x64')
  const { version: productVersion } = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as { version: string }
  const timestamp = Number(execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim())
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10).replaceAll('-', '')
  const version = resolveDesktopBuildVersion({ ...process.env,
    DSH_DESKTOP_BUILD_VERSION: process.env.DSH_DESKTOP_BUILD_VERSION ?? `${productVersion}.${date}.${timestamp}` }, productVersion)
  const environment = {
    ...withoutDesktopUploadCredentials(withoutWindowsSigningEnvironment(process.env)),
    ...desktopBuildCommitEnvironment(readDesktopBuildCommit(root)),
    DSH_DESKTOP_BUILD_VERSION: version,
    DSH_DESKTOP_TARGET_PLATFORM: 'linux', DSH_DESKTOP_TARGET_ARCH: 'x64',
    DSH_DESKTOP_APP_ID: 'org.bharatcode.Harness.preview',
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  }
  const run = createPackagingRun(join(paths.root, 'runs'), { target: 'linux-x64', version })
  const execute = (stage: string, args: readonly string[], cwd = root) =>
    run.run(stage, process.execPath, [pnpm, ...args], { cwd, env: environment })
  let success = false
  try {
    await execute('build', ['run', 'build:official'])
    await run.run('core-build', process.execPath, ['scripts/extensions/core.mjs', 'build'], { cwd: root, env: environment })
    await execute('pack-dsh', ['run', 'release:pack', '--family', 'dsh', '--out', paths.packedDsh, '--concurrency', '4'])
    await execute('pack-host', ['--dir', 'apps/desktop-host', 'pack', '--config.ignore-scripts=true', '--pack-destination', paths.packedDsh])
    await execute('pack-auto-continue', ['--dir', 'packages/bundle/max-tokens-continue', 'pack', '--config.ignore-scripts=true', '--pack-destination', paths.packedDsh])
    await execute('pack-vendor', ['run', 'release:pack', '--family', 'vendor', '--out', paths.packedVendor, '--concurrency', '4'])
    mkdirSync(paths.packedLandlock, { recursive: true })
    await execute('native-types', ['--dir', 'native/system', 'run', 'build:ts'])
    await execute('pack-native', ['--dir', 'native/system/packages/entry', 'pack', '--config.ignore-scripts=true', '--pack-destination', paths.packedLandlock])
    await run.run('core-pack', process.execPath, ['scripts/extensions/core.mjs', 'pack'], { cwd: root, env: environment })
    await execute('prepare-runtime', ['run', 'prepare:runtime'], appRoot)
    await execute('prepare-packages', ['run', 'prepare:packages', '--from', paths.packedDsh, '--from', paths.packedVendor, '--from', paths.packedLandlock, '--from', join(root, 'dist/extensions')], appRoot)
    await execute('prepare-dsh', ['run', 'prepare:dsh'], appRoot)
    rmSync(paths.artifacts, { recursive: true, force: true })
    mkdirSync(paths.artifacts, { recursive: true })
    await execute('package-linux', ['exec', 'electron-builder', '--config', 'electron-builder.config.mjs', '--linux', '--x64', '--publish', 'never', ...(values.dir ? ['--dir'] : [])], appRoot)
    await execute('smoke-packaged-runtime', ['exec', 'tsx', 'scripts/smoke-packaged-runtime.ts'], appRoot)
    writeFileSync(join(paths.artifacts, 'linux-preview-build.json'), JSON.stringify({ schemaVersion: 1, target: 'linux-x64', version, ...readDesktopBuildCommit(root), updateMode: 'github', updateRepository: 'arzvaak/BharatCode-Extensions', updateChannel: 'rc', run: run.directory }, null, 2) + '\n')
    success = true
    console.log(`Linux preview artifacts: ${paths.artifacts}`)
  } finally { run.finish(success) }
}

await main()
