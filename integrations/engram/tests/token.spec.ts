import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../src/token.ts'

describe('estimateTokens', () => {
  it('empty string is 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('non-CJK text rounds up at 4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('CJK text is counted at 1.5 tokens per character', () => {
    // Intentionally non-English test data (CJK).
    expect(estimateTokens('中文')).toBe(3)
    // Intentionally non-English test data (CJK).
    expect(estimateTokens('中文混合')).toBe(6)
  })

  it('fullwidth punctuation and kana count as wide characters', () => {
    // Intentionally non-English test data (CJK punctuation).
    expect(estimateTokens('，。！')).toBe(5)
    // Intentionally non-English test data (Japanese katakana).
    expect(estimateTokens('カタカナ')).toBe(6)
  })

  it('mixed CJK and Latin text sums the two classes separately', () => {
    // 13 narrow chars (3.25 tokens) + 4 CJK chars (6 tokens) = 9.25 -> 10.
    // CJK portion is intentionally non-English test data.
    expect(estimateTokens('- [fact] abcd中文混合')).toBe(10)
  })

  it('emoji counts once per code point, not per surrogate-pair code unit', () => {
    expect(estimateTokens('🙂')).toBe(1)
    expect(estimateTokens('🙂🙂🙂🙂🙂')).toBe(2)
  })

  it('CJK text estimates higher than the length/4 baseline', () => {
    // Intentionally non-English test data (CJK).
    const text = '记忆宫殿的桩位系统'
    expect(estimateTokens(text)).toBe(14)
    expect(estimateTokens(text)).toBeGreaterThan(Math.ceil(text.length / 4))
  })
})
