#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const playwrightPath = process.env.PLAYWRIGHT_MODULE
assert.ok(playwrightPath, 'Set PLAYWRIGHT_MODULE to the installed playwright index.mjs')
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const source = readFileSync(new URL('../src/page.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('page.ts', source, ts.ScriptTarget.Latest, true)
let html
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'PAGE_HTML'
    && node.initializer && ts.isNoSubstitutionTemplateLiteral(node.initializer)) html = node.initializer.text
  ts.forEachChild(node, visit)
}
visit(parsed)
assert.ok(html, 'Standalone page template must be available without runtime interpolation')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/engram/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [], records: [], total: 0, scopes: [], rooms: [], workspaces: [], projects: [], stats: {}, items: [] }) }))
  await page.route('http://engram.test/', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }))
  await page.goto('http://engram.test/')
  await page.waitForLoadState('networkidle')
  const text = await page.locator('body').innerText()
  assert.ok(!/\p{Script=Han}/u.test(text), 'Standalone page still renders untranslated text')
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  assert.ok(text.length > 100, 'Page must render meaningful content')
  for (const scope of ['user', 'project']) {
    await page.locator(`#scopeTabs button[data-scope="${scope}"]`).click()
    await page.waitForLoadState('networkidle')
    assert.ok(!/\p{Script=Han}/u.test(await page.locator('body').innerText()), `${scope} scope still renders untranslated text`)
  }
  const labels = await page.locator('[aria-label], [title], input[placeholder], textarea[placeholder]').evaluateAll(elements => elements.flatMap(element => ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name) ?? '')))
  assert.ok(labels.every(label => !/\p{Script=Han}/u.test(label)), 'Accessibility labels and input hints must also be English')
  assert.deepEqual(errors, [], 'Standalone page must not throw browser exceptions')
  console.log('Standalone English page rendered successfully in an isolated browser.')
} finally {
  await browser.close()
}
