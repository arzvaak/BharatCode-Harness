#!/usr/bin/env node
// Report remaining translation locations without echoing their source text.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}
let total = 0
for (const path of [...walk('src'), ...walk('docs'), 'README.md', 'README.en.md', 'cordis.patch.yml', 'scripts/clientBundle.ts']) {
  const lines = readFileSync(path, 'utf8').split('\n')
  const locations = lines.flatMap((line, index) => /\p{Script=Han}/u.test(line) ? [index + 1] : [])
  if (!locations.length) continue
  total += locations.length
  console.log(`${path}: ${locations.join(', ')}`)
}
console.log(`Remaining source-language lines: ${total}. Review deliberate persisted identifiers and multilingual input patterns separately.`)
