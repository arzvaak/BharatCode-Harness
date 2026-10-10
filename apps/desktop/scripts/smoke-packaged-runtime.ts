/** Validate the assembled application, including native Office conversion outside ASAR. */
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parseArgs } from 'node:util'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const linux = target === 'linux-x64'
if (values.unsigned && !windows) throw new Error('desktop smoke: unsigned artifacts require Windows')
const artifacts = values.unsigned ? paths.unsignedArtifacts : paths.artifacts
const application = windows ? join(artifacts, 'win-unpacked')
  : linux ? join(artifacts, 'linux-unpacked')
    : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'BharatCode.app', 'Contents')
const resources = join(application, windows || linux ? 'resources' : 'Resources')
const executable = windows ? join(application, 'BharatCode.exe')
  : linux ? join(resources, 'runtime/primary-runtime/dependencies/node/bin/node') : join(application, 'MacOS', 'BharatCode')
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  desktopTargetPlatform(target))
if (windows && !values.unsigned) await verifyWindowsCode(application)
if (linux) {
  const assembled = await verifyDesktopRuntime(join(resources, 'dsh'), descriptor.release.version, desktopTargetPlatform(target))
  if (!isDeepStrictEqual(assembled, descriptor)) throw new Error('desktop smoke: assembled Linux runtime descriptor differs from preparation')
}
await smokePreparedRuntime(linux ? join(resources, 'dsh') : join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
