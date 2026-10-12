// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WritingWorkspace } from '../src/client/workflows/WritingWorkspace.tsx'
import { en } from '../src/client/locales.ts'
import type { WorkflowRecord } from '@deepseek-ai/dsh-workspace/types'
vi.mock('../src/client/workflows/DocumentPanel.tsx', () => ({ DocumentPanel: () => null }))
afterEach(cleanup)
function fixture() {
  const payload = {
    kind: 'writing' as const,
    specialization: 'general' as const,
    brief: 'Initial brief',
    style: '',
    outline: [],
    canon: [],
    tentative: [],
    characters: [],
    chronology: [],
    scenes: [],
    sourceIds: [],
  }
  let value: WorkflowRecord = {
    id: 'writing-project',
    projectId: 'p' as never,
    title: 'Project',
    revision: '1',
    updatedAt: '',
    payload,
  }
  let changed!: () => void
  const props = {
    project: { workspaceId: 'p', title: 'Project' },
    sessionId: 's',
    t: (key: keyof typeof en) => en[key],
    workflowRecords: vi.fn(async () => [value]),
    watchKnowledge: vi.fn((_id: unknown, callback: () => void) => {
      changed = callback
      return vi.fn()
    }),
    saveWorkflowRecord: vi.fn(async (request: import('@deepseek-ai/dsh-workspace/types').SaveWorkflowRecord) => ({
      ...request,
      revision: 'saved',
      updatedAt: '',
    })),
  } as unknown as Parameters<typeof WritingWorkspace>[0]
  return {
    props,
    notify: () => {
      changed()
    },
    update: () => {
      value = { ...value, revision: '2', payload: { ...payload, brief: 'Agent saved brief' } }
    },
  }
}
it('shows writing briefs saved by the agent without reopening the panel', async () => {
  const h = fixture()
  render(<WritingWorkspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Project structure' }))
  await waitFor(() => {
    expect(screen.getByLabelText('Brief')).toHaveProperty('value', 'Initial brief')
  })
  h.update()
  act(h.notify)
  await waitFor(() => {
    expect(screen.getByLabelText('Brief')).toHaveProperty('value', 'Agent saved brief')
  })
})
it('preserves an unsaved writing brief when the agent updates its stored revision', async () => {
  const h = fixture()
  render(<WritingWorkspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Project structure' }))
  await waitFor(() => {
    expect(screen.getByLabelText('Brief')).toHaveProperty('value', 'Initial brief')
  })
  fireEvent.change(screen.getByLabelText('Brief'), { target: { value: 'My unsaved text' } })
  h.update()
  act(h.notify)
  await waitFor(() => {
    expect(h.props.workflowRecords).toHaveBeenCalledTimes(2)
  })
  expect(screen.getByLabelText('Brief')).toHaveProperty('value', 'My unsaved text')
})

it('loads the latest revision for review, restores the local draft, and saves against that revision', async () => {
  const h = fixture()
  render(<WritingWorkspace {...h.props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Project structure' }))
  await waitFor(() => {
    expect(screen.getByLabelText('Brief')).toHaveProperty('value', 'Initial brief')
  })
  fireEvent.change(screen.getByLabelText('Brief'), { target: { value: 'My unsaved text' } })
  h.update()
  act(h.notify)
  fireEvent.click(await screen.findByRole('button', { name: 'Load latest brief' }))
  expect(screen.getByLabelText('Brief')).toHaveProperty('value', 'Agent saved brief')
  fireEvent.click(screen.getByRole('button', { name: 'Restore my local draft' }))
  expect(screen.getByLabelText('Brief')).toHaveProperty('value', 'My unsaved text')
  fireEvent.click(screen.getByRole('button', { name: 'Save project structure' }))
  await waitFor(() => {
    expect(h.props.saveWorkflowRecord).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: '2' }))
  })
})
