import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

describe('English tool schema surfaces', () => {
  it('keeps tool and parameter descriptions English', () => {
    const path = new URL('../src/tools/create.ts', import.meta.url)
    const file = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    let descriptions = 0
    function visit(node: ts.Node): void {
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'description') {
        descriptions++
        expect(node.initializer.getText(file), `Description at offset ${node.pos}`).not.toMatch(/\p{Script=Han}/u)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    expect(descriptions).toBeGreaterThan(100)
  })
})
