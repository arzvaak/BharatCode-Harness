// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DocumentPanel, type DocumentPanelProps } from '../src/client/workflows/DocumentPanel.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
const sessionId = 'session' as SessionId
function props(): DocumentPanelProps {
  return { sessionId, view: undefined, profile: 'coding', t: ((key: keyof typeof en) => en[key]) as DocumentPanelProps['t'],
    openDocument: vi.fn(async () => {}), selectDocument: vi.fn(), editDocument: vi.fn(async () => {}),
    saveDocument: vi.fn(async () => {}), rebaseDocument: vi.fn(async () => {}) }
}
it('opens an explicitly selected project file and does not write merely by rendering it', () => {
  const p = props()
  const view = render(<DocumentPanel {...p} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '章.md' } })
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  expect(p.openDocument).toHaveBeenCalledWith(sessionId, '章.md')
  p.view = { active: '章.md', documents: { '章.md': { path: '章.md', base: { absolutePath: '/project/章.md', version: 'v1', text: 'Original' }, text: 'Original', busy: false } } }
  view.rerender(<DocumentPanel {...p} />)
  expect(p.editDocument).not.toHaveBeenCalled()
  expect(p.saveDocument).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Document source' }), { target: { value: 'New text' } })
  expect(p.editDocument).toHaveBeenCalledWith(sessionId, '章.md', 'New text')
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Document source' }), { key: 's', ctrlKey: true })
  expect(p.saveDocument).toHaveBeenCalledWith(sessionId, '章.md')
})
it('shows both conflicting texts and requires an explicit rebase before saving', () => {
  const p = props()
  p.view = { active: 'chapter.md', documents: { 'chapter.md': {
    path: 'chapter.md', base: { absolutePath: '/chapter.md', version: 'v1', text: 'Before' }, text: 'My text', busy: false,
    conflict: { absolutePath: '/chapter.md', version: 'v2', text: 'Agent text' },
  } } }
  render(<DocumentPanel {...p} />)
  expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
  expect((screen.getByRole('textbox', { name: 'Document source' }) as HTMLTextAreaElement).value).toBe('My text')
  expect(screen.getByText('Agent text')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Use this revision as the save base' }))
  expect(p.rebaseDocument).toHaveBeenCalledWith(sessionId, 'chapter.md')
  expect(p.saveDocument).not.toHaveBeenCalled()
})
