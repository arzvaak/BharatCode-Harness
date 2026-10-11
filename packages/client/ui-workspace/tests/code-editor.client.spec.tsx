// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { CodeEditor } from '../src/client/workflows/CodeEditor.tsx'

const mock = vi.hoisted(() => ({ create: vi.fn(), setTheme: vi.fn(), dispose: vi.fn() }))
vi.mock('monaco-editor/editor/editor.api.js', () => ({
  editor: {
    createModel: () => ({ dispose: vi.fn() }),
    create: mock.create,
    setTheme: mock.setTheme,
    setModelMarkers: vi.fn(),
  },
  KeyMod: { CtrlCmd: 1 },
  KeyCode: { KeyS: 1 },
}))
vi.mock('monaco-editor/languages/definitions/javascript/register.js', () => ({}))
vi.mock('monaco-editor/languages/definitions/typescript/register.js', () => ({}))
vi.mock('monaco-editor/languages/definitions/python/register.js', () => ({}))
afterEach(() => {
  cleanup()
  document.body.removeAttribute('data-ds-dark-theme')
  vi.clearAllMocks()
})
it('opens in the app palette, follows appearance changes, and releases its theme observer', async () => {
  mock.create.mockReturnValue({
    onDidChangeCursorSelection: () => ({ dispose: vi.fn() }),
    onDidChangeModelContent: () => ({ dispose: vi.fn() }),
    addCommand: vi.fn(),
    getValue: () => 'hello',
    getModel: () => undefined,
    dispose: mock.dispose,
  })
  document.body.setAttribute('data-ds-dark-theme', '')
  const editor = render(<CodeEditor text="hello" path="note.txt" label="Source" onChange={vi.fn()} onSave={vi.fn()} onSelection={vi.fn()} />)
  expect(mock.create.mock.calls[0]?.[1]).toMatchObject({ theme: 'vs-dark' })
  document.body.removeAttribute('data-ds-dark-theme')
  await waitFor(() => { expect(mock.setTheme).toHaveBeenLastCalledWith('vs') })
  document.body.setAttribute('data-ds-dark-theme', '')
  await waitFor(() => { expect(mock.setTheme).toHaveBeenLastCalledWith('vs-dark') })
  editor.unmount()
  mock.setTheme.mockClear()
  document.body.removeAttribute('data-ds-dark-theme')
  await Promise.resolve()
  expect(mock.setTheme).not.toHaveBeenCalled()
  expect(mock.dispose).toHaveBeenCalledOnce()
})
