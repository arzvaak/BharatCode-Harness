import { expect, it } from 'vitest'
import { acceptEdit, proposeEdit, documentOutline } from '../src/client/workflows/editor-review.ts'
it('accepts only the selected occurrence and rejects a changed buffer', () => {
  const p = proposeEdit('same 😀 same', { start: 8, end: 12, text: 'same' }, 'changed')
  expect(acceptEdit('same 😀 same', p)).toBe('same 😀 changed')
  expect(() => acceptEdit('same 😀 another', p)).toThrow('document changed')
  expect(() => proposeEdit('abc', { start: 0, end: 2, text: 'xx' }, 'new')).toThrow('Selection')
})
it('outline excludes code fences and keeps source offsets', () => {
  expect(documentOutline('# Title\n```md\n# Code\n```\n## Next')).toEqual([
    { title: 'Title', offset: 0, level: 1 },
    { title: 'Next', offset: 25, level: 2 },
  ])
})
