import { expect, it } from 'vitest'
import { workspaceLayout, swapWorkspaceSides, narrowWorkspaceLayout } from '../src/client/workflows/layout.ts'
const titles = { chat: 'Chat', document: 'Document', explorer: 'Explorer', support: 'Supporting material' }
it('puts larger chat on the left and editable document on the right in Chat focus', () => {
  const layout = workspaceLayout('coding', 'chat-focus', titles)
  const root = layout.nodes[layout.rootId]
  if (root?.kind !== 'split') throw new Error('expected split')
  const first = layout.nodes[root.children[0]!]
  const second = layout.nodes[root.children[1]!]
  if (first?.kind !== 'pane' || second?.kind !== 'pane') throw new Error('expected panes')
  expect(layout.tabs[first.activeTabId!]?.kind).toBe('chat')
  expect(layout.tabs[second.activeTabId!]?.kind).toBe('document')
  expect(root.sizes[0]).toBeGreaterThan(root.sizes[1]!)
  expect(swapWorkspaceSides(layout).nodes[layout.rootId]).toMatchObject({ children: [second.id, first.id] })
})
it('simplifies narrow presentation without mutating the saved arrangement or losing tabs', () => {
  const layout = workspaceLayout('writing', 'balanced', titles)
  const original = JSON.stringify(layout)
  const narrow = narrowWorkspaceLayout(layout)
  expect(narrow.nodes[narrow.rootId]?.kind).toBe('pane')
  expect(Object.keys(narrow.tabs)).toEqual(Object.keys(layout.tabs))
  expect(JSON.stringify(layout)).toBe(original)
})
