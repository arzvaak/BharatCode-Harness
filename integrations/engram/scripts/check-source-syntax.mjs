#!/usr/bin/env node
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : /\.tsx?$/.test(path) ? [path] : []
  })
}
let failures = 0
const directories = process.argv.slice(2)
if (directories.length === 0) directories.push('src', 'tests')
for (const path of directories.flatMap(walk)) {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  for (const diagnostic of file.parseDiagnostics) {
    const position = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
    console.error(`${path}:${position.line + 1}:${position.character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
    failures++
  }
}
if (failures) process.exit(1)
console.log('All source files parse successfully.')
