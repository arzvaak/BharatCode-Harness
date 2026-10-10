#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

// Report every incomplete face together, rather than hiding failures behind the first locale.
const untranslated = []
for (const path of ['src/client/locales.ts', 'src/client/EngramPanel.tsx', 'src/client/CorridorMap.tsx', 'src/client/Toast.tsx', 'src/client/UiStorage.ts', 'src/client/index.ts', 'src/client/panel.module.css', 'src/page.ts', 'src/tools/create.ts', 'src/config.ts', 'src/types.ts', 'README.md', 'README.en.md', 'cordis.patch.yml', 'lib/client.js', 'lib/client.js.map']) {
  const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  if (/\p{Script=Han}/u.test(text)) untranslated.push(path)
}
assert.equal(untranslated.length, 0, `Untranslated English surfaces: ${untranslated.join(', ')}`)
const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
assert.ok(host.includes('onnx-community/granite-embedding-small-english-r2-ONNX'), 'Host must use the English model')
console.log('English UI and model surface checks passed.')
