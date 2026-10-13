import { describe, expect, it } from 'vitest'
import { dockPaneIds, getPane } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createSidebarRightStore } from '../src/client/stores.ts'
import { resourceLayout, terminalLayout } from '../src/client/shell/SidebarRight.tsx'

describe('independent terminal presentation', () => {
  it('keeps files on the side when a terminal opens and preserves terminal identity', () => {
    const store = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
    store.actions.open('session')
    expect(store.getSnapshot().bySession.session!.terminalVisible).not.toBe(true)
    store.actions.openContent('session', { kind: 'files', title: 'Files', contentId: 'files' }, () => {})
    store.actions.openContent('session', { kind: 'terminal', title: 'bash', contentId: 'terminal:one' }, () => {})
    expect(store.getSnapshot().bySession.session!.terminalVisible).toBe(true)
    store.actions.toggleTerminal('session')
    expect(store.getSnapshot().bySession.session!.terminalVisible).toBe(false)
    store.actions.toggleTerminal('session')
    const layout = store.getSnapshot().bySession.session!.layout
    const terminal = Object.values(layout.tabs).find(tab => tab.kind === 'terminal')!
    const files = Object.values(layout.tabs).find(tab => tab.kind === 'files')!
    const side = resourceLayout(layout)
    const bottom = terminalLayout(layout)!
    expect(side.tabs[files.id]).toBe(files)
    expect(side.tabs[terminal.id]).toBeUndefined()
    expect(getPane(side, side.activePaneId).tabs).toContain(files.id)
    expect(Object.values(bottom.tabs)).toEqual([terminal])
    expect(getPane(bottom, bottom.activePaneId).activeTabId).toBe(terminal.id)
    expect(layout.tabs[terminal.id]).toBe(terminal)
    store.actions.closeTab('session', terminal.id)
    expect(terminalLayout(store.getSnapshot().bySession.session!.layout)).toBeUndefined()
    expect(Object.values(resourceLayout(store.getSnapshot().bySession.session!.layout).tabs)).toContain(files)
  })
})

it('removes terminal-only panes from the file projection without changing saved layout', () => {
  const store = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
  store.actions.open('session')
  store.actions.openContent('session', { kind: 'files', title: 'Files', contentId: 'files' }, () => {})
  store.actions.openContent('session', { kind: 'terminal', title: 'bash', contentId: 'terminal:one', preferNewPane: true }, () => {})
  const layout = store.getSnapshot().bySession.session!.layout
  expect(dockPaneIds(layout)).toHaveLength(2)
  const projected = resourceLayout(layout)
  expect(dockPaneIds(projected)).toHaveLength(1)
  expect(getPane(projected, projected.activePaneId).tabs.length).toBeGreaterThan(0)
  expect(dockPaneIds(layout)).toHaveLength(2)
  expect(Object.values(terminalLayout(layout)!.tabs)).toHaveLength(1)
})
