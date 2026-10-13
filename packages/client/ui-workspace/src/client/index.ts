/**
 * Workspace plugin, browser half. Two registrations: WorkspaceBrowser fills
 * the sidebar shell's `sidebar.workspaces` hole (the whole browsing region),
 * and WorkspacePicker fills the conversation hero's picker hole
 * (`conversation.hero.workspace` — both hero forms). Both read real Host
 * Workspaces through the global useWorkspaces hook, and each declares its
 * own `single` directory-flow child hole for the composed picker package's
 * client half. WorkspaceBrowser additionally declares the two Session row
 * action lists, and this apply registers the shipped actions — pin, rename,
 * fork, archive — into them the way any client plugin would, each with its
 * own behavior, plus the rename dialog and the row-action notice into
 * `shell.overlay` (see the contract module doc). It also declares two
 * Session-row seats: the leading decoration a row renders only while its own
 * primary state is idle, and the section the row's hover card renders between
 * its relative time and its trailing status line. Export discipline:
 * packages/client/AGENTS.md.
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { fileAddressFor, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces,
  SessionActivity,
  WorkspaceArchiveError,
  WorkspaceSnapshot,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the Controller service merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the Session root standard-hook merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  type ArchiveSessionInjected,
  type ForkSessionInjected,
  menuOpenStateFactory,
  type PinSessionInjected,
  type SessionArchiveConfirmInjected,
  type SessionArchiveConfirmRequest,
  type RenameSessionInjected,
  type RowToast,
  type RowToastInjected,
  type RowToastState,
  type SessionRenameDialogInjected,
  type WorkspaceBrowserInjected,
  type WorkspacePickerInjected,
} from './contract/slots.ts'
import { createWorkspaceShortcutControls, installWorkspaceShortcuts } from './shortcuts.ts'
import { UiWorkspaceService } from './navigation.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { WorkspaceBrowser } from './rows/WorkspaceBrowser.tsx'
import {
  ArchiveSessionMenuItem,
  ArchiveSessionRowButton,
  SessionArchiveConfirmDialog,
} from './session-actions/ArchiveSession.tsx'
import { derive } from './session-actions/derived.ts'
import { CopyChatLinkMenuItem } from './session-actions/CopyChatLink.tsx'
import { installChatLinkNavigation, type ChatLinkBridge } from './chat-links.ts'
import { ForkSessionMenuItem } from './session-actions/ForkSession.tsx'
import { PinSessionMenuItem, PinSessionRowButton } from './session-actions/PinSession.tsx'
import { RenameSessionMenuItem, SessionRenameDialog } from './session-actions/RenameSession.tsx'
import { RowActionToast } from './session-actions/RowActionToast.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import {
  HandoffDialog,
  HandoffMenuItem,
  UsingContext,
  type HandoffTarget,
  type HandoffDialogInjected,
  type UsingContextInjected,
} from './handoffs.tsx'
import { en, zh, type WorkspaceKey } from './locales.ts'
import { createWorkflowPresentationStore } from './workflows/presentation.ts'
import { WorkflowDestinations } from './workflows/destinations.ts'
import { WorkflowNavigation, type WorkflowNavigationInjected } from './workflows/WorkflowNavigation.tsx'
import { WorkspaceDocuments } from './workflows/documents.ts'
import { configureMonacoWorkers } from './workflows/monaco-runtime.ts'
import { WorkflowWorkspace } from './workflows/WorkflowWorkspace.tsx'

export type { UiWorkspace } from './navigation.ts'
export type {
  DirectoryFlowOwnerProps,
  DirectoryFlowSlotName,
  DirectoryPickingHooks,
  DirectoryPickingInjected,
  MenuOpenState,
  RowToast,
  SessionRenameTarget,
  SessionRowOwnerProps,
  UseMenuOpenState,
  WorkspaceBrowserInjected,
  SessionRowScheduleOwnerProps,
  WorkspaceBrowserProps,
  WorkspacePickerInjected,
  WorkspacePickerProps,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Selector hook over the pure Workspace Controller snapshot. */
    useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
  }

  interface LocaleNamespaceMap {
    /** The workspace browsing region and pick/create flow copy. */
    workspace: WorkspaceKey
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    workspaceOperation: unknown
  }
}

/** Dictionary namespace owned by this plugin. */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Offer a workspace source file to the editor owner.
     * @mode bail
     * @param sessionId - Session owning the workspace.
     * @param path - Workspace file to open.
     */
    'workspace/file/open': (sessionId: SessionId, path: string) => boolean | undefined
  }
}

const NS = 'workspace'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar / ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: dsh.client.inject edges are informational
 * (loading/prefetch metadata, never apply sequencing) and neither owner
 * provides a waitable service. apply therefore depends on each slot
 * declaration through `slots.inject()` instead of assuming order.
 */
export const inject = [
  'slots',
  'sessions',
  'workspaces',
  'locale',
  'remote',
  'remote.directoryPicker',
  'remote.knowledge',
  'remote.workspaceFiles',
  'remote.documents',
  'layout',
  'shortcuts',
  'sidebarRight',
  'jobs',
]

/**
 * Register the browser and picker once their slot declarations are on the
 * ledger. Inject factories return plain callbacks; data reads use the
 * framework's global hooks.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => configureMonacoWorkers(), 'workspace.monaco-workers')
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  const documents = new WorkspaceDocuments({
    read: async (session, path) => unwrap(await ctx.remote.workspaceFiles.readEditable(session, path)),
    save: async (session, path, text, expectedVersion) =>
      unwrap(await ctx.remote.workspaceFiles.saveEditable(session, path, { text, expectedVersion })),
    readDraft: async (session, path) => unwrap(await ctx.remote.documents.readDraft(session, path)),
    saveDraft: async request => unwrap(await ctx.remote.documents.saveDraft(request)),
    clearDraft: async (session, path, revision) => {
      unwrap(await ctx.remote.documents.clearDraft(session, path, revision))
    },
  })
  ctx.effect(
    () => () => {
      documents.dispose()
    },
    'workspace.documents',
  )
  const workflowHandle = createWorkflowPresentationStore()
  const workflowInstance = workflowHandle.create()
  ctx.on('workspace/file/open', (sessionId: SessionId, path: string) => {
    const profile = workflowInstance.getSnapshot().profiles[sessionId] ?? 'chat'
    if (profile === 'chat' || /\.(pdf|png|jpe?g|gif|webp|svg|mp3|mp4|docx|xlsx|pptx)$/i.test(path)) return undefined
    workflowInstance.actions.showEditor(JSON.stringify([sessionId, profile]), true)
    if (profile === 'research') workflowInstance.actions.researchView(sessionId, { section: 'notes' })
    const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
    const view = documents.state.getSnapshot().sessions[sessionId]
    const existingPath = Object.keys(view?.documents ?? {}).find(
      key => resolveWorkspacePath(cwd, key) === resolveWorkspacePath(cwd, path),
    )
    const documentPath = existingPath ?? (cwd !== undefined && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path)
    void documents.open(sessionId, documentPath).then(() => {
      rememberDocument(sessionId, documentPath)
    })
    return true
  })
  const restoredDocuments = new Set<SessionId>()
  const rememberDocument = (session: SessionId, path: string): void => {
    const view = documents.state.getSnapshot().sessions[session]
    if (view?.documents[path] !== undefined && view.active !== undefined) {
      workflowInstance.actions.rememberDocument(session, path)
      workflowInstance.actions.rememberDocument(session, view.active)
    }
  }
  const workflowPresentation: typeof workflowHandle = { ...workflowHandle, create: () => workflowInstance }
  // One viewing-store instance, created here as ui-layout does for its layout
  // store: the browser declares the handle, and the UiWorkspace service writes
  // view order through the same instance the renderer hands the browser.
  const viewHandle = createWorkspaceViewStore()
  const viewInstance = viewHandle.create()
  const viewStore: typeof viewHandle = { ...viewHandle, create: () => viewInstance }
  const rowToast = createSnapshotStore<RowToastState | null>(null)
  let toastSeq = 0
  const notify = (toast: RowToast): void => {
    rowToast.set({ ...toast, seq: ++toastSeq })
  }
  const uiWorkspace = new UiWorkspaceService(ctx, ctx.remote.directoryPicker, workspaces, sessions, viewInstance.actions, notify, () => {
    const selected = uiWorkspace.selection.getSnapshot().sessionId
    const state = workflowInstance.getSnapshot()
    const profile = state.navigating ?? (selected === undefined ? 'chat' : state.owners?.[selected] ?? 'chat')
    return (session) => {
      workflowInstance.actions.rememberDestination(session, profile, destinationContext(session))
    }
  })
  const destinationContext = (session: SessionId | undefined): string => workspaces.list.getSnapshot().items.find(
    item => session !== undefined && item.sessionIds.includes(session),
  )?.workspaceId ?? 'ungrouped'
  const destinations = new WorkflowDestinations({
    selection: () => uiWorkspace.selection.getSnapshot().sessionId,
    snapshot: () => workflowInstance.getSnapshot(),
    available: session => sessions.list.getSnapshot().byId[session] !== undefined
      && !workspaces.list.getSnapshot().archivedSessionIds.includes(session),
    context: destinationContext,
    navigation: () => ctx.layout.beginNavigation(),
    visible: () => ctx.layout.panelInfo.getSnapshot().activePanelId === null,
    remember: (session, profile, bookmark) => {
      workflowInstance.actions.rememberDestination(session, profile, destinationContext(session), bookmark)
    },
    create: async (source) => {
      const project = workspaces.list.getSnapshot().items.find(item => source !== undefined && item.sessionIds.includes(source))
      return sessions.create(project === undefined ? {} : { workspaceId: project.workspaceId })
    },
    open: (session) => {
      if (ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
      uiWorkspace.openSession(session)
    },
    pending: (profile) =>{  workflowInstance.actions.navigating(profile) },
    failed: (reason) =>{  notify({ kind: 'createFailed', message: reason instanceof Error ? reason.message : String(reason) }) },
  })
  ctx.effect(() => {
    const bridge = typeof window === 'undefined' ? undefined
      : (window as Window & { dshDesktop?: { chats?: ChatLinkBridge } }).dshDesktop?.chats
    if (bridge === undefined) return () => {}
    return installChatLinkNavigation(bridge, {
      ready: () => sessions.list.getSnapshot().phase === 'ready' && workspaces.list.getSnapshot().phase === 'ready',
      available: id => sessions.list.getSnapshot().byId[id as SessionId] !== undefined
        && !workspaces.list.getSnapshot().archivedSessionIds.includes(id as SessionId),
      open: (id) => {
        const summary = sessions.list.getSnapshot().byId[id as SessionId]
        if (summary !== undefined) uiWorkspace.openSession(summary.id)
      },
      unavailable: () => { notify({ kind: 'chatLinkUnavailable' }) },
      navigation: () => ctx.layout.beginNavigation(),
      subscribe: (listener) => {
        const stopSessions = sessions.list.subscribe(listener)
        const stopWorkspaces = workspaces.list.subscribe(listener)
        return () => { stopSessions(); stopWorkspaces() }
      },
    })
  }, 'workspace.chat-links')
  ctx.effect(() => {
    destinations.observe()
    const stop = uiWorkspace.selection.subscribe(() =>{  destinations.observe() })
    return () => { stop(); destinations.dispose() }
  }, 'workspace.destinations')
  ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')
  const shortcutControls = createWorkspaceShortcutControls()

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  // Stable per-surface occupancy sources (the renderer's hook cache keys by
  // source identity): true while the surface's directory-flow hole is filled.
  const flowSource = (
    hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow',
  ): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const hostInfo: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const openSession: WorkspaceBrowserInjected['open'] = (sessionId) => {
    uiWorkspace.openSession(sessionId)
  }
  // Registry-global sets as Sets, rebuilt only when the Workspace snapshot changes.
  const pinnedSet = derive(workspaces.list, snapshot => new Set<SessionId>(snapshot.pinnedSessionIds))
  const archivedSet = derive(workspaces.list, snapshot => new Set<SessionId>(snapshot.archivedSessionIds))
  // Plugin-private facts the row actions and their overlay surfaces share:
  // the pending rename request and the notice on display. Each business
  // writes through its own injected callback and the surface reads through
  // its bound hook.
  const renameRequest = derive(shortcutControls.state, state => state.renameTarget)
  const archiveRequest = createSnapshotStore<SessionArchiveConfirmRequest | null>(null)
  const requestSessionRename = shortcutControls.rename
  const unarchiveSession = (sessionId: SessionId): void => {
    uiWorkspace.unarchiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session unarchive rejected:', reason)
    })
  }
  const renameSession: SessionRenameDialogInjected['renameSession'] = async (sessionId, title) => {
    const result = await sessions.using(sessionId, { source: 'workspaceOperation' }, reference =>
      reference.binding.session.rename(title),
    )
    if (!result.ok) throw new Error(result.error.message)
  }
  const handoffTarget = createSnapshotStore<HandoffTarget | null>(null)
  const requestHandoff: UsingContextInjected['requestHandoff'] = (sessionId, workflow) => {
    handoffTarget.set({ sessionId, workflow })
  }
  const handoffInjected = (): HandoffDialogInjected => ({
    hooks: { handoffTarget },
    closeHandoff: () => {
      handoffTarget.set(null)
    },
    openDestination: openSession,
    captureSession: async (request) => {
      const result = await ctx.remote.knowledge.captureSession(request)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    readArtifact: async (id) => {
      const result = await ctx.remote.knowledge.read(id)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    registerArtifact: async (request) => {
      const result = await ctx.remote.knowledge.register(request)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    searchArtifacts: async (request) => {
      const result = await ctx.remote.knowledge.search(request)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    prepareHandoff: async (request) => {
      const result = await ctx.remote.knowledge.prepareHandoff(request)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    submitHandoff: async (request) => {
      const result = await ctx.remote.knowledge.submitHandoff(request)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  })
  const contextInjected = (): UsingContextInjected => ({
    requestHandoff,
    inspectArtifact: async (id) => {
      const result = await ctx.remote.knowledge.inspect(id)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    refreshContext: async (sessionId, handoff, id) => {
      const result = await ctx.remote.knowledge.refresh(id)
      if (!result.ok) throw new Error(result.error.message)
      const destinationProject = workspaces.list.getSnapshot().items.find(project => project.sessionIds.includes(sessionId))
      if (destinationProject === undefined) throw new Error('The receiving project is unavailable.')
      handoffTarget.set({
        sessionId: handoff.sourceSessionId ?? sessionId,
        workflow: handoff.workflow,
        sourceProjectId: result.value.projectId,
        destinationProjectId: destinationProject.workspaceId,
        destinationSessionId: sessionId,
        evidence: [result.value],
      })
    },
    readContext: async (sessionId) => {
      const result = await ctx.remote.knowledge.usingContext(sessionId)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
  })
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      { name: 'conversation.input.left', id: 'project.context', locale: NS, inject: contextInjected },
      UsingContext,
    ),
  )
  ctx.slots.inject('sidebar.workflows', () =>
    ctx.slots.register(
      {
        name: 'sidebar.workflows',
        locale: NS,
        store: workflowPresentation,
        inject: (): WorkflowNavigationInjected => ({
          hooks: { selection: uiWorkspace.selection },
          navigate: (profile) => { void destinations.navigate(profile) },
          reveal: () => {
            ctx.layout.selectPanel(null)
          },
        }),
      },
      WorkflowNavigation,
    ),
  )
  ctx.slots.inject('conversation.workspace', () =>
    ctx.slots.register(
      {
        name: 'conversation.workspace',
        locale: NS,
        inject: () => ({
          hooks: {
            presentation: workflowInstance,
            documents: documents.state,
            jobs: ctx.jobs.state,
            filesVisible: ctx.sidebarRight.filesVisible,
          },
          changeResearch: (key: string, change: Partial<import('./workflows/surfaces.ts').ResearchPreference>) => {
            workflowInstance.actions.researchView(key, change)
          },
          showResearchChat: (key: string, visible: boolean) => {
            workflowInstance.actions.showResearchChat(key, visible)
          },
          searchArtifacts: async (request: import('@deepseek-ai/dsh-workspace/types').SearchArtifactsRequest) =>
            unwrap(await ctx.remote.knowledge.search(request)),
          watchResearchFiles: (session: SessionId, path: string, changed: () => void, failed: (reason: unknown) => void) => {
            const lifecycle = { disposed: false }
            const stream = ctx.remote.$stream<import('@deepseek-ai/dsh-api-workspace-files/types').WorkspaceFileWatchFrame>({
              name: `research files ${session}/${path}`,
              open: signal => ctx.remote.workspaceFiles.changes(session, path, signal),
              ended: () => new Error(`Research file watch ended: ${path}`),
            })
            void (async () => {
              try { for await (const item of stream) { if (lifecycle.disposed) break; if (item.value.kind === 'change') changed(); item.accept() } }
              catch (reason) { if (!lifecycle.disposed) failed(reason) }
              finally { await stream.dispose() }
            })()
            return () => { lifecycle.disposed = true; void stream.dispose() }
          },
          researchList: async (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId, query?: string, cursor?: string) =>
            unwrap(await ctx.remote.knowledge.researchList(project, query, cursor)),
          researchInspect: async (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId, path: string) =>
            unwrap(await ctx.remote.knowledge.researchInspect(project, path)),
          researchCreate: async (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId, path: string, title: string) =>
            unwrap(await ctx.remote.knowledge.researchCreate(project, path, title)),
          researchCaptureCitations: async (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId, path: string, text: string) =>
            unwrap(await ctx.remote.knowledge.researchCaptureCitations(project, path, text)),
          researchResolve: async (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId, from: string, target: string, wiki: boolean) =>
            unwrap(await ctx.remote.knowledge.researchResolve(project, from, target, wiki)),
          researchExport: async (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId) =>
            unwrap(await ctx.remote.knowledge.researchExport(project)),
          researchResource: async (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId, path: string) =>
            unwrap(await ctx.remote.knowledge.researchResource(project, path)),
          cancelNotebook: async (session: SessionId, jobId: string) => {
            unwrap(await ctx.jobs.kill(session, jobId as import('@deepseek-ai/dsh-api-job-controller/client').JobView['id']))
          },
          executeNotebook: async (
            project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId,
            id: string,
            session: SessionId,
          ) => unwrap(await ctx.remote.knowledge.executeNotebook(project, id, session)),
          workflowRecords: async (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId) =>
            unwrap(await ctx.remote.knowledge.workflowRecords(project)),
          watchKnowledge: (project: import('@deepseek-ai/dsh-workspace/types').WorkspaceId, changed: () => void, failed: (reason: unknown) => void) => {
            const stopped = (): boolean => disposed
            let disposed = false
            const stream = ctx.remote.$stream<number>({
              name: `project knowledge ${project}`,
              open: signal => ctx.remote.knowledge.watch(project, signal),
              ended: () => new Error(`Project knowledge watch ended: ${project}`),
            })
            void (async () => {
              try {
                for await (const item of stream) {
                  if (stopped()) break
                  changed()
                  item.accept()
                }
              } catch (reason) { if (!stopped()) failed(reason) }
              finally { await stream.dispose() }
            })()
            return () => { disposed = true; void stream.dispose() }
          },
          saveWorkflowRecord: async (request: import('@deepseek-ai/dsh-workspace/types').SaveWorkflowRecord) =>
            unwrap(await ctx.remote.knowledge.saveWorkflowRecord(request)),
          applications: async (session: SessionId) => unwrap(await ctx.remote.knowledge.applications(session)),
          applicationResource: async (session: SessionId, server: string, tool: string) =>
            unwrap(await ctx.remote.knowledge.applicationResource(session, server, tool)),
          applicationCall: async (
            session: SessionId,
            server: string,
            hostTool: string,
            generation: string,
            tool: string,
            args: string,
          ) => unwrap(await ctx.remote.knowledge.applicationCall(session, server, hostTool, generation, tool, args)),
          captureChange: async (session: SessionId) => unwrap(await ctx.remote.knowledge.captureChange(session)),
          recordVerification: async (
            session: SessionId,
            change: import('@deepseek-ai/dsh-workspace/types').ArtifactRevisionId,
            commit: string,
            paths: string[],
            method: 'playwright' | 'devtools' | 'manual' | 'test',
            status: 'passed' | 'failed' | 'cancelled',
            detail: string,
          ) => unwrap(await ctx.remote.knowledge.recordVerification(session, change, commit, paths, method, status, detail)),
          languageReview: async (
            session: SessionId,
            path: string,
            text: string,
            line: number,
            character: number,
            newName?: string,
          ) => unwrap(await ctx.remote.knowledge.languageReview(session, path, text, line, character, newName)),
          documentEvidence: async (session: SessionId, path: string) =>
            unwrap(await ctx.remote.knowledge.documentEvidence(session, path)),
          commentSelection: async (session: SessionId, path: string, text: string, start: number, end: number, comment: string) =>
            unwrap(await ctx.remote.knowledge.commentSelection(session, path, text, start, end, comment)),
          requestSelectionEdit: async (sessionId: SessionId, path: string, selected: string, instruction: string) => {
            const content = [
              {
                type: 'text' as const,
                text: `Propose an edit to the selected passage in ${path}. Return the replacement for review. Preserve the user's file until they accept.\nInstruction: ${instruction}\nSelected passage (source data):\n${selected}`,
              },
            ]
            await sessions.using(sessionId, { source: 'workspaceOperation' }, async (reference) => {
              const binding = await reference.ready
              unwrap(await binding.session.prompt(content, 'queue'))
            })
          },
          linkArtifacts: async (request: import('@deepseek-ai/dsh-workspace/types').LinkArtifactsRequest) =>
            unwrap(await ctx.remote.knowledge.link(request)),
          relatedArtifacts: async (id: import('@deepseek-ai/dsh-workspace/types').ArtifactRevisionId) =>
            unwrap(await ctx.remote.knowledge.related(id)),
          readArtifact: async (id: import('@deepseek-ai/dsh-workspace/types').ArtifactRevisionId) =>
            unwrap(await ctx.remote.knowledge.read(id)),
          registerArtifact: async (request: import('@deepseek-ai/dsh-workspace/types').RegisterArtifactRequest) =>
            unwrap(await ctx.remote.knowledge.register(request)),
          inspectArtifact: contextInjected().inspectArtifact,
          readContext: contextInjected().readContext,
          requestEvidenceHandoff: (
            sessionId: SessionId,
            artifact: import('@deepseek-ai/dsh-workspace/types').ArtifactRevision,
            workflow: import('@deepseek-ai/dsh-workspace/types').WorkflowProfile,
          ) => {
            handoffTarget.set({ sessionId, workflow, sourceProjectId: artifact.projectId, evidence: [artifact] })
          },
          listFiles: async (sessionId: SessionId, path: string) => unwrap(await ctx.remote.workspaceFiles.list(sessionId, path)),
          openPreview: (sessionId: SessionId, path: string) => {
            ctx.sidebarRight.openResource(fileAddressFor(sessionId, sessions.list.getSnapshot().byId[sessionId]?.cwd, path))
          },
          openFiles: () => {
            if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) ctx.sidebarRight.openTab('files')
          },
          openProject: (profile: import('@deepseek-ai/dsh-workspace/types').WorkflowProfile) => {
            const navigation = ctx.layout.beginNavigation()
            const cancelled = () => navigation.aborted
            void (async () => {
              const path = await uiWorkspace.pickDirectory()
              if (path === null || cancelled()) return
              const project = await workspaces.create({ path })
              if (cancelled()) return
              const session = await sessions.create({ workspaceId: project.workspaceId })
              if (cancelled()) return
              workflowInstance.actions.rememberDestination(session, profile, project.workspaceId)
              if (ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
              uiWorkspace.openSession(session)
            })().catch((reason: unknown) => {
              if (!cancelled()) notify({ kind: 'createFailed', message: reason instanceof Error ? reason.message : String(reason) })
            })
          },
          openTerminal: () => {
            ctx.sidebarRight.openTab('terminal')
          },
          toggleFiles: () => {
            if (ctx.sidebarRight.mounted.getSnapshot() === undefined) return
            if (ctx.sidebarRight.isExpanded() && ctx.sidebarRight.active()?.kind === 'files') ctx.sidebarRight.toggleExpanded()
            else ctx.sidebarRight.openTab('files')
          },
          toggleTerminal: () => {
            ctx.sidebarRight.toggleTerminal()
          },
          openSession,
          watchRuns: (sessionId: SessionId) => ctx.jobs.watchRows(sessionId),
          observeRun: (sessionId: SessionId, id: import('@deepseek-ai/dsh-api-job-controller/client').JobView['id']) =>
            ctx.jobs.observe(sessionId, id),
          arrange: (key: string, preset: import('./workflows/layout.ts').WorkspacePreset, swapped: boolean) => {
            workflowInstance.actions.arrange(key, preset, swapped)
          },
          showEditor: (key: string, visible: boolean) => {
            workflowInstance.actions.showEditor(key, visible)
          },
          restoreDocuments: (session: SessionId): void => {
            if (restoredDocuments.has(session)) return
            restoredDocuments.add(session)
            const saved = workflowInstance.getSnapshot().documents?.[session]
            if (saved === undefined) return
            const paths = [
              ...saved.paths.filter(path => path !== saved.active),
              ...(saved.active === undefined ? [] : [saved.active]),
            ]
            void Promise.all(paths.map(path => documents.open(session, path)))
          },
          openDocument: async (session: SessionId, path: string) => {
            await documents.open(session, path)
            rememberDocument(session, path)
          },
          selectDocument: (session: SessionId, path: string) => {
            documents.select(session, path)
            rememberDocument(session, path)
          },
          closeDocument: async (session: SessionId, path: string) => {
            if (await documents.close(session, path)) {
              workflowInstance.actions.forgetDocument(session, path, documents.state.getSnapshot().sessions[session]?.active)
            }
          },
          editDocument: (session: SessionId, path: string, text: string) => documents.edit(session, path, text),
          saveDocument: (session: SessionId, path: string) => documents.save(session, path),
          refreshDocument: (session: SessionId, path: string) => documents.refresh(session, path),
          rebaseDocument: (session: SessionId, path: string) => documents.rebase(session, path),
        }),
      },
      WorkflowWorkspace,
    ),
  )
  const pinInjected = (): PinSessionInjected => ({
    hooks: { pinned: pinnedSet, archived: archivedSet },
    // Pin failures surface as a notice: nothing else on the surface moves, so
    // a silent failure would read as a dead action.
    pinSession: (sessionId) => {
      uiWorkspace.pinSession(sessionId).catch(() => {
        notify({ kind: 'pinFailed' })
      })
    },
    unpinSession: (sessionId) => {
      uiWorkspace.unpinSession(sessionId).catch(() => {
        notify({ kind: 'unpinFailed' })
      })
    },
  })
  const archiveInjected = (): ArchiveSessionInjected => ({
    hooks: { archived: archivedSet },
    // Archive preserves the log and the account position, so a quiet Session
    // needs no confirmation; the notice offers undo and the archived filter.
    // The Host's refusal for running work is the one case that asks first:
    // the confirmation names that work and offers to stop it.
    archiveSession: (sessionId) => {
      uiWorkspace
        .archiveSession(sessionId)
        .then(() => {
          notify({ kind: 'archived', sessionId })
        })
        .catch((reason: unknown) => {
          const activity = activeSessionRefusal(reason)
          if (activity === undefined) {
            console.warn('session archive rejected:', reason)
            return
          }
          const displayTitle = sessions.list.getSnapshot().byId[sessionId]?.displayTitle ?? sessionId
          archiveRequest.set({ sessionId, displayTitle, activity })
        })
    },
    unarchiveSession,
  })
  installWorkspaceShortcuts(ctx, uiWorkspace, shortcutControls, archiveInjected().archiveSession)
  const archiveConfirmInjected = (): SessionArchiveConfirmInjected => ({
    hooks: { archiveRequest },
    settleSessionArchive: () => {
      archiveRequest.set(null)
    },
    stopAndArchiveSession: async (sessionId) => {
      await uiWorkspace.archiveSession(sessionId, { stopActivity: true })
      notify({ kind: 'stoppedAndArchived', sessionId })
    },
  })
  const forkInjected = (): ForkSessionInjected => ({
    forkSession: (sessionId) => {
      uiWorkspace
        .forkSession(sessionId, (childId) => {
          ctx
            .get('productAnalytics')
            ?.track('branch_session_click', { session_id: childId, parent_session_id: sessionId, click_position: 'sidebar' })
        })
        .catch(() => {
          // Fork or child-title failure leaves the list as it was.
        })
    },
  })
  const renameInjected = (): RenameSessionInjected => ({ requestSessionRename })
  const renameDialogInjected = (): SessionRenameDialogInjected => ({
    hooks: { renameRequest },
    settleSessionRename: shortcutControls.closeRename,
    renameSession,
  })
  const rowToastInjected = (): RowToastInjected => ({
    hooks: { toast: rowToast },
    dismissToast: () => {
      rowToast.set(null)
    },
    undoArchive: unarchiveSession,
    showArchived: () => {
      viewInstance.actions.setArchivedFilter('show')
    },
  })
  const browserInjected = (): WorkspaceBrowserInjected => ({
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession: (workspaceId) => {
      uiWorkspace.startSession(workspaceId)
    },
    open: openSession,
    searchSessions,
    searchResultLimit: sessions.searchResultLimit,
    requestSessionRename,
    notifyArchivedNotOpenable: () => {
      notify({ kind: 'archivedNotOpenable' })
    },
    renameWorkspace: async (workspaceId, title) => {
      await workspaces.rename(workspaceId, title)
    },
    deleteWorkspace: async (workspaceId) => {
      await workspaces.delete(workspaceId)
    },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    unarchiveSession: async (sessionId) => {
      await uiWorkspace.unarchiveSession(sessionId)
    },
    createWorkspace: input => workspaces.create(input),
    requestSearch: shortcutControls.search,
    requestAddWorkspace: shortcutControls.add,
    closeAddWorkspace: shortcutControls.closeAdd,
    setDirectoryBusy: shortcutControls.directoryBusy,
    dismissForkError: shortcutControls.dismissForkError,
    hooks: {
      directoryFlow: browserFlowSource,
      hostInfo,
      workspaceShortcuts: shortcutControls.state,
      shortcuts: ctx.shortcuts.catalog,
    },
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  // Each registration declares its owned children in the same call; slot
  // injection follows both the owner and declaration HMR lifetimes.
  ctx.slots.inject('sidebar.workspaces', () =>
    ctx.slots.register(
      {
        name: 'sidebar.workspaces',
        children: {
          'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
          // Every row entry reads the menu's open state through a hook bound
          // from the row's render occurrence (the owner passes the state pair
          // as hookContext).
          'sidebar.workspaces.session.menu.item': {
            kind: 'list',
            scope: 'root',
            inject: { hooks: { menuOpenState: menuOpenStateFactory, shortcuts: ctx.shortcuts.catalog } },
          },
          'sidebar.workspaces.session.row.action': { kind: 'list', scope: 'root' },
          'sidebar.session.row.leading': { kind: 'list', scope: 'root' },
          'sidebar.session.row.hover': { kind: 'list', scope: 'root' },
        },
        store: viewStore,
        inject: browserInjected,
        locale: NS,
      },
      WorkspaceBrowser,
    ),
  )
  // The shipped row actions take the same route as a plugin's: `slots.inject`
  // waits for the browser registration above to declare each list, and the
  // entries leave with it. Orders step by 100 so a plugin entry can land
  // between them.
  ctx.slots.inject('sidebar.workspaces.session.menu.item', function* () {
    yield ctx.slots.register(
      { name: 'sidebar.workspaces.session.menu.item', id: 'pin', order: 100, locale: NS, inject: pinInjected },
      PinSessionMenuItem,
    )
    yield ctx.slots.register(
      { name: 'sidebar.workspaces.session.menu.item', id: 'rename', order: 200, locale: NS, inject: renameInjected },
      RenameSessionMenuItem,
    )
    yield ctx.slots.register(
      { name: 'sidebar.workspaces.session.menu.item', id: 'handoff', order: 250, locale: NS, inject: () => ({ requestHandoff }) },
      HandoffMenuItem,
    )
    yield ctx.slots.register(
      { name: 'sidebar.workspaces.session.menu.item', id: 'copy-chat-link', order: 275, locale: NS },
      CopyChatLinkMenuItem,
    )
    yield ctx.slots.register(
      { name: 'sidebar.workspaces.session.menu.item', id: 'fork', order: 300, locale: NS, inject: forkInjected },
      ForkSessionMenuItem,
    )
    yield ctx.slots.register(
      { name: 'sidebar.workspaces.session.menu.item', id: 'archive', order: 400, locale: NS, inject: archiveInjected },
      ArchiveSessionMenuItem,
    )
  })
  ctx.slots.inject('sidebar.workspaces.session.row.action', function* () {
    yield ctx.slots.register(
      { name: 'sidebar.workspaces.session.row.action', id: 'archive', order: 100, locale: NS, inject: archiveInjected },
      ArchiveSessionRowButton,
    )
    yield ctx.slots.register(
      { name: 'sidebar.workspaces.session.row.action', id: 'pin', order: 200, locale: NS, inject: pinInjected },
      PinSessionRowButton,
    )
  })
  // The surfaces the actions raise live in the frame-wide layer: they must
  // outlive the row menu the action sat in.
  ctx.slots.inject('shell.overlay', function* () {
    yield ctx.slots.register({ name: 'shell.overlay', id: 'project.handoff', locale: NS, inject: handoffInjected }, HandoffDialog)
    yield ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'workspace.session-rename',
        locale: NS,
        inject: renameDialogInjected,
      },
      SessionRenameDialog,
    )
    yield ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'workspace.session-archive',
        locale: NS,
        inject: archiveConfirmInjected,
      },
      SessionArchiveConfirmDialog,
    )
    // The toast shares the browser's viewing store: it reads the archived
    // filter to drop the archived notice's filter action once rows are visible.
    yield ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'workspace.row-toast',
        locale: NS,
        store: viewStore,
        inject: rowToastInjected,
      },
      RowActionToast,
    )
  })
  ctx.slots.inject('conversation.hero.workspace', () =>
    ctx.slots.register(
      {
        name: 'conversation.hero.workspace',
        children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
        inject: pickerInjected,
        locale: NS,
      },
      WorkspacePicker,
    ),
  )
}

/**
 * The activity a Host `workspace/session-active` refusal reported, or nothing
 * for any other failure. The class identity check goes by name: client plugin
 * bundles do not share error-class identity.
 */
function activeSessionRefusal(reason: unknown): readonly SessionActivity[] | undefined {
  if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return undefined
  const { rpcError } = reason as WorkspaceArchiveError
  return rpcError.code === 'workspace/session-active' ? rpcError.details.activity : undefined
}
