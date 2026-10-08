/** Editable sources and private recovery copies; saves never silently resolve conflicts. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { EditableWorkspaceDocument, SaveWorkspaceDocumentResult } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { DocumentRecoveryDraft, SaveDocumentDraftRequest } from '@deepseek-ai/dsh-workspace/types'

/** Checked disk publication and private draft persistence supplied by Host remotes. */
export interface DocumentAccess {
  read(sessionId: SessionId, path: string): Promise<EditableWorkspaceDocument>
  save(sessionId: SessionId, path: string, text: string, version: string): Promise<SaveWorkspaceDocumentResult>
  readDraft(sessionId: SessionId, path: string): Promise<DocumentRecoveryDraft | undefined>
  saveDraft(request: SaveDocumentDraftRequest): Promise<DocumentRecoveryDraft>
  clearDraft(sessionId: SessionId, path: string, revision: string): Promise<void>
}
/** Source, unsaved text, and the separately compared disk revision of one tab. */
export interface EditorDocument {
  readonly path: string
  readonly base: EditableWorkspaceDocument
  readonly text: string
  readonly recovery?: DocumentRecoveryDraft | undefined
  readonly conflict?: EditableWorkspaceDocument | undefined
  readonly busy: boolean
  readonly error?: string | undefined
}
/** Independently retained documents and selected tab for one Session. */
export interface EditorSession {
  readonly active?: string | undefined
  readonly documents: Readonly<Record<string, EditorDocument>>
  readonly error?: string | undefined
}
/** Plugin-owned reactive editor state, without provider or agent state. */
export interface EditorSnapshot {
  readonly sessions: Readonly<Record<string, EditorSession>>
}
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** One owner serializes disk/recovery operations while edits remain immediately available. */
export class WorkspaceDocuments {
  readonly state = createSnapshotStore<EditorSnapshot>({ sessions: {} })
  private readonly queues = new Map<string, Promise<void>>()
  private readonly opening = new Map<string, Promise<void>>()
  private readonly selected = new Map<SessionId, string>()
  private disposed = false
  constructor(private readonly access: DocumentAccess) {}

  private update(session: SessionId, path: string, change: (document: EditorDocument) => EditorDocument): void {
    if (this.disposed) return
    const snapshot = this.state.getSnapshot()
    const view = snapshot.sessions[session]
    const document = view?.documents[path]
    if (view === undefined || document === undefined) return
    this.state.set({ sessions: { ...snapshot.sessions, [session]: {
      ...view, documents: { ...view.documents, [path]: change(document) },
    } } })
  }
  private document(session: SessionId, path: string): EditorDocument {
    const document = this.state.getSnapshot().sessions[session]?.documents[path]
    if (document === undefined) throw new Error('Open the document before editing it.')
    return document
  }
  private enqueue(session: SessionId, path: string, action: () => Promise<void>): Promise<void> {
    const key = JSON.stringify([session, path])
    const result = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      if (!this.disposed) await action()
    }).catch((error: unknown) => { this.update(session, path, value => ({ ...value, busy: false, error: message(error) })) })
    this.queues.set(key, result)
    void result.then(() => { if (this.queues.get(key) === result) this.queues.delete(key) })
    return result
  }

  /** Open exact UTF-8 source and recover unsaved text without writing the file. */
  async open(session: SessionId, path: string): Promise<void> {
    this.selected.set(session, path)
    const existing = this.state.getSnapshot().sessions[session]?.documents[path]
    if (existing !== undefined) { this.select(session, path); return }
    const key = JSON.stringify([session, path])
    const pending = this.opening.get(key)
    if (pending !== undefined) return pending
    const operation = this.load(session, path)
    this.opening.set(key, operation)
    try { await operation } finally { this.opening.delete(key) }
  }
  private async load(session: SessionId, path: string): Promise<void> {
    try {
      const base = await this.access.read(session, path)
      const recovery = await this.access.readDraft(session, path)
      if (this.disposed) return
      const snapshot = this.state.getSnapshot()
      const view = snapshot.sessions[session]
      const document: EditorDocument = {
        path, base, text: recovery?.text ?? base.text, recovery, busy: false,
        conflict: recovery !== undefined && recovery.baseVersion !== base.version ? base : undefined,
      }
      this.state.set({ sessions: { ...snapshot.sessions, [session]: {
        active: this.selected.get(session) === path ? path : view?.active, documents: { ...view?.documents, [path]: document },
      } } })
    } catch (error) {
      if (this.disposed) return
      const snapshot = this.state.getSnapshot()
      const view = snapshot.sessions[session]
      this.state.set({ sessions: { ...snapshot.sessions, [session]: {
        ...view, documents: view?.documents ?? {}, error: message(error),
      } } })
    }
  }
  /** Activate an already opened document without changing its text. */
  select(session: SessionId, path: string): void {
    this.selected.set(session, path)
    const snapshot = this.state.getSnapshot()
    const view = snapshot.sessions[session]
    if (view?.documents[path] === undefined || this.disposed) return
    this.state.set({ sessions: { ...snapshot.sessions, [session]: { ...view, active: path } } })
  }
  /** Publish an edit immediately and persist a serialized host-private recovery copy. */
  edit(session: SessionId, path: string, text: string): Promise<void> {
    this.update(session, path, value => ({ ...value, text, error: undefined }))
    return this.enqueue(session, path, async () => {
      if (this.state.getSnapshot().sessions[session]?.documents[path] !== undefined) await this.recover(session, path)
    })
  }
  private async recover(session: SessionId, path: string): Promise<void> {
    const value = this.document(session, path)
    const recovery = await this.access.saveDraft({
      sessionId: session, path, text: value.text,
      baseVersion: value.conflict !== undefined ? value.recovery?.baseVersion ?? value.base.version : value.base.version,
      expectedDraftRevision: value.recovery?.revision ?? null,
    })
    this.update(session, path, latest => ({ ...latest, recovery }))
  }
  /** Compare against the opened version; conflicting disk text remains separately visible. */
  save(session: SessionId, path: string): Promise<void> {
    return this.enqueue(session, path, async () => {
      const value = this.document(session, path)
      if (value.conflict !== undefined) return
      this.update(session, path, latest => ({ ...latest, busy: true, error: undefined }))
      const result = await this.access.save(session, path, value.text, value.base.version)
      if (result.status === 'conflict') {
        this.update(session, path, latest => ({ ...latest, busy: false, conflict: result.current }))
        return
      }
      this.update(session, path, latest => ({ ...latest, busy: false, base: result.document }))
      const latest = this.document(session, path)
      if (latest.text !== result.document.text) { await this.recover(session, path); return }
      if (latest.recovery !== undefined) {
        await this.access.clearDraft(session, path, latest.recovery.revision)
        this.update(session, path, document => ({ ...document, recovery: undefined }))
      }
    })
  }
  /** Explicitly accept the compared disk revision as the next save base, retaining the user's text. */
  rebase(session: SessionId, path: string): Promise<void> {
    return this.enqueue(session, path, async () => {
      this.update(session, path, value => value.conflict === undefined ? value : {
        ...value, base: value.conflict, conflict: undefined,
      })
      await this.recover(session, path)
    })
  }
  /** Close a tab after its latest unsaved text is safely retained in private recovery storage. */
  async close(session: SessionId, path: string): Promise<boolean> {
    let closed = false
    await this.enqueue(session, path, async () => {
      if (this.state.getSnapshot().sessions[session]?.documents[path] === undefined) return
      let value = this.document(session, path)
      while (value.text !== value.base.text) {
        await this.recover(session, path)
        value = this.document(session, path)
        if (value.recovery?.text === value.text) break
      }
      const snapshot = this.state.getSnapshot()
      const view = snapshot.sessions[session]
      if (view === undefined) return
      const remaining = Object.fromEntries(Object.entries(view.documents).filter(([key]) => key !== path))
      const active = view.active === path ? Object.keys(remaining).at(-1) : view.active
      if (active === undefined) this.selected.delete(session)
      else this.selected.set(session, active)
      this.state.set({ sessions: { ...snapshot.sessions, [session]: { ...view, documents: remaining, active } } })
      closed = true
    })
    return closed
  }
  /** Release this plugin's pending publication when its Cordis lifetime ends. */
  dispose(): void { this.disposed = true }
}
