import { expect, it } from 'vitest'
import { formatChatLink, parseChatLink } from '../src/chat-link.ts'
it('round trips private chat links with opaque ids', () => {
  for (const id of ['session-123', 'unicode/引号"/slash\\/line\n', 'a?b#c', 'a.b']) {
    expect(parseChatLink(formatChatLink(id))).toBe(id)
  }
  expect(formatChatLink('session-123')).toBe('dsh://sessions/session-123')
})
it('rejects unrelated, malformed and ambiguous link forms', () => {
  for (const link of ['https://example.org/session-123', 'dsh://sessions/', 'dsh://sessions/%ZZ', 'dsh://sessions/a?token=x', 'dsh://sessions/a#x', 'dsh://sessions/%61']) expect(parseChatLink(link)).toBeUndefined()
})
