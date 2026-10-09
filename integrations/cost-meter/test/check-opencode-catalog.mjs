#!/usr/bin/env node
/** Check current provider-scoped Zen/Go endpoint prices against public source tables.
 * No account, credential or billable API is used. Legacy vendor snapshots are not
 * compared with a gateway they merely cite. Usage:
 *   node test/check-opencode-catalog.mjs
 *   node test/check-opencode-catalog.mjs --fixture=/path/to/verified-opencode-catalog.json
 * Fixtures contain the independently captured audit.endpoints/audit.priceRows data.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_PROVIDER_PRICE_TABLE, normalizePrice } from '../lib/pricing.js'

const PAGES = [
  { provider: 'opencode-zen', fixtureProvider: 'opencode', url: 'https://opencode.ai/docs/zen' },
  { provider: 'opencode-go', url: 'https://opencode.ai/docs/go' },
]
const EPS = 1e-9
const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|le|ge);/g, entity => ({
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&le;': '≤', '&ge;': '≥',
})[entity]).replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => {
  const point = parseInt(hex ?? dec, hex ? 16 : 10)
  return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
})
// Source data is compared only; stripped HTML is never executed or rendered.
const cellsOf = row => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match =>
  decode(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()) // codeql[js/incomplete-multi-character-sanitization]
const canon = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '')
const rate = text => {
  if (text === 'Free') return 0
  if (text === '-') return undefined
  if (!/^\$\d+(?:\.\d+)?$/.test(text)) throw new Error(`Unrecognized price ${JSON.stringify(text)}`)
  return Number(text.slice(1))
}

function parsePage(html) {
  const endpoints = [], priceRows = []
  for (const table of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [...table[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(match => cellsOf(match[0])).filter(row => row.length)
    const header = rows[0] ?? []
    if (header.join('|') === 'Model|Model ID|Endpoint|AI SDK Package') endpoints.push(...rows.slice(1))
    if (header.slice(0, 5).join('|') === 'Model|Input|Output|Cached Read|Cached Write') priceRows.push(...rows.slice(1).map(row => row.slice(0, 5)))
  }
  return { endpoints, priceRows }
}

function priceRow(row) {
  const display = row[0]
  const context = display.match(/\((≤|>)\s*(\d+)K\s+tokens\)\s*$/)
  const peak = display.match(/\((Off-Peak|Peak)\)\s*$/)
  const match = context ?? peak
  const name = match ? display.slice(0, match.index).trim() : display
  const tier = peak ? peak[1] === 'Peak' ? 'peak' : 'offPeak' : context?.[1] === '>' ? 'longContext' : 'base'
  const rates = Object.fromEntries(['input', 'output', 'cachedInput', 'cacheWrite'].map((key, i) => [key, rate(row[i + 1])]))
  return { name, tier, aboveInputTokens: context ? Number(context[2]) * 1000 : undefined, rates, raw: row }
}

function verifyPage(page, data) {
  const errors = [], warnings = [], models = DEFAULT_PROVIDER_PRICE_TABLE[page.provider]?.models ?? {}
  const nameToId = new Map(data.endpoints.map(row => [canon(row[0]), row[1]]))
  const grouped = new Map()
  for (const row of data.priceRows) {
    try {
      const parsed = priceRow(row), id = nameToId.get(canon(parsed.name))
      if (!id) { errors.push(`Price row has no endpoint ID: ${row[0]}`); continue }
      const key = `${id}:${parsed.tier}`
      const group = grouped.get(key) ?? { id, tier: parsed.tier, rows: [] }
      group.rows.push(parsed); grouped.set(key, group)
    } catch (error) { errors.push(error.message) }
  }
  const seen = new Set()
  for (const group of grouped.values()) {
    const { id, tier, rows } = group
    seen.add(id)
    const raw = models[id], entry = normalizePrice(raw)
    if (!entry || entry.unpriced === true) { errors.push(`${id}: missing verified price`); continue }
    const target = tier === 'base' ? entry : entry[tier]
    if (!target) { errors.push(`${id}: missing ${tier}`); continue }
    if (tier === 'longContext' && target.aboveInputTokens !== rows[0].aboveInputTokens) errors.push(`${id}: wrong context threshold`)
    if ((tier === 'peak' || tier === 'offPeak') && raw.billingMode !== 'utc-peak') errors.push(`${id}: gateway peak row must use UTC schedule, not direct DeepSeek history`)
    for (const [sourceKey, targetKey] of [['input', 'cacheMiss'], ['output', 'output'], ['cachedInput', 'cacheHit'], ['cacheWrite', 'cacheWrite']]) {
      const values = rows.map(row => row.rates[sourceKey])
      const distinct = [...new Set(values)]
      // Go/Go Plus currently disagree for MiniMax M2.7's write cell. A dash is
      // unspecified, not zero. Neither positive nor missing wins by table order.
      if (distinct.length > 1) {
        if (page.provider === 'opencode-go' && id === 'minimax-m2.7' && sourceKey === 'cacheWrite'
          && distinct.includes(undefined) && distinct.includes(0.375)) {
          warnings.push(`${id}: Go cache write unspecified, Go Plus $0.375; published narrative says same pricing, so write rate remains unresolved`)
        } else errors.push(`${id}/${tier}/${sourceKey}: conflicting source rows ${distinct.map(value => value ?? 'unspecified').join(', ')}`)
        continue
      }
      const expected = distinct[0]
      // Unspecified source cells cannot establish a new cache charge or discount.
      if (expected === undefined) continue
      if (typeof target[targetKey] !== 'number' || Math.abs(target[targetKey] - expected) > EPS) errors.push(`${id}/${tier}/${sourceKey}: ${target[targetKey] ?? 'missing'} != ${expected}`)
    }
  }
  for (const row of data.endpoints) if (!seen.has(row[1])) errors.push(`${row[1]}: endpoint has no parsed pricing row`)
  for (const id of Object.keys(models)) if (!data.endpoints.some(row => row[1] === id)) warnings.push(`${id}: local snapshot not in current endpoint table; may have been retired since capture`)
  return { endpointCount: data.endpoints.length, rowCount: grouped.size, errors, warnings }
}

// Small deterministic parsing sentinels run even when the online pages are unavailable.
assert.equal(rate('Free'), 0)
assert.equal(rate('-'), undefined)
assert.equal(priceRow(['Model (≤ 272K tokens)', '$2', '$10', '$0.2', '$2.5']).tier, 'base')
assert.equal(priceRow(['Model (> 256K tokens)', '$1.2', '$4.8', '$0.12', '$1.5']).aboveInputTokens, 256000)
assert.equal(priceRow(['Model (Off-Peak)', '$0.15', '$0.60', '$0.003', '-']).tier, 'offPeak')
assert.equal(priceRow(['Model (Peak)', '$0.30', '$1.20', '$0.006', '-']).tier, 'peak')
const sample = parsePage('<table><tr><th>Model</th><th>Model ID</th><th>Endpoint</th><th>AI SDK Package</th></tr><tr><td>Free Model</td><td>free-model</td><td>https://example.invalid</td><td>-</td></tr></table><table><tr><th>Model</th><th>Input</th><th>Output</th><th>Cached Read</th><th>Cached Write</th></tr><tr><td>Free Model</td><td>Free</td><td>Free</td><td>Free</td><td>-</td></tr></table>')
assert.equal(sample.endpoints[0][1], 'free-model')
assert.equal(sample.priceRows[0][1], 'Free')

const fixtureArg = process.argv.slice(2).find(arg => arg.startsWith('--fixture='))
const fixture = fixtureArg ? JSON.parse(readFileSync(fixtureArg.slice('--fixture='.length), 'utf8')) : null
let errorCount = 0, checked = 0
for (const page of PAGES) {
  try {
    let data
    if (fixture) {
      const audit = fixture.audit?.[page.fixtureProvider ?? page.provider]
      if (!audit) throw new Error(`Fixture lacks audit.${page.provider}`)
      data = { endpoints: audit.endpoints, priceRows: audit.priceRows.map(item => item.row) }
    } else {
      const response = await fetch(page.url, { headers: { 'user-agent': 'dsh-cost-meter-check/2.0' }, redirect: 'error', signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${page.url}`)
      data = parsePage(await response.text())
    }
    if (!data.endpoints.length || !data.priceRows.length) throw new Error('No endpoint or price tables parsed')
    const result = verifyPage(page, data)
    checked += result.endpointCount; errorCount += result.errors.length
    console.log(`${page.provider}: ${result.endpointCount} endpoint IDs, ${result.rowCount} price tiers`)
    for (const warning of result.warnings) console.warn(`  warning: ${warning}`)
    for (const error of result.errors) console.error(`  mismatch: ${error}`)
  } catch (error) { console.error(`${page.provider}: ${error.message}`); errorCount++ }
}
console.log(`Checked ${checked} provider-scoped models; ${errorCount} errors${fixture ? ' (captured source fixture)' : ' (live primary sources)'}`)
process.exitCode = errorCount ? 1 : 0
