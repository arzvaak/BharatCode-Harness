import type { ArtifactRevision } from '@deepseek-ai/dsh-workspace/types'
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ResearchWorkspace, type ResearchWorkspaceProps } from '../src/client/workflows/ResearchWorkspace.tsx'
import { en } from '../src/client/locales.ts'
import type { WorkspaceKey } from '../src/client/locales.ts'

afterEach(cleanup)
function props(): ResearchWorkspaceProps {
  return {
    sessionId: 's' as never, profile: 'research', view: undefined,
    project: { workspaceId: 'p' as never, title: 'Research project', path: '/project', sessionIds: ['s' as never], createdAt: '0', updatedAt: '0' },
    preference: { complexity: 'full', section: 'overview' }, changePreference: vi.fn(),
    t: ((key: WorkspaceKey) => en[key]) as ResearchWorkspaceProps['t'],
    collapseEditor: vi.fn(), openDocument: vi.fn(), closeDocument: vi.fn(), selectDocument: vi.fn(),
    editDocument: vi.fn(), saveDocument: vi.fn(), rebaseDocument: vi.fn(),
    searchArtifacts: vi.fn(async () => ({ hits: [], hasMore: false })),
    readArtifact: vi.fn(), registerArtifact: vi.fn(), inspectArtifact: vi.fn(),
    listFiles: vi.fn(async () => ({ path: '', entries: [], truncated: false })),
    openPreview: vi.fn(), openTerminal: vi.fn(), requestEvidenceHandoff: vi.fn(),
    sessions: [], openSession: vi.fn(),
  }
}
it('provides the full Scholar-style groups and a selectable simple presentation', () => {
  const p = props(); const v = render(<ResearchWorkspace {...p} />)
  expect(screen.getByRole('button', { name: 'Execution' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: 'Research presentation' }), { target: { value: 'simple' } })
  expect(p.changePreference).toHaveBeenCalledWith({ complexity: 'simple' })
  v.rerender(<ResearchWorkspace {...p} preference={{ complexity: 'simple', section: 'overview' }} />)
  expect(screen.queryByRole('button', { name: 'Execution' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Sources' })).toBeTruthy()
})
it('reads a real registered revision and carries it into an explicit coding handoff', async () => {
  const p = props()
  const artifact = { id: 'a' as never, projectId: 'p' as never, path: 'study.md', title: 'Retrieval study', kind: 'finding' as const, revision: 'v1', capturedAt: '2026-10-08', text: 'Versioned source evidence' }
  p.searchArtifacts = vi.fn(async () => ({ hits: [{ ...artifact, excerpt: artifact.text }], hasMore: false }))
  p.readArtifact = vi.fn(async () => artifact)
  p.inspectArtifact = vi.fn(async () => ({ artifact, status: 'current' as const }))
  const v = render(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'evidence' }} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retrieval study' }))
  v.rerender(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'evidence', sourceRevision: artifact.id }} />)
  expect(await screen.findByText('Versioned source evidence', { selector: 'pre' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Use in Coding' }))
  expect(p.requestEvidenceHandoff).toHaveBeenCalledWith('s', artifact, 'coding')
})
it('drops late source results when the selected project changes', async () => {
  const p = props()
  let resolve!: (value: { hits: never[]; hasMore: boolean }) => void
  p.searchArtifacts = vi.fn(() => new Promise<{ hits: never[]; hasMore: boolean }>((r) => { resolve = r }))
  const v = render(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'sources' }} />)
  await waitFor(() => { expect(p.searchArtifacts).toHaveBeenCalledOnce() })
  v.rerender(<ResearchWorkspace {...p} project={undefined} />)
  resolve({ hits: [], hasMore: false })
  await waitFor(() => { expect(screen.getByText('Choose a project to organise research.')).toBeTruthy() })
  expect(screen.queryByText('Loading project research…')).toBeNull()
})
it('restricts evidence classifications before the server bounds search results', async () => {
  const p = props()
  render(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'evidence' }} />)
  await waitFor(() => { expect(p.searchArtifacts).toHaveBeenCalledWith({ projectId: 'p', query: '', kinds: ['hypothesis', 'finding', 'decision', 'requirement'] }) })
})
it('does not observe or display another session’s selected run', async () => {
  const p = props()
  p.observeRun = vi.fn(() => vi.fn())
  p.jobs = [{ id: 'job-a', label: 'Experiment A', status: 'running' }] as never
  p.observed = { 'job-a': { text: 'session A output' } } as never
  const v = render(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'runs' }} />)
  fireEvent.click(screen.getByRole('button', { name: /Experiment A/ }))
  await waitFor(() => { expect(p.observeRun).toHaveBeenCalledWith('s', 'job-a') })
  v.rerender(<ResearchWorkspace {...p} sessionId={'b' as never} jobs={[]} preference={{ complexity: 'full', section: 'runs' }} />)
  expect(p.observeRun).not.toHaveBeenCalledWith('b', 'job-a')
  expect(screen.queryByText('session A output')).toBeNull()
})

it('opens a recent source reader after navigating out of Overview', async () => {
  const p = props()
  const artifact = { id: 'recent' as never, projectId: 'p' as never, path: 'recent.md', title: 'Recent source', kind: 'source' as const, revision: 'v1', capturedAt: '2026-10-08', text: 'Captured recent source' }
  p.searchArtifacts = vi.fn(async () => ({ hits: [{ ...artifact, excerpt: 'Captured recent source' }], hasMore: false }))
  let resolveRead!: (value: typeof artifact) => void
  p.readArtifact = vi.fn(() => new Promise<ArtifactRevision>((r) => { resolveRead = r }))
  p.inspectArtifact = vi.fn(async () => ({ artifact, status: 'current' as const }))
  const v = render(<ResearchWorkspace {...p} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Recent source' }))
  expect(p.changePreference).toHaveBeenCalledWith({ section: 'sources', sourceRevision: 'recent' })
  v.unmount()
  render(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'sources', sourceRevision: 'recent' as never }} />)
  await waitFor(() => { expect(p.readArtifact).toHaveBeenCalledWith('recent') })
  resolveRead(artifact)
  expect(await screen.findByText('Captured recent source', { selector: 'pre' })).toBeTruthy()
})
it('updates captured sources on host invalidation without requiring Refresh', async () => {
  const p = props()
  let changed!: () => void
  const stop = vi.fn()
  p.watchKnowledge = vi.fn((_project, onChange) => { changed = onChange; return stop })
  let hits: import('@deepseek-ai/dsh-workspace/types').ArtifactSearchHit[] = []
  p.searchArtifacts = vi.fn(async () => ({ hits, hasMore: false }))
  const v = render(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'sources' }} />)
  await waitFor(() => { expect(p.searchArtifacts).toHaveBeenCalled() })
  const artifact = { id: 'auto' as never, projectId: 'p' as never, path: 'source:https://example.org', title: 'Automatically retained source', kind: 'source' as const, revision: 'r', capturedAt: '2026-10-12', excerpt: 'Observed evidence' }
  hits = [artifact]
  act(changed)
  expect(await screen.findByRole('button', { name: 'Automatically retained source' })).toBeTruthy()
  v.unmount()
  expect(stop).toHaveBeenCalled()
})

it('preserves the open immutable reader and highlighted passage during background capture', async () => {
  const p = props()
  const artifact = { id: 'reader' as never, projectId: 'p' as never, path: 'source:https://example.org', title: 'Read source', kind: 'source' as const, revision: '1', capturedAt: '', text: 'Retained passage evidence' }
  p.readArtifact = vi.fn(async () => artifact)
  p.inspectArtifact = vi.fn(async () => ({ artifact, status: 'captured' as const }))
  let changed!: () => void
  p.watchKnowledge = (_project, callback) => { changed = callback; return () => {} }
  render(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'sources', sourceRevision: artifact.id, sourcePassage: { start: 0, end: 8, quote: 'Retained' } }} />)
  await waitFor(() => expect(document.querySelector('mark')?.textContent).toBe('Retained'))
  act(changed)
  await waitFor(() => expect(p.searchArtifacts).toHaveBeenCalledTimes(2))
  expect(document.querySelector('mark')?.textContent).toBe('Retained')
  expect(p.readArtifact).toHaveBeenCalledTimes(1)
})

it('finishes a pending source read after a background knowledge update', async () => {
  const p = props()
  const artifact = { id: 'pending' as never, projectId: 'p' as never, path: 'paper.md', title: 'Pending source', kind: 'source' as const, revision: '1', capturedAt: '', text: 'Pending reader evidence' }
  let finish!: (value: ArtifactRevision) => void
  let changed!: () => void
  p.readArtifact = vi.fn(() => new Promise<ArtifactRevision>((resolve) => { finish = resolve }))
  p.inspectArtifact = vi.fn(async () => ({ artifact, status: 'current' as const }))
  p.watchKnowledge = (_project, callback) => { changed = callback; return () => {} }
  render(<ResearchWorkspace {...p} preference={{ complexity: 'full', section: 'sources', sourceRevision: artifact.id }} />)
  await waitFor(() => { expect(p.readArtifact).toHaveBeenCalled() })
  act(changed)
  act(() => { finish(artifact) })
  expect(await screen.findByText('Pending reader evidence', { selector: 'pre' })).toBeTruthy()
})
