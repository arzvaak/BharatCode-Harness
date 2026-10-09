#!/usr/bin/env node
// Compare comment-only translations against the original fork contracts.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const baseline = '757c6c738f56935d224031478ff6f221e852fc3a'
const printer = ts.createPrinter({ removeComments: true })
const toolPath = 'src/tools/create.ts'
function toolContracts(text) {
  const file = ts.createSourceFile(toolPath, text, ts.ScriptTarget.Latest, true)
  const names = []
  const enums = []
  const required = []
  function visit(node) {
    if (ts.isPropertyAssignment(node)) {
      if (node.name.getText(file) === 'name' && ts.isStringLiteral(node.initializer)) names.push(node.initializer.text)
      if (node.name.getText(file) === 'enum') enums.push(node.initializer.getText(file))
      if (node.name.getText(file) === 'required') required.push(node.initializer.getText(file))
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { names, enums, required }
}
assert.deepEqual(toolContracts(readFileSync(toolPath, 'utf8')),
  toolContracts(execFileSync('git', ['show', `${baseline}:${toolPath}`], { encoding: 'utf8' })),
  'Tool names and enum schemas must retain their original contracts')
console.log('Tool names and enum schemas preserved')
execFileSync(process.execPath, ['scripts/check-tools-structure.mjs', 'src/index.ts'], { stdio: 'inherit' })
const stylePath = 'src/client/panel.module.css'
const withoutComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '')
assert.ok(withoutComments(readFileSync(stylePath, 'utf8')) === withoutComments(execFileSync('git', ['show', `${baseline}:${stylePath}`], { encoding: 'utf8' })), 'Panel CSS selectors and declarations must remain unchanged')
console.log('Panel CSS selectors and declarations preserved')
for (const path of ['src/types.ts', 'src/config.ts', 'src/client/index.ts', 'src/client/UiStorage.ts', 'src/client/Toast.tsx', 'src/client/css-modules.d.ts']) {
  const parse = text => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const before = execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' })
  const after = readFileSync(path, 'utf8')
  assert.equal(printer.printFile(parse(after)), printer.printFile(parse(before)), `${path}: unexpected structural change`)
  console.log(`${path}: contracts and emitted code preserved`)
}
