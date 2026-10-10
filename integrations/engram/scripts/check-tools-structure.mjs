#!/usr/bin/env node
// Ignore translated text, but preserve code structure and template expression sets.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const paths = process.argv.slice(2)
if (paths.length === 0) paths.push('src/tools/create.ts')
function shape(text, path) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return ['STRING']
    if (ts.isTemplateExpression(node)) {
      // English grammar can reorder interpolation without changing the values used.
      return ['TemplateExpression', node.templateSpans.map(span => visit(span.expression)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]
    }
    const children = []
    ts.forEachChild(node, child => { children.push(visit(child)) })
    return [ts.SyntaxKind[node.kind], ts.isIdentifier(node) || ts.isNumericLiteral(node) || (path.startsWith('src/') && node.kind === ts.SyntaxKind.RegularExpressionLiteral) ? node.text : '', children]
  }
  return visit(file)
}
for (const path of paths) {
  const baseline = execFileSync('git', ['show', '757c6c738f56935d224031478ff6f221e852fc3a:' + path], { encoding: 'utf8' })
  const current = readFileSync(path, 'utf8')
  assert.ok(JSON.stringify(shape(current, path)) === JSON.stringify(shape(baseline, path)), `${path}: unexpected structural change`)
  if (path.startsWith('src/')) {
    function stableStrings(text) {
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const values = []
      function visit(node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) values.push(node.text)
        ts.forEachChild(node, visit)
      }
      visit(file)
      return values
    }
    const oldValues = stableStrings(baseline)
    const newValues = stableStrings(current)
    assert.equal(newValues.length, oldValues.length, `${path}: string literal count changed`)
    oldValues.forEach((value, index) => {
      if (!/[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(value)) assert.ok(newValues[index] === value, `${path}: stable string ${index} changed`)
    })
  }
  console.log(`${path}: structure, identifiers, numeric values, and interpolation expression sets preserved.`)
}
