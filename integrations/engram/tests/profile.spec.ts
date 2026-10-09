import { describe, expect, it } from 'vitest'
import { renderProfile, renderProfileDetailed, renderProfileWithCurated, CURATED_HEADER } from '../src/index.ts'
import { estimateTokens } from '../src/token.ts'

const HEADER = 'User memory profile (dsh-engram, cross-session) — Grand Hall (always present):'
const FOOTER = 'Use engram_search to recall details (pass room to search inside one room); use engram_save to persist new facts.'
const est = estimateTokens
const OVERHEAD = est(HEADER) + est(FOOTER)

const record = (id: string, kind: string, content: string) => ({ id, kind, content })

describe('renderProfile budget fill', () => {
  it('fills whole lines when the budget is sufficient', () => {
    const text = renderProfile([
      record('id-1', 'preference', 'prefers concise replies'),
      record('id-2', 'fact', 'building a memory plugin'),
    ], 1024)
    const lines = text.split('\n')
    expect(lines[0]).toBe(HEADER)
    expect(lines.at(-1)).toBe(FOOTER)
    expect(text).toContain('- [preference] prefers concise replies')
    expect(text).toContain('- [fact] building a memory plugin')
    expect(text).not.toContain('#id-')
    expect(text).not.toContain('more; use engram_search')
  })

  it('skips a whole line that overflows the budget, keeps shorter lines; skipped entries degrade to index lines', () => {
    const long = record('id-long', 'fact', 'x'.repeat(400))
    const short = record('id-short', 'fact', 'brief')
    const shortLine = `- [fact] ${short.content}`
    const indexLine = `- [fact] #id-long ${'x'.repeat(40)}…`
    // budget = fixed lines + short line + one index line + trailing count line (the count line also consumes budget).
    const budget = OVERHEAD + est(shortLine) + est(indexLine) + est('+1 more; use engram_search')
    const text = renderProfile([long, short], budget)
    expect(text).toContain(shortLine)
    expect(text).toContain(indexLine)
    expect(text).not.toContain('x'.repeat(41))
  })

  it('folds into a trailing +N more count line when even an index line does not fit', () => {
    // 8 tokens of headroom: an entry whole line does not fit, but enough room remains for the trailing count line (which consumes budget).
    const text = renderProfile([
      record('id-1', 'fact', 'A comparatively long memory entry payload one'),
      record('id-2', 'fact', 'Another comparatively long memory entry payload two'),
    ], OVERHEAD + 8)
    expect(text).toContain('+2 more; use engram_search')
    expect(text).not.toContain('A comparatively long memory entry payload one')
    expect(text).not.toContain('#id-1')
  })

  it('mixed CJK/narrow text uses the CJK token metric, boundaries are exact', () => {
    // Intentionally non-English test data: exercises the CJK (1.5 tokens/char) metric.
    const mixed = record('id-mix', 'fact', 'abcd中文混合')
    const line = `- [fact] ${mixed.content}`
    expect(est(line)).toBeGreaterThan(Math.ceil(line.length / 4))
    // Just enough for the whole line -> it is kept; 1 token less and the whole line is skipped (the longer index line also does not fit, so it folds into the count line).
    const cost = est(line)
    expect(renderProfile([mixed], OVERHEAD + cost)).toContain(line)
    const degraded = renderProfile([mixed], OVERHEAD + cost - 1)
    expect(degraded).not.toContain(line)
    expect(degraded).toContain('+1 more; use engram_search')
  })

  it('wide (CJK) entries stay within the budget under the CJK metric (a length/4 metric would overspend several times over)', () => {
    // Intentionally non-English test data: CJK chars carry a higher per-char token cost.
    const records = Array.from({ length: 5 }, (_, index) => record(`id-${index}`, 'fact', '中'.repeat(200)))
    const text = renderProfile(records, 1024)
    expect(estimateTokens(text)).toBeLessThanOrEqual(1024)
    // Graduated decay: all 5 entries are truncated and fitted (first one at 160 chars); no index or count line is needed.
    expect(text.match(/^- \[fact\]/gm)).toHaveLength(5)
    expect(text).toContain('中'.repeat(160) + '…')
    expect(text).not.toContain('中'.repeat(161))
  })
})

describe('graduated-decay body budget', () => {
  it('entry i budget = max(floor, start×decay^i): long entries are truncated by rank', () => {
    const records = [record('a', 'fact', 'A'.repeat(200)), record('b', 'fact', 'B'.repeat(200))]
    const detailed = renderProfileDetailed(records, 8192, { start: 160, decay: 0.9, floor: 24 })
    const lines = detailed.text.split('\n').filter(line => line.startsWith('- ['))
    expect(lines[0]).toContain('A'.repeat(160) + '…')
    expect(lines[1]).toContain('B'.repeat(144) + '…')
    expect(detailed.overflow).toEqual([])
  })

  it('the budget stays at the floor once it reaches the floor (160 decays to 24 after 0.9^18)', () => {
    const records = [
      record('a', 'fact', 'A'.repeat(200)),
      ...Array.from({ length: 25 }, (_, index) => record(`r-${index}`, 'fact', 'C'.repeat(200))),
    ]
    const detailed = renderProfileDetailed(records, 8192, { start: 160, decay: 0.9, floor: 24 })
    const lines = detailed.text.split('\n').filter(line => line.startsWith('- ['))
    expect(lines[0]).toContain('A'.repeat(160) + '…')
    const floorLine = lines.at(-1)!
    expect(floorLine).toContain('C'.repeat(24) + '…')
    expect(floorLine).not.toContain('C'.repeat(25))
  })

  it('short entries are not truncated', () => {
    const detailed = renderProfileDetailed([record('s', 'fact', 'tiny')], 1024, { start: 160, decay: 0.9, floor: 24 })
    expect(detailed.text).toContain('- [fact] tiny')
    expect(detailed.text).not.toContain('…')
  })
})

describe('renderProfileDetailed overflow detail', () => {
  it('overflowed entries are returned in order; the text carries the count line', () => {
    const overflowRecord = record('id-overflow', 'fact', 'a fairly long memory entry body')
    // 8 tokens of headroom: the whole line does not fit, and after reserving for the count line there is still not enough for an index line, so only the count line remains.
    const detailed = renderProfileDetailed([overflowRecord], OVERHEAD + 8)
    expect(detailed.overflow.map(item => item.id)).toEqual(['id-overflow'])
    expect(detailed.overflow[0]!.kind).toBe('fact')
    expect(detailed.overflow[0]!.content).toBe('a fairly long memory entry body')
    expect(detailed.text).toContain('+1 more; use engram_search')
  })

  it('overflow is empty when everything fits', () => {
    const detailed = renderProfileDetailed([record('id-1', 'fact', 'entry one')], 1024)
    expect(detailed.overflow).toEqual([])
    expect(detailed.text).toContain('- [fact] entry one')
    expect(detailed.text).not.toContain('more; use engram_search')
  })

  it('re-render after compression: the shortened entry fits as a whole line, overflow is cleared', () => {
    const compressed = 'shortened body'
    // The budget holds exactly the whole compressed line (narrow metric: 14 chars = 3.5 tokens + 15 narrow chars = 3.75 tokens).
    const budget = OVERHEAD + est(`- [preference] ${compressed}`)
    const first = renderProfileDetailed([record('id-1', 'preference', 'long-original-entry'.repeat(10))], budget)
    expect(first.overflow).toHaveLength(1)
    // Simulate the re-render after the auxiliary LLM compresses the entry.
    const recomposed = first.overflow.map(item => ({ ...item, content: compressed }))
    const second = renderProfileDetailed(recomposed, budget)
    expect(second.overflow).toEqual([])
    expect(second.text).toContain(`- [preference] ${compressed}`)
  })
})

describe('renderProfileWithCurated (curated first)', () => {
  it('the curated section precedes the derived profile; without a block it equals renderProfileDetailed', () => {
    const curatedText = 'Prefers concise replies; rejects emoji.'
    const withCurated = renderProfileWithCurated(
      { content: curatedText },
      [record('id-1', 'fact', 'building a memory plugin')],
      1024,
    )
    // The curated header line comes first, then its body; the derived profile's Grand Hall header follows.
    expect(withCurated.text.startsWith(CURATED_HEADER)).toBe(true)
    expect(withCurated.text.indexOf(curatedText)).toBeLessThan(withCurated.text.indexOf(HEADER))
    expect(withCurated.text).toContain('- [fact] building a memory plugin')
    // When the block is absent, the output is identical to renderProfileDetailed.
    const plain = renderProfileDetailed([record('id-1', 'fact', 'building a memory plugin')], 1024)
    expect(renderProfileWithCurated(undefined, [record('id-1', 'fact', 'building a memory plugin')], 1024)).toEqual(plain)
  })

  it('curated takes budget first: the remainder fills derived entries, and anything that does not fit overflows as usual', () => {
    const curatedText = 'tiny profile'
    const curatedCost = est(`${CURATED_HEADER}\n${curatedText}`)
    const itemLine = '- [fact] entry one'
    // total budget = curated section + derived fixed lines + exactly one whole line: everything should fit.
    const budget = curatedCost + OVERHEAD + est(itemLine)
    const fits = renderProfileWithCurated({ content: curatedText }, [record('id-1', 'fact', 'entry one')], budget)
    expect(fits.overflow).toEqual([])
    expect(fits.text).toContain(itemLine)
    // Subtract 1 more token: the derived entry's whole line no longer fits -> it overflows (the curated section is still injected in full).
    const tight = renderProfileWithCurated({ content: curatedText }, [record('id-1', 'fact', 'entry one')], budget - 1)
    expect(tight.text).toContain(curatedText)
    expect(tight.overflow.map(item => item.id)).toEqual(['id-1'])
  })

  it('an over-long curated section is still injected in full; only the fixed lines remain for the derived section', () => {
    const huge = 'x'.repeat(2000)
    const result = renderProfileWithCurated({ content: huge }, [record('id-1', 'fact', 'entry one')], 300)
    expect(result.text).toContain(huge)
    expect(result.overflow.map(item => item.id)).toEqual(['id-1'])
  })
})
