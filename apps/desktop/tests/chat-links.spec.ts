import { expect, it, vi } from 'vitest'
import { DesktopChatLinks } from '../src/chat-links.ts'
it('holds a launch link until the product asks for it', () => {
  const links = new DesktopChatLinks()
  expect(links.accept('dsh://sessions/source-chat')).toBe(true)
  const notify = vi.fn()
  links.listen(notify)
  expect(links.take()).toBe('dsh://sessions/source-chat')
  expect(links.take()).toBeUndefined()
  links.accept('dsh://sessions/new-chat')
  expect(notify).toHaveBeenCalledOnce()
})
it('accepts only canonical private links and keeps the newest launch', () => {
  const links = new DesktopChatLinks()
  links.accept('dsh://sessions/a')
  expect(links.accept('https://example.org')).toBe(false)
  expect(links.accept('dsh://sessions/b?token=x')).toBe(false)
  expect(links.take()).toBe('dsh://sessions/a')
  links.accept('dsh://sessions/a'); links.accept('dsh://sessions/b')
  expect(links.take()).toBe('dsh://sessions/b')
})
