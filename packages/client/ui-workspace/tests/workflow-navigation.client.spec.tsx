// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkflowNavigation, type WorkflowNavigationProps } from '../src/client/workflows/WorkflowNavigation.tsx'
import { WorkflowWorkspace, type WorkflowWorkspaceProps } from '../src/client/workflows/WorkflowWorkspace.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
const copy: Record<string, string> = {
  'workflow.label': 'Workflows',
  'workflow.chat': 'Chat',
  'workflow.coding': 'Coding',
  'workflow.research': 'Research',
  'workflow.writing': 'Writing',
  'workflow.chat.detail': 'Quick questions',
  'workflow.coding.detail': 'Build and edit files',
  'workflow.research.detail': 'Read, explore, connect',
  'workflow.writing.detail': 'Shape your next chapter',
}
it('selects workflow views in the sidebar without submitting or steering a session', () => {
  const choose = vi.fn()
  const props = {
    wide: true,
    useSelection: (select: (value: unknown) => unknown) => select({ sessionId: 'session-a' }),
    useStore: (selector: (state: unknown) => unknown) => selector({ profiles: { 'session-a': 'research' } }),
    actions: { choose },
    reveal: vi.fn(),
    t: (key: string) => copy[key] ?? key,
  } as never as WorkflowNavigationProps
  render(<WorkflowNavigation {...props} />)
  expect(screen.getByRole('button', { name: /Research/ }).getAttribute('aria-current')).toBe('page')
  fireEvent.click(screen.getByRole('button', { name: /Coding/ }))
  expect(choose).toHaveBeenCalledWith('session-a', 'coding')
})
it('keeps all workflow choices accessible in the collapsed rail', () => {
  const props = {
    wide: false,
    useSelection: (select: (value: unknown) => unknown) => select({}),
    useStore: (selector: (state: unknown) => unknown) => selector({ profiles: {} }),
    actions: { choose: vi.fn() },
    reveal: vi.fn(),
    t: (key: string) => copy[key] ?? key,
  } as never as WorkflowNavigationProps
  render(<WorkflowNavigation {...props} />)
  expect(screen.getByRole('button', { name: 'Writing' })).toBeTruthy()
  expect(screen.queryByText('Shape your next chapter')).toBeNull()
})

it('preserves the live composer DOM and unsent text while switching profiles and cancels obsolete motion', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const cancel = vi.fn()
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
  HTMLElement.prototype.animate = vi.fn(() => ({ cancel }) as unknown as Animation)
  try {
    let profile = 'coding'
    const props = {
      sessionId: 'session-a',
      useDocuments: (select: (value: { sessions: Record<string, never> }) => unknown) => select({ sessions: {} }),
      showEditor: vi.fn(), closeDocument: vi.fn(), arrange: vi.fn(), restoreDocuments: vi.fn(),
      openDocument: vi.fn(), selectDocument: vi.fn(), editDocument: vi.fn(), saveDocument: vi.fn(), rebaseDocument: vi.fn(),
      phase: 'active',
      hero: false,
      usePresentation: (select: (value: unknown) => unknown) => select({ profiles: { 'session-a': profile } }),
      renderFactorySlot: () => <textarea aria-label="Unsent draft" />,
      t: (key: string) => copy[key] ?? key,
    } as WorkflowWorkspaceProps
    const view = render(<WorkflowWorkspace {...props} />)
    const editor = screen.getByRole('textbox', { name: 'Unsent draft' }) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'Keep this draft' } })
    profile = 'research'
    view.rerender(<WorkflowWorkspace {...props} />)
    expect(screen.getByRole('textbox', { name: 'Unsent draft' })).toBe(editor)
    expect(editor.value).toBe('Keep this draft')
    expect(cancel).toHaveBeenCalledOnce()
    profile = 'writing'
    view.rerender(<WorkflowWorkspace {...props} />)
    expect(screen.getByRole('textbox', { name: 'Unsent draft' })).toBe(editor)
    expect(cancel).toHaveBeenCalledTimes(2)
  } finally {
    if (original === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'animate')
    else Object.defineProperty(HTMLElement.prototype, 'animate', original)
    vi.unstubAllGlobals()
  }
})

it('hides and reopens the editor without replacing the composer or source DOM', () => {
  let visible = true
  const p = {
    sessionId: 'session-a', phase: 'active', hero: false,
    usePresentation: (select: (value: unknown) => unknown) => select({
      profiles: { 'session-a': 'writing' }, editorVisibility: { '["session-a","writing"]': visible },
    }),
    useDocuments: (select: (value: unknown) => unknown) => select({ sessions: { 'session-a': {
      active: 'chapter.md', documents: { 'chapter.md': {
        path: 'chapter.md', base: { absolutePath: '/chapter.md', version: 'v1', text: 'Before' }, text: 'Draft', busy: false,
      } },
    } } }),
    showEditor: vi.fn((_key, value) => { visible = value }), arrange: vi.fn(), restoreDocuments: vi.fn(),
    openDocument: vi.fn(), closeDocument: vi.fn(), selectDocument: vi.fn(), editDocument: vi.fn(),
    saveDocument: vi.fn(), rebaseDocument: vi.fn(), renderFactorySlot: () => <textarea aria-label="Unsent draft" />,
    t: (key: string) => copy[key] ?? key,
  } as WorkflowWorkspaceProps
  const view = render(<WorkflowWorkspace {...p} />)
  const composer = screen.getByRole('textbox', { name: 'Unsent draft' }) as HTMLTextAreaElement
  const source = screen.getByRole('textbox', { name: 'editor.source' })
  fireEvent.change(composer, { target: { value: 'Unsent' } })
  fireEvent.click(screen.getByRole('button', { name: 'editor.collapse' }))
  view.rerender(<WorkflowWorkspace {...p} />)
  expect(screen.queryByRole('textbox', { name: 'editor.source' })).toBeNull()
  expect(screen.getByRole('textbox', { name: 'Unsent draft' })).toBe(composer)
  fireEvent.click(screen.getByRole('button', { name: 'editor.documents' }))
  view.rerender(<WorkflowWorkspace {...p} />)
  expect(screen.getByRole('textbox', { name: 'editor.source' })).toBe(source)
  expect(composer.value).toBe('Unsent')
})
