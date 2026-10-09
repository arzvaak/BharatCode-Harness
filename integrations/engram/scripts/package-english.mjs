#!/usr/bin/env node
// Produce a ready-to-install package from the same main source, never an old bundle.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

const require = createRequire(import.meta.url)
const tsdown = resolve(dirname(require.resolve('tsdown/package.json')), 'dist/run.mjs')
const tsc = resolve(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
const vitest = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
const typecheck = spawnSync(process.execPath, [tsc, '--noEmit'], { stdio: 'inherit', cwd: root })
if (typecheck.error) throw typecheck.error
if (typecheck.status !== 0) process.exit(typecheck.status ?? 1)
for (const command of [['scripts/check-source-syntax.mjs'], ['scripts/test-translation-guard.mjs'], [vitest, 'run'], [tsdown], ['scripts/check-english-surfaces.mjs'], ['scripts/check-english-package.mjs']]) {
  const result = spawnSync(process.execPath, command, { stdio: 'inherit', cwd: root })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('Current host and client bundles are built; English surface and package-file gates passed.')
