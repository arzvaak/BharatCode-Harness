import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_PROVIDER_PRICE_TABLE as CORE_PROVIDER_PRICES, DEFAULT_PRICE_TABLE, buildPriceCatalog, costOf, normalizePrice, providerPriceEntryFor, usdFromCost } from '../lib/pricing.js'

// MiMo is unqualified in BC. Explicit fixture-owned rates exercise arithmetic,
// currency and route isolation without introducing automatic provider prices.
const models = {
  'mimo-v2.6-pro': { cacheHit: 0.0036, cacheMiss: 0.435, output: 0.87, cny: { cacheHit: 0.025, cacheMiss: 3, output: 6 } },
  'mimo-v2.6-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28, cny: { cacheHit: 0.02, cacheMiss: 1, output: 2 } },
  'mimo-v2.6-pro-ultraspeed': { cacheHit: 0.036, cacheMiss: 4.35, output: 8.7, cny: { cacheHit: 0.25, cacheMiss: 30, output: 60 } },
  'mimo-v2.5': { input: 0.14, output: 0.28, notes: '即将下线 fixture' },
  'mimo-v2.5-pro': { input: 0.435, output: 0.87, notes: '即将下线 fixture' },
}
const DEFAULT_PROVIDER_PRICE_TABLE = { ...CORE_PROVIDER_PRICES, xiaomi: { models }, 'opencode-go': { models: {
  'mimo-v2.6-pro': { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
  'mimo-v2.6-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
} } }
assert.equal(CORE_PROVIDER_PRICES.xiaomi, undefined, 'Unqualified MiMo has no automatic tariff')
const prices = { models: DEFAULT_PRICE_TABLE, default: DEFAULT_PRICE_TABLE.default, providers: DEFAULT_PROVIDER_PRICE_TABLE }
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} != ${expected}`)
const tiersOf = (provider, model) => {
  const r = providerPriceEntryFor(provider, model, prices, { mode: 'auto' })
  assert.equal(r.priced, true, `${provider}/${model} 已定价`)
  return r.entry
}

// ① xiaomi 目录:三型号三档价锁定。
{
  const pro = tiersOf('xiaomi', 'mimo-v2.6-pro')
  near(pro.cacheHit, 0.0036, 'pro 命中价')
  near(pro.cacheMiss, 0.435, 'pro 未命中价')
  near(pro.output, 0.87, 'pro 输出价')
  const flash = tiersOf('xiaomi', 'mimo-v2.6-flash')
  near(flash.cacheHit, 0.0028, 'flash 命中价')
  near(flash.cacheMiss, 0.14, 'flash 未命中价')
  near(flash.output, 0.28, 'flash 输出价')
  const ultra = tiersOf('xiaomi', 'mimo-v2.6-pro-ultraspeed')
  near(ultra.cacheHit, 0.036, 'ultraspeed 命中价')
  near(ultra.cacheMiss, 4.35, 'ultraspeed 未命中价')
  near(ultra.output, 8.7, 'ultraspeed 输出价')
}

// ② 速度优先档不再套 2.5 价(回归:模糊匹配曾把 2.6 全系落到 mimo-v2.5)。
{
  const ultra = tiersOf('xiaomi', 'mimo-v2.6-pro-ultraspeed')
  const pro = tiersOf('xiaomi', 'mimo-v2.6-pro')
  near(ultra.cacheMiss, pro.cacheMiss * 10, 'ultraspeed 未命中价为 pro 的 10 倍')
  // 人民币价为独立可计费档位，不通过展示汇率推导。
  for (const [id, hit, miss, output] of [['mimo-v2.6-pro', 0.025, 3, 6], ['mimo-v2.6-flash', 0.02, 1, 2], ['mimo-v2.6-pro-ultraspeed', 0.25, 30, 60]]) {
    const cny = DEFAULT_PROVIDER_PRICE_TABLE.xiaomi.models[id].cny
    near(cny.cacheHit, hit, `${id} 人民币命中价`)
    near(cny.cacheMiss, miss, `${id} 人民币未命中价`)
    near(cny.output, output, `${id} 人民币输出价`)
  }
  assert.notEqual(ultra.cacheMiss, DEFAULT_PROVIDER_PRICE_TABLE.xiaomi.models['mimo-v2.5'].input, '未误套 mimo-v2.5 价')
  assert.notEqual(pro.cacheMiss, DEFAULT_PROVIDER_PRICE_TABLE.xiaomi.models['mimo-v2.5'].input, 'pro 未误套 mimo-v2.5 价')
  // 变体形态(大小写 / 日期快照后缀)同样精确命中 2.6 条目。
  for (const variant of ['MiMo-V2.6-Pro-UltraSpeed', 'mimo-v2.6-pro-ultraspeed-2026-09-28']) {
    assert.equal(providerPriceEntryFor('xiaomi', variant, prices).priced, false, 'Unconfigured variant stays unpriced')
  }
  for (const variant of ['MiMo-V2.6-Pro', 'mimo-v2.6-pro-2026-09-28']) {
    assert.equal(providerPriceEntryFor('xiaomi', variant, prices).priced, false, 'Unconfigured variant stays unpriced')
  }
}

// ③ DSH 侧渠道别名与空 provider 走同一份价(跨目录兜底取 xiaomi 条目)。
{
  for (const provider of ['mimo', 'xiaomimimo', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', '']) {
    assert.equal(providerPriceEntryFor(provider, 'mimo-v2.6-pro-ultraspeed', prices).priced, false, 'No cross-route fallback')
    assert.equal(providerPriceEntryFor(provider, 'mimo-v2.6-flash', prices).priced, false, 'No cross-route fallback')
  }
}

// ④ opencode-go 目录:2.6-Pro / 2.6-Flash 在册(随 Go 表值),2.5 系不变。
{
  const goPro = tiersOf('opencode-go', 'mimo-v2.6-pro')
  near(goPro.cacheHit, 0.003625, 'Go 目录 pro 命中价(表值)')
  near(goPro.cacheMiss, 0.435, 'Go 目录 pro 未命中价')
  near(goPro.output, 0.87, 'Go 目录 pro 输出价')
  const goFlash = tiersOf('opencode-go', 'mimo-v2.6-flash')
  near(goFlash.cacheHit, 0.0028, 'Go 目录 flash 命中价')
  near(goFlash.cacheMiss, 0.14, 'Go 目录 flash 未命中价')
  // Go 目录没有速度优先档，不应套用普通 pro 的价格。
  const goUltra = providerPriceEntryFor('opencode-go', 'mimo-v2.6-pro-ultraspeed', prices, { mode: 'auto' })
  assert.equal(goUltra.priced, false, 'Go 目录内 ultraspeed 保持未定价')
  assert.equal(providerPriceEntryFor('openai-codex', 'gpt-6-luna', prices).priced, false, 'Subscription route has no API tariff')
  assert.equal(providerPriceEntryFor('openai-codex', 'gpt-6-astra-unlisted-variant', prices).priced, false, '未知 GPT-6 变体不借用 Astra 价格')
  const old = DEFAULT_PROVIDER_PRICE_TABLE.xiaomi.models
  near(old['mimo-v2.5'].input, 0.14, '2.5 未命中价保持不变')
  near(old['mimo-v2.5'].output, 0.28, '2.5 输出价保持不变')
  near(old['mimo-v2.5-pro'].input, 0.435, '2.5-pro 未命中价保持不变')
  near(old['mimo-v2.5-pro'].output, 0.87, '2.5-pro 输出价保持不变')
  assert.ok(String(old['mimo-v2.5'].notes).includes('即将下线'), '2.5 标注官方下线提示')
  assert.ok(String(old['mimo-v2.5-pro'].notes).includes('即将下线'), '2.5-pro 标注官方下线提示')
}

// CNY 模式选官方人民币档位，再按显示汇率折回账本美元；无 CNY 档位仍按美元计。
{
  const cnyPrices = { ...prices, currency: 'CNY' }
  const pro = providerPriceEntryFor('xiaomi', 'mimo-v2.6-pro', cnyPrices)
  assert.equal(pro.currency, 'CNY')
  near(pro.entry.cacheMiss, 3, '人民币官方输入价')
  near(usdFromCost(costOf({ input: 1_000_000, output: 1_000_000 }, pro.entry, Date.now(), { enabled: false }), pro.currency, 7.2), 9 / 7.2, '人民币计价折回美元')
  const go = providerPriceEntryFor('opencode-go', 'mimo-v2.6-pro', cnyPrices)
  assert.equal(go.currency, 'USD', '无人民币价的 Go 条目按美元计')
  assert.equal(normalizePrice({ input: 1, output: 2, cny: { cacheHit: -1, cacheMiss: 2, output: 3 } }), null, '非法人民币档位被拒绝')
}

// Shipped defaults stay synchronized and exclude unqualified routes.
{
  const catalog = buildPriceCatalog()
  assert.equal(catalog.xiaomi, undefined)
  assert.equal(catalog['opencode-go'], undefined)
  const shipped = JSON.parse(readFileSync(new URL('../docs/provider-pricing.json', import.meta.url), 'utf8'))
  assert.deepEqual(shipped, CORE_PROVIDER_PRICES)
}

// ⑥ 计价冒烟:1M 未命中输入 + 1M 输出。
{
  const now = Date.parse('2026-09-28T06:00:00Z')
  const noPeak = { enabled: false }
  near(costOf({ input: 1_000_000, output: 1_000_000 }, normalizePrice(DEFAULT_PROVIDER_PRICE_TABLE.xiaomi.models['mimo-v2.6-pro']), now, noPeak), 1.305, 'pro 1M+1M = $1.305')
  near(costOf({ input: 1_000_000, output: 1_000_000 }, normalizePrice(DEFAULT_PROVIDER_PRICE_TABLE.xiaomi.models['mimo-v2.6-pro-ultraspeed']), now, noPeak), 13.05, 'ultraspeed 1M+1M = $13.05')
  near(costOf({ input: 1_000_000, output: 1_000_000 }, normalizePrice(DEFAULT_PROVIDER_PRICE_TABLE.xiaomi.models['mimo-v2.6-flash']), now, noPeak), 0.42, 'flash 1M+1M = $0.42')
}

console.log('[ok] mimo-v26-pricing')
