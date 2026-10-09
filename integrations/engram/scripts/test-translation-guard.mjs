#!/usr/bin/env node
// Verify the structural audit itself without modifying repository fixtures.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const text = readFileSync(new URL('./check-tools-structure.mjs', import.meta.url), 'utf8')
const start = text.indexOf('function shape(')
const end = text.indexOf('for (const path of paths)')
assert.ok(start >= 0 && end > start, 'Structural guard function not found')
const shape = new Function('ts', text.slice(start, end) + ';return shape;')(ts)
const compare = (source, path = 'src/probe.ts') => JSON.stringify(shape(source, path))
assert.notEqual(compare('const r=/safe/'), compare('const r=/unsafe/'))
assert.notEqual(compare('const limit=10'), compare('const limit=11'))
assert.notEqual(compare('const first=1'), compare('const second=1'))
assert.notEqual(compare('call(first)'), compare('call(second)'))
assert.notEqual(compare('const label=`Value ${first}`'), compare('const label=`Value ${second}`'))
assert.equal(compare('const label=`Before ${first}`'), compare('const label=`After ${first}`'))
assert.equal(compare('const label="before"'), compare('const label="after"'))
assert.equal(compare('expect(x).toMatch(/before/)', 'tests/probe.spec.ts'), compare('expect(x).toMatch(/after/)', 'tests/probe.spec.ts'))
console.log('Translation guard mutation checks passed')
