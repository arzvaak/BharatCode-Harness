#!/usr/bin/env node
/**
 * Symlink this plugin's @deepseek-ai/* peer dependencies from the deepseek-harness workspace into node_modules.
 *
 * Why not use file:/npm installs: internal harness packages use the workspace:^ protocol for dependencies,
 * which pnpm cannot resolve outside the workspace; the @deepseek-ai dependency chain on npm is also incomplete (dsh-type-meta is unpublished).
 * After symlinking, imports from linked packages to other @deepseek-ai/* packages resolve upward via their real paths (inside the harness tree)
 * to the harness's own workspace node_modules, automatically completing the transitive dependency chain.
 *
 * Prerequisite: deepseek-harness has run pnpm install && pnpm run build (lib/ artifacts exist).
 * Idempotent: existing links are skipped. In published installations these packages are peerDependencies provided by the dsh profile.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = process.env.DSH_SOURCE_ROOT
  ? resolve(process.env.DSH_SOURCE_ROOT)
  : resolve(repoRoot, '..', 'deepseek-harness')

/** Packages imported directly: the actual type and runtime entry points; transitive dependencies resolve within the harness tree. */
const LINKED_PACKAGES = [
  ['@deepseek-ai/cordis', 'vendor/cordis'],
  ['@deepseek-ai/cosmokit', 'vendor/cosmokit'],
  ['@deepseek-ai/schemastery', 'vendor/schemastery'],
  ['@deepseek-ai/cordis-plugin-loader', 'vendor/loader'],
  ['@deepseek-ai/cordis-plugin-include', 'vendor/include'],
  ['@deepseek-ai/dsh-tools', 'packages/core/tools'],
  ['@deepseek-ai/dsh-system-prompt', 'packages/core/system-prompt'],
  ['@deepseek-ai/dsh-session', 'packages/core/session'],
  ['@deepseek-ai/dsh-host-webserver', 'packages/host/webserver'],
  ['@deepseek-ai/dsh-client-locale', 'packages/client/locale'],
  ['@deepseek-ai/dsh-client-ui-settings', 'packages/client/ui-settings'],
  ['@deepseek-ai/dsh-client-ui-renderer', 'packages/client/ui-renderer'],
  ['@deepseek-ai/dsh-client-ui-slots', 'packages/client/ui-slots'],
  ['@deepseek-ai/dsh-llm', 'packages/llm/llm'],
  ['@deepseek-ai/dsh-agent', 'packages/core/agent'],
  ['@deepseek-ai/dsh-scope', 'packages/core/scope'],
  ['@deepseek-ai/dsh-util-values', 'packages/util/values'],
  ['@deepseek-ai/dsh-brand', 'packages/util/brand'],
  ['@deepseek-ai/dsh-invariants', 'packages/runtime-diagnostics/invariants'],
]

const scopeDir = join(repoRoot, 'node_modules', '@deepseek-ai')
mkdirSync(scopeDir, { recursive: true })

let created = 0
let skipped = 0
for (const [name, rel] of LINKED_PACKAGES) {
  const target = join(harnessRoot, rel)
  const link = join(scopeDir, name.split('/')[1])
  if (existsSync(link)) continue
  // Gracefully skip: published installations or profile environments may lack the harness source tree; peers are provided by
  // the profile's node_modules. Missing links must never cause installation to fail.
  if (!existsSync(target)) {
    skipped += 1
    continue
  }
  symlinkSync(target, link, 'dir')
  created += 1
}
console.log(`[link-peers] ok (created ${created} links, skipped ${skipped} peers without source trees, ${LINKED_PACKAGES.length} total)`)
