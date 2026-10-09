// Session-cost estimate (src/client/cost.ts): the model-price-book lookup
// (exact, case-insensitive, and the model-side resolution tiers behind the
// cross-provider fallback), the USD→CNY conversion at the fixed 1 CNY = 0.15
// USD, the null degradations, the numOf coercion of garbage bucket fields,
// the money/rate formatting, and the deep merge behind the stats board's
// family-scope cost cells.

import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { estimateSessionCost, formatCost, formatPriceRate, mergeCostUsage, priceFaceOf, priceIndexOf, priceOf, toCurrency } from '../../src/client/cost'
import type { ModelBook, ModelPrices } from '../../src/client/cost'
import type { CostBucketTotals } from '../../src/shared/types'

const M = 1_000_000

/** Real-shaped rates (deepseek-v4-flash on models.dev — the official off-peak list; no cache_write published). */
const FLASH = { hit: 0.003, miss: 0.15, write: 0.15, out: 0.6 }
const PRO = { hit: 0.003625, miss: 0.435, write: 0.435, out: 0.87 }
const KIMI = { hit: 0.19, miss: 0.95, write: 0.95, out: 4 }
const K3 = { hit: 0.3, miss: 3, write: 3, out: 15 }

/** The book is keyed by the models.dev provider ids, exactly as extracted. */
const BOOK: ModelPrices = {
  deepseek: { 'deepseek-v4-flash': FLASH, 'deepseek-v4-pro': PRO },
  moonshotai: { 'kimi-k2.7-code': KIMI, 'kimi-k3': K3 },
  'opencode-go': { 'deepseek-v4-flash': FLASH },
}

/** A book plus its resolution index (npm absent → no vendor is "primary"). */
function bookOf(prices: ModelPrices, npmOf: Record<string, string | null> = {}): ModelBook {
  return { prices, index: priceIndexOf(prices, npmOf) }
}

const BOOK_B: ModelBook = bookOf(BOOK)

function bucket(cacheRead: number, uncached: number, cacheWrite: number, output: number): CostBucketTotals {
  return { cacheRead, uncached, cacheWrite, output }
}

function close(actual: number | null, expected: number, message?: string): void {
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, message ?? `expected ~${expected}, got ${actual}`)
}

describe('toCurrency', () => {
  test('USD passes through; CNY divides the fixed 0.15 rate', () => {
    assert.equal(toCurrency(1.2, 'usd'), 1.2)
    close(toCurrency(1.2, 'cny'), 8)
    close(toCurrency(0.3, 'cny'), 2)
  })
})

describe('priceOf', () => {
  test('a mapped dsh provider id resolves to its models.dev branch', () => {
    assert.equal(priceOf(BOOK_B, 'deepseek-official', 'deepseek-v4-flash'), FLASH)
    assert.equal(priceOf(BOOK_B, 'moonshotai', 'kimi-k2.7-code'), KIMI)
    assert.equal(priceOf(BOOK_B, 'deepseek-official', 'deepseek-v4-pro'), PRO, 'both native DeepSeek routes share the branch')
  })

  test('an unmapped dsh provider id passes through to the book verbatim', () => {
    assert.equal(priceOf(BOOK_B, 'opencode-go', 'deepseek-v4-flash'), FLASH)
    assert.equal(priceOf(bookOf({ anthropic: { claude: KIMI } }), 'anthropic', 'claude'), KIMI)
  })

  test('a known provider falls back to a case-insensitive model match', () => {
    assert.equal(priceOf(bookOf({ minimax: { 'MiniMax-M2.5': KIMI } }), 'minimax-cn', 'minimax-m2.5'), KIMI)
  })

  test('a short dsh model id suffix-matches its namespaced registry id', () => {
    assert.equal(priceOf(BOOK_B, 'moonshotai', 'k3'), K3)
    assert.equal(priceOf(BOOK_B, 'moonshotai', 'K3'), K3, 'the suffix tier is case-insensitive too')
  })

  test('several suffix candidates in one branch are ambiguous', () => {
    const book = bookOf({ moonshotai: { 'kimi-k3': K3, 'other-k3': KIMI } })
    assert.equal(priceOf(book, 'moonshotai', 'k3'), null)
  })

  test('a known provider with an unknown model prices null (no cross-provider guess)', () => {
    assert.equal(priceOf(BOOK_B, 'deepseek', 'kimi-k2.7-code'), null)
  })

  test('a provider the book does not carry prices through the model-side index', () => {
    assert.equal(priceOf(BOOK_B, '', 'kimi-k2.7-code'), null)
    assert.equal(priceOf(BOOK_B, 'future-provider', 'kimi-k2.7-code'), null)
    assert.equal(priceOf(BOOK_B, 'any-gateway', 'deepseek-v4-flash'), null)
    assert.equal(priceOf(BOOK_B, '', 'mystery'), null)
  })

  test('a null or missing book prices nothing', () => {
    assert.equal(priceOf(null, 'deepseek-official', 'deepseek-v4-flash'), null)
    assert.equal(priceOf(undefined, '', 'kimi-k2.7-code'), null)
    assert.equal(priceOf(bookOf({}), '', 'kimi-k2.7-code'), null)
  })
})

describe('provider billing isolation', () => {
  test('custom gateways and subscription plans never inherit model vendor API prices', () => {
    for (const provider of ['codex', 'claude', 'grok', 'copilot', 'antigravity', 'deepseek-account', 'kimi-coding', 'zhipuai', 'bharatcode', 'custom-route', '']) {
      assert.equal(priceOf(BOOK_B, provider, 'deepseek-v4-flash'), null)
    }
    assert.equal(priceOf(BOOK_B, 'custom-route', 'vendor/deepseek-v4-flash'), null)
  })
  test('the retained catalog index skips hostile entries and deduplicates equal-rate tails', () => {
    const R = { hit: 1, miss: 1, write: 1, out: 1 }
    const idx = priceIndexOf({ junk: 5, broken: { x: 'nope' }, partial: { x: { hit: 1 } }, a: { 'x-y': R, 'z-y': R }, b: { y: { ...R, hit: 2 } } } as unknown as ModelPrices, { a: '@ai-sdk/a' })
    assert.equal(idx.byModel.get('y')?.length, 2)
    assert.equal(idx.byModel.get('x'), undefined)
  })
})

describe('estimateSessionCost', () => {
  test('null usage or null book prices to null', () => {
    assert.equal(estimateSessionCost(null, BOOK_B, 'usd'), null)
    assert.equal(estimateSessionCost(undefined, BOOK_B, 'cny'), null)
    assert.equal(estimateSessionCost({}, null, 'usd'), null)
  })

  test('usage without any priced bucket returns null', () => {
    assert.equal(estimateSessionCost({}, BOOK_B, 'usd'), null)
    assert.equal(estimateSessionCost({ 'deepseek-official': { unknown: { peak: bucket(0, M, 0, 0) } } }, BOOK_B, 'usd'), null)
  })

  test('a provider id the registry does not know still prices by model id', () => {
    // The issue #91 shape: a subscription/proxy route (`claude`, a gateway)
    // whose models live under the vendor's registry branch.
    assert.equal(estimateSessionCost({ unmapped: { 'deepseek-v4-flash': { peak: bucket(0, M, 0, 0) } } }, BOOK_B, 'usd'), null)
  })

  test('prices every period bucket at its own rate (hit / miss / write / out)', () => {
    const usage = {
      'deepseek-official': {
        'deepseek-v4-flash': { off: bucket(M, M, M, M) },
        'deepseek-v4-pro': { off: bucket(M, M, M, M) },
      },
      'moonshotai': { 'kimi-k2.7-code': { peak: bucket(0, M, 0, M) } },
    }
    close(estimateSessionCost(usage, BOOK_B, 'usd'), 0.903 + (0.003625 + 0.435 + 0.435 + 0.87) + 0.95 + 4)
  })

  test('peak buckets price at twice the book rate for DeepSeek only', () => {
    const split = { peak: bucket(0, M, 0, 0), off: bucket(0, M, 0, 0) }
    close(estimateSessionCost({ 'deepseek-official': { 'deepseek-v4-flash': split } }, BOOK_B, 'usd'), 0.3 + 0.15)
    close(
      estimateSessionCost({ 'moonshotai': { 'kimi-k2.7-code': split } }, BOOK_B, 'usd'),
      0.95 + 0.95,
      'a flat-rate provider bills a peak bucket at book price, never doubled',
    )
    // The account route shares DeepSeek's period list, so its peak buckets
    // double too — the fold splits them only since providers.ts maps it.
    close(estimateSessionCost({ 'deepseek-official': { 'deepseek-v4-flash': split } }, BOOK_B, 'usd'), 0.3 + 0.15)
  })

  test('mixed known and unpriced usage does not present a priced subtotal as the total', () => {
    assert.equal(estimateSessionCost({ 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(0, M, 0, 0) }, missing: { peak: bucket(0, M, 0, 0) } } }, BOOK_B, 'usd'), null)
    assert.equal(estimateSessionCost({ bharatcode: { 'deepseek-v4-flash': { peak: bucket(0, M, 0, 0) } }, 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(0, M, 0, 0) } } }, BOOK_B, 'usd'), null)
  })

  test('the CNY currency converts the USD total at 1 CNY = 0.15 USD', () => {
    const usage = { 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(0, M, 0, 0) } } }
    // 1M peak-window miss bills the official CNY peak price: ¥2.
    close(estimateSessionCost(usage, BOOK_B, 'cny'), 2)
  })

  test('non-number bucket fields are coerced to zero by numOf', () => {
    const garbage = { cacheRead: NaN, uncached: 'x', cacheWrite: undefined, output: Infinity } as unknown as CostBucketTotals
    assert.equal(estimateSessionCost({ 'deepseek-official': { 'deepseek-v4-flash': { peak: garbage } } }, BOOK_B, 'usd'), 0)
  })

  test('garbage fields degrade while real fields still price', () => {
    const mixed = { cacheRead: M, uncached: NaN, cacheWrite: M / 2, output: 'junk' } as unknown as CostBucketTotals
    close(estimateSessionCost({ 'deepseek-official': { 'deepseek-v4-flash': { peak: mixed } } }, BOOK_B, 'usd'), 2 * (0.003 + 0.5 * 0.15))
  })

  test('hostile provider branches, periods, and buckets are skipped, not fatal', () => {
    const usage = {
      junk: 'x',
      'moonshotai': { broken: null, 'kimi-k2.7-code': { peak: 'junk', off: bucket(0, M, 0, 0) } },
      'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(0, M, 0, 0) } },
    } as unknown as { [provider: string]: Record<string, Record<string, CostBucketTotals>> }
    close(estimateSessionCost(usage, BOOK_B, 'usd'), 0.3 + 0.95)
  })
})

describe('mergeCostUsage', () => {
  test('sums every bucket across usages, keyed by provider, model, and period', () => {
    const merged = mergeCostUsage(
      { 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(M, 0, 0, 0) } } },
      {
        'deepseek-official': {
          'deepseek-v4-flash': { peak: bucket(2 * M, 0, 0, 0), off: bucket(0, M, 0, 0) },
          'deepseek-v4-pro': { peak: bucket(0, 0, 0, M) },
        },
        'moonshotai': { 'kimi-k2.7-code': { peak: bucket(0, 3 * M, 0, 0) } },
      },
    )
    assert.deepEqual(merged, {
      'deepseek-official': {
        'deepseek-v4-flash': { peak: bucket(3 * M, 0, 0, 0), off: bucket(0, M, 0, 0) },
        'deepseek-v4-pro': { peak: bucket(0, 0, 0, M) },
      },
      'moonshotai': { 'kimi-k2.7-code': { peak: bucket(0, 3 * M, 0, 0) } },
    })
  })

  test('the merged estimate equals the sum of the sides priced apart', () => {
    const a = { 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(M, M, 0, 0) } } }
    const b = { 'moonshotai': { 'kimi-k2.7-code': { peak: bucket(0, 2 * M, 0, 0) } } }
    const total = estimateSessionCost(mergeCostUsage(a, b), BOOK_B, 'usd')
    close(total ?? 0, (estimateSessionCost(a, BOOK_B, 'usd') ?? 0) + (estimateSessionCost(b, BOOK_B, 'usd') ?? 0))
  })

  test('null and absent sides drop out; nothing usable merges to null', () => {
    const usage = { 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(M, 0, 0, 0) } } }
    assert.deepEqual(mergeCostUsage(null, usage, undefined), usage)
    assert.equal(mergeCostUsage(null, undefined, null), null)
    assert.equal(mergeCostUsage(), null)
  })

  test('a bucket that merged with only zeros still counts (the estimator prices $0, not a dash)', () => {
    const zero = { 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(0, 0, 0, 0) } } }
    assert.deepEqual(mergeCostUsage(zero), zero)
    assert.equal(estimateSessionCost(mergeCostUsage(zero), BOOK_B, 'usd'), 0)
  })

  test('hostile branches are skipped, not fatal, and the inputs never mutate', () => {
    const a = { 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(M, 0, 0, 0) } } }
    const hostile = {
      junk: 5,
      arr: [{ peak: bucket(M, 0, 0, 0) }],
      'moonshotai': { broken: null, 'kimi-k2.7-code': { peak: 'junk', off: bucket(0, M, 0, 0) } },
    } as unknown as Record<string, never>
    const merged = mergeCostUsage(a, hostile)
    assert.deepEqual(merged, {
      'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(M, 0, 0, 0) } },
      'moonshotai': { 'kimi-k2.7-code': { off: bucket(0, M, 0, 0) } },
    })
    assert.deepEqual(a, { 'deepseek-official': { 'deepseek-v4-flash': { peak: bucket(M, 0, 0, 0) } } }, 'the source usage stays untouched')
  })
})

describe('priceFaceOf', () => {
  test('names the registry face every resolution path lands on', () => {
    // Direct branch: the dsh provider's rename maps onto the registry id.
    assert.deepEqual(priceFaceOf(BOOK_B, 'deepseek-official', 'deepseek-v4-flash'), { pid: 'deepseek', mid: 'deepseek-v4-flash', rate: FLASH })
    assert.deepEqual(priceFaceOf(BOOK_B, 'moonshotai', 'k3'), { pid: 'moonshotai', mid: 'kimi-k3', rate: K3 }, 'the suffix path names the full registry spelling')
    // First-party seam: a deepseek- id prices from DeepSeek's own branch.
    assert.equal(priceFaceOf(BOOK_B, 'future-gateway', 'deepseek-v4-pro'), null)
    // Model-side tiers: the winning candidate's own face.
    assert.equal(priceFaceOf(BOOK_B, 'any-gateway', 'kimi-k2.7-code'), null)
    assert.equal(priceFaceOf(BOOK_B, '', 'mystery'), null)
    assert.equal(priceFaceOf(null, 'deepseek-official', 'deepseek-v4-flash'), null)
  })
})

describe('formatCost', () => {
  test('amounts of at least 1 use fixed two-decimal notation', () => {
    assert.equal(formatCost(3.456, 'usd'), '$3.46')
    assert.equal(formatCost(1, 'usd'), '$1.00')
  })

  test('amounts below 1 use two-significant-digit precision', () => {
    assert.equal(formatCost(0.014, 'usd'), '$0.014')
    assert.equal(formatCost(0.5, 'usd'), '$0.50')
  })

  test('the CNY currency uses the yen symbol', () => {
    assert.equal(formatCost(12.3, 'cny'), '¥12.30')
    assert.equal(formatCost(0.66, 'cny'), '¥0.66')
  })
})

describe('formatPriceRate', () => {
  test('always renders two decimals in the currency symbol', () => {
    assert.equal(formatPriceRate(3, 'cny'), '¥3.00')
    assert.equal(formatPriceRate(4.5, 'cny'), '¥4.50')
    assert.equal(formatPriceRate(0.007, 'usd'), '$0.01')
    assert.equal(formatPriceRate(0.1, 'usd'), '$0.10')
  })
})
