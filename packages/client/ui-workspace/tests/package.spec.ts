/** Packed workspace clients must include every generated lazy editor and style chunk. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('ships all generated client chunks in the installable package', () => {
  const directory = fileURLToPath(new URL('../', import.meta.url))
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const destination = mkdtempSync(join(tmpdir(), 'dsh-workspace-pack-'))
  try {
    const chunks = readdirSync(join(directory, 'lib')).filter(name => name.startsWith('client') && name.endsWith('.js'))
    expect(chunks).toContain('client.CodeEditor.js')
    expect(chunks).toContain('client.ProseEditor.js')
    expect(chunks).toContain('client.documents.module.css.js')
    execFileSync(process.execPath, [join(root, 'node_modules/pnpm/bin/pnpm.cjs'), '--dir', directory, 'pack', '--config.ignore-scripts=true', '--pack-destination', destination], { stdio: 'pipe' })
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name: string; version: string }
    const archive = join(destination, `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`)
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
    for (const chunk of chunks) expect(entries).toContain(`package/lib/${chunk}`)
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}, 30_000)
