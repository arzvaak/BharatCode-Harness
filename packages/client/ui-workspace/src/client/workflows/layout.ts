/** Workflow presets over the shared docking engine; no agent execution facts. */
import type {
  LayoutState,
  LayoutNode,
  NodeId,
  PaneId,
  SplitId,
  TabId,
  TabRecord,
} from '@deepseek-ai/dsh-client-ui-dockkit'
import type { WorkflowProfile } from '@deepseek-ai/dsh-workspace/types'
export interface WorkspacePaneTitles {
  readonly chat: string
  readonly document: string
  readonly explorer: string
  readonly support: string
}
export type WorkspacePreset = 'document-focus' | 'chat-focus' | 'balanced' | 'focus'
/** Stable seed identities keep live pane bodies mounted while changing presets. */
const ids = {
  chat: { pane: 'pane1' as PaneId, tab: 'tab2' as TabId },
  document: { pane: 'pane3' as PaneId, tab: 'tab4' as TabId },
  explorer: { pane: 'pane5' as PaneId, tab: 'tab6' as TabId },
  support: { pane: 'pane7' as PaneId, tab: 'tab8' as TabId },
  root: 'split9' as SplitId,
}
export function workspaceLayout(profile: WorkflowProfile, preset: WorkspacePreset, titles: WorkspacePaneTitles): LayoutState {
  const tabs: Record<TabId, TabRecord> = {
    [ids.chat.tab]: { id: ids.chat.tab, kind: 'chat', title: titles.chat, contentId: 'workspace:chat' },
    [ids.document.tab]: {
      id: ids.document.tab,
      kind: 'document',
      title: titles.document,
      contentId: `workspace:${profile}:document`,
    },
    [ids.explorer.tab]: {
      id: ids.explorer.tab,
      kind: 'explorer',
      title: titles.explorer,
      contentId: `workspace:${profile}:explorer`,
    },
    [ids.support.tab]: {
      id: ids.support.tab,
      kind: 'support',
      title: titles.support,
      contentId: `workspace:${profile}:support`,
    },
  }
  const pane = (kind: keyof Pick<typeof ids, 'chat' | 'document' | 'explorer'>, tabIds: TabId[]): LayoutNode => ({
    kind: 'pane',
    id: ids[kind].pane,
    host: 'dock',
    tabs: tabIds,
    activeTabId: ids[kind].tab,
    rect: undefined,
  })
  if (preset === 'focus')
    return {
      nodes: {
        [ids.document.pane]: pane('document', [ids.document.tab, ids.chat.tab, ids.explorer.tab, ids.support.tab]),
      },
      tabs,
      rootId: ids.document.pane,
      floats: [],
      activePaneId: ids.document.pane,
      expanded: true,
      mode: 'push',
    }
  const nodes: Record<NodeId, LayoutNode> = {
    [ids.chat.pane]: pane('chat', [ids.chat.tab]),
    [ids.document.pane]: pane('document', [ids.document.tab, ids.support.tab]),
  }
  const children: NodeId[] =
    preset === 'chat-focus'
      ? [ids.chat.pane, ids.document.pane]
      : preset === 'balanced'
        ? [ids.explorer.pane, ids.chat.pane, ids.document.pane]
        : [ids.explorer.pane, ids.document.pane, ids.chat.pane]
  if (preset === 'chat-focus') {
    nodes[ids.document.pane] = pane('document', [ids.document.tab, ids.explorer.tab, ids.support.tab])
  } else nodes[ids.explorer.pane] = pane('explorer', [ids.explorer.tab])
  nodes[ids.root] = {
    kind: 'split',
    id: ids.root,
    axis: 'row',
    children,
    sizes: preset === 'chat-focus' ? [0.58, 0.42] : preset === 'balanced' ? [0.18, 0.38, 0.44] : [0.18, 0.54, 0.28],
  }
  return { nodes, tabs, rootId: ids.root, floats: [], activePaneId: ids.document.pane, expanded: true, mode: 'push' }
}
export function swapWorkspaceSides(state: LayoutState): LayoutState {
  const root = state.nodes[state.rootId]
  if (root?.kind !== 'split') return state
  return {
    ...state,
    nodes: {
      ...state.nodes,
      [root.id]: { ...root, children: [...root.children].reverse(), sizes: [...root.sizes].reverse() },
    },
  }
}
export function narrowWorkspaceLayout(state: LayoutState): LayoutState {
  const active = state.nodes[state.activePaneId]
  const activeTabId = active?.kind === 'pane' ? active.activeTabId : undefined
  const paneId = ids.document.pane
  const tabs = Object.keys(state.tabs).map(value => value as TabId)
  return {
    ...state,
    nodes: {
      [paneId]: { kind: 'pane', id: paneId, host: 'dock', tabs, activeTabId: activeTabId ?? tabs[0], rect: undefined },
    },
    rootId: paneId,
    activePaneId: paneId,
    floats: [],
  }
}
