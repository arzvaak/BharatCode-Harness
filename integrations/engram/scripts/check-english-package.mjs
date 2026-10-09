#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(pkg.repository.url, 'git+https://github.com/arzvaak/dsh-engram-english.git')
for (const entry of ['lib/', 'src/', 'docs/', 'tests/', 'scripts/', 'tsconfig.json', 'tsdown.config.ts']) {
  assert.ok(pkg.files.includes(entry), `${entry} must ship in the complete package`)
}
for (const name of ['lib/index.js', 'lib/client.js', 'lib/client.js.map', 'scripts/test-translation-guard.mjs', 'cordis.patch.yml', 'icon.svg', 'icon-256.svg']) {
  assert.ok(statSync(new URL(`../${name}`, import.meta.url)).size > 0, `${name} is missing or empty`)
}
for (const name of ['README.md', 'README.en.md', 'cordis.patch.yml', 'icon.svg', 'icon-256.svg']) {
  const text = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
  assert.ok(!/\p{Script=Han}/u.test(text), `${name} contains untranslated prose`)
}
function checkDocs(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) checkDocs(path)
    else if (entry.name.endsWith('.md')) {
      assert.ok(!/\p{Script=Han}/u.test(readFileSync(path, 'utf8')), `${path.pathname} contains untranslated documentation`)
    }
  }
}
checkDocs(new URL('../docs/', import.meta.url))
const map = JSON.parse(readFileSync(new URL('../lib/client.js.map', import.meta.url), 'utf8'))
assert.ok(Array.isArray(map.sources) && map.sources.length > 0, 'Client source map must contain sources')
assert.equal(map.sources.length, map.sourcesContent?.length, 'Client source map must embed every source')
for (const [index, source] of map.sources.entries()) {
  if (!source.startsWith('../src/')) continue
  assert.ok(map.sourcesContent[index] === readFileSync(new URL(source, new URL('../lib/', import.meta.url)), 'utf8'),
    `Client bundle is stale relative to ${source}; rebuild both faces before publication`)
}
console.log('English package files, documentation, and repository metadata verified.')
