import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('English fork locale contract', () => {
  it('preserves identical keys for both host locale choices', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('renders English under either locale choice', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(zh[key] === en[key], `${key} must render the same English text for either locale`).toBe(true)
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `${key} must not be empty or whitespace`).not.toBe('')
      expect(value, `${key} must be English`).not.toMatch(/\p{Script=Han}/u)
    }
  })

  it('preserves interpolation parameters across locale choices', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(zh[key].match(/\{[^}]+\}/g), key).toEqual(en[key].match(/\{[^}]+\}/g))
    }
  })
})
