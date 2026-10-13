// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ResearchKnowledgePanel } from '../src/client/workflows/ResearchKnowledgePanel.tsx'
import { en } from '../src/client/locales.ts'
import type { ResearchWorkspaceProps } from '../src/client/workflows/ResearchWorkspace.tsx'
import { ResearchReader } from '../src/client/workflows/ResearchReader.tsx'
afterEach(cleanup)
function props(): ResearchWorkspaceProps {
  const note = {
    path: 'notes/A.md',
    title: 'Battery ageing',
    version: '1',
    aliases: [],
    tags: [],
    headings: ['Battery ageing'],
    links: [],
    excerpt: 'An introduction.',
  }
  return {
    sessionId: 's' as never,
    profile: 'research',
    project: {
      workspaceId: 'p' as never,
      title: 'Battery research',
      path: '/project',
      sessionIds: ['s' as never],
      createdAt: '0',
      updatedAt: '0',
    },
    sessions: [],
    preference: { complexity: 'full', section: 'notes' },
    changePreference: vi.fn(),
    view: {
      active: 'notes/A.md',
      documents: {
        'notes/A.md': {
          path: 'notes/A.md',
          text: '# Battery ageing\n\nA useful explanation.\n\n| Cause | Effect |\n| --- | --- |\n| Heat | Ageing |\n\n$x^2$',
          base: { absolutePath: '/project/notes/A.md', version: '1', text: '# Battery ageing' },
          busy: false,
        },
      },
    },
    t: ((key: keyof typeof en) => en[key]) as ResearchWorkspaceProps['t'],
    collapseEditor: vi.fn(),
    openDocument: vi.fn(),
    editDocument: vi.fn(),
    saveDocument: vi.fn(),
    closeDocument: vi.fn(),
    selectDocument: vi.fn(),
    rebaseDocument: vi.fn(),
    openPreview: vi.fn(),
    openTerminal: vi.fn(),
    openSession: vi.fn(),
    requestEvidenceHandoff: vi.fn(),
    searchArtifacts: vi.fn(async () => ({ hits: [], hasMore: false })),
    readArtifact: vi.fn(),
    inspectArtifact: vi.fn(),
    registerArtifact: vi.fn(),
    listFiles: vi.fn(async () => ({ path: '', entries: [], truncated: false })),
    researchList: vi.fn(async () => ({ notes: [note], total: 1, issues: [] })),
    researchInspect: vi.fn(async () => ({
      note,
      text: '# Battery ageing',
      outgoing: [],
      backlinks: [{ path: 'notes/B.md', title: 'Charging', excerpt: 'Connected note' }],
      issues: [],
    })),
    researchCreate: vi.fn(async () => ({ path: 'notes/New.md', issues: [] })),
    researchCaptureCitations: vi.fn(async () => ({ artifact: { id: 'n' } as never, linked: 0, issues: [] })),
    researchExport: vi.fn(async () => ({
      filename: 'research-vault.zip',
      base64: 'UEs=',
      files: [],
      issues: ['Missing figure'],
    })),
  }
}
it('reads research as Markdown in app with tables, math and navigable backlinks', async () => {
  const p = props()
  render(<ResearchKnowledgePanel {...p} />)
  expect(await screen.findByRole('heading', { name: 'Battery ageing' })).toBeTruthy()
  expect(screen.getByRole('table')).toBeTruthy()
  expect(document.querySelector('.katex')).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: 'Charging' }))
  expect(p.openDocument).toHaveBeenCalledWith('s', 'notes/B.md')
})
it('creates notes explicitly and opens them, preserving the same project/session', async () => {
  const p = props()
  render(<ResearchKnowledgePanel {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'New note' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), { target: { value: 'New' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown path' }), { target: { value: 'notes/New.md' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create note' }))
  await waitFor(() => expect(p.researchCreate).toHaveBeenCalledWith('p', 'notes/New.md', 'New'))
  expect(p.openDocument).toHaveBeenCalledWith('s', 'notes/New.md')
})
it('reports citation capture errors and does not claim a successful save', async () => {
  const p = props()
  p.researchCaptureCitations = vi.fn(async () => {
    throw new Error('Note was not saved')
  })
  render(<ResearchKnowledgePanel {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save and capture evidence' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Note was not saved')
})
it('drops late library results after switching projects', async () => {
  const p = props()
  let done!: (value: import('@deepseek-ai/dsh-workspace/types').ResearchList) => void
  p.researchList = vi.fn(
    () =>
      new Promise<import('@deepseek-ai/dsh-workspace/types').ResearchList>((resolve) => {
        done = resolve
      }),
  )
  const v = render(<ResearchKnowledgePanel {...p} />)
  await waitFor(() => expect(p.researchList).toHaveBeenCalled())
  v.rerender(<ResearchKnowledgePanel {...p} project={undefined} view={undefined} />)
  done({ notes: [{ path: 'Secret.md', title: 'Secret', version: '1', aliases: [], tags: [], headings: [], links: [], excerpt: '' }], issues: [], total: 1 })
  await waitFor(() => expect(screen.queryByText('Secret')).toBeNull())
})
it('renders wikilinks and images without rewriting authored code or running HTML', () => {
  const open = vi.fn()
  render(
    <ResearchReader
      text={'# Topic\n[[Cell#Heat|Battery]]\n`[[Literal]]`\n<script>bad()</script>\n![Figure](../figure.png)'}
      t={props().t}
      onLink={open}
      images={{ '../figure.png': 'blob:figure' }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Battery' }))
  expect(open).toHaveBeenCalledWith({ target: 'Cell#Heat', wiki: true })
  expect(screen.getByRole('img', { name: 'Figure' }).getAttribute('src')).toBe('blob:figure')
  expect(document.querySelector('script')).toBeNull()
})
