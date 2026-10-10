// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { HandoffDialog, type HandoffDialogProps } from '../src/client/handoffs.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
it('previews omissions before admission and retries the prepared identity without recapturing source revisions', async () => {
  const task = {
    id: 'handoff-one',
    destinationSessionId: 'destination',
    context: { evidence: [], omitted: ['oversized'] },
  }
  const prepareHandoff = vi.fn(async () => task)
  const submitHandoff = vi.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValue(task)
  const closeHandoff = vi.fn()
  const openDestination = vi.fn()
  const props = {
    t: makeTranslate(en, commonEn),
    useHandoffTarget: (select: (value: unknown) => unknown) => select({ sessionId: 'research', workflow: 'coding' }),
    useWorkspaces: (select: (value: unknown) => unknown) =>
      select({ items: [{ workspaceId: 'project', title: 'Project', sessionIds: ['research'] }] }),
    prepareHandoff,
    submitHandoff,
    closeHandoff,
    openDestination,
    registerArtifact: vi.fn(),
    searchArtifacts: vi.fn(),
  } as HandoffDialogProps
  render(<HandoffDialog {...props} />)
  fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Implement the finding' } })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }))
  await screen.findByText('1 source(s) omitted to keep context within its limit.')
  expect(submitHandoff).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Queue handoff' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Queue handoff' }))
  await waitFor(() => {
    expect(openDestination).toHaveBeenCalledWith('destination')
  })
  expect(prepareHandoff).toHaveBeenCalledTimes(1)
  expect(submitHandoff).toHaveBeenNthCalledWith(1, { id: 'handoff-one', mode: 'queue' })
  expect(submitHandoff).toHaveBeenNthCalledWith(2, { id: 'handoff-one', mode: 'queue' })
  expect(closeHandoff).toHaveBeenCalledTimes(1)
})

it('shows stale evidence without replacing the captured revision and opens explicit refresh preparation', async () => {
  const { UsingContext } = await import('../src/client/handoffs.tsx')
  const source = { id: 'old', title: 'Research finding', revision: 'original-revision' }
  const handoff = {
    id: 'task',
    objective: 'Implement',
    workflow: 'coding',
    context: { evidence: [source], omitted: [] },
  }
  const refreshContext = vi.fn(async () => {})
  const props = {
    sessionId: 'coding',
    t: makeTranslate(en, commonEn),
    useSession: (select: (value: unknown) => unknown) => select({ running: false }),
    readContext: async () => [handoff],
    inspectArtifact: async () => ({ artifact: source, status: 'stale' }),
    refreshContext,
    requestHandoff: vi.fn(),
  } as import('../src/client/handoffs.tsx').UsingContextProps
  render(<UsingContext {...props} />)
  fireEvent.click(screen.getByText('Using context (0)'))
  await screen.findByText(/Source has changed/)
  const dialog = screen.getByRole('dialog', { name: 'Using context' })
  expect(dialog.parentElement).toBe(document.body)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close context' }))
  fireEvent.pointerDown(dialog)
  expect(screen.getByRole('dialog', { name: 'Using context' })).toBe(dialog)
  expect(screen.getByText(/original-rev/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh context…', hidden: true }))
  await waitFor(() => {
    expect(refreshContext).toHaveBeenCalledWith('coding', handoff, 'old')
  })
  expect(source.revision).toBe('original-revision')
  fireEvent.click(screen.getByRole('button', { name: 'Close context' }))
  expect(screen.queryByRole('dialog', { name: 'Using context' })).toBeNull()
  fireEvent.click(screen.getByText('Using context (1)'))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Using context (1)' }))
  expect(screen.queryByRole('dialog', { name: 'Using context' })).toBeNull()
  fireEvent.click(screen.getByText('Using context (1)'))
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog', { name: 'Using context' })).toBeNull()
})
