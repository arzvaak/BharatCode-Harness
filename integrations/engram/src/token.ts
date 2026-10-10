/**
 * CJK-aware token estimation for context budgets.
 *
 * Count ideographs, kana, Hangul, and fullwidth punctuation as 1.5 tokens per character;
 * count other text as four characters per token. A uniform length/4 estimate substantially
 * underestimates CJK text and can cause injected context to exceed its token budget.
 * @module @kenz1117/dsh-engram/token
 */

/** Estimated token cost per wide character. */
export const WIDE_TOKENS_PER_CHAR = 1.5

/** Narrow characters per estimated token. */
export const NARROW_CHARS_PER_TOKEN = 4

/**
 * Identify CJK scripts and fullwidth symbols, including supplementary planes.
 * @param codePoint - Unicode code point.
 */
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) || // CJK punctuation and symbols
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // Hiragana and Katakana
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Extension A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK unified ideographs
    (codePoint >= 0xa960 && codePoint <= 0xa97f) || // Hangul Jamo Extended A
    (codePoint >= 0xac00 && codePoint <= 0xd7ff) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Fullwidth ASCII
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || // Fullwidth symbols
    (codePoint >= 0x20000 && codePoint <= 0x3ffff) // CJK Extension B and later
  )
}

/**
 * Estimate token usage, rounding up.
 * @param text - Text to estimate.
 * @returns Estimated tokens; an empty string returns zero.
 */
export function estimateTokens(text: string): number {
  if (text === '') return 0
  let wide = 0
  let narrow = 0
  for (const char of text) {
    if (isWideCodePoint(char.codePointAt(0)!)) wide += 1
    else narrow += 1
  }
  return Math.ceil(wide * WIDE_TOKENS_PER_CHAR + narrow / NARROW_CHARS_PER_TOKEN)
}
