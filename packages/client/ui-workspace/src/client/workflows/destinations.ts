/** Workflow destinations own navigation, never conversation contents or model execution. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkflowPresentationState, WorkflowView } from './presentation.ts'

/** Host operations used by the navigation coordinator. */
export interface DestinationPort {
  selection(): SessionId | undefined
  snapshot(): WorkflowPresentationState
  available(session: SessionId): boolean
  context(session: SessionId | undefined): string
  visible(): boolean
  navigation(): AbortSignal
  remember(session: SessionId, profile: WorkflowView, bookmark?: boolean): void
  create(source: SessionId | undefined): Promise<SessionId>
  open(session: SessionId): void
  pending(profile: WorkflowView | undefined): void
  failed(reason: unknown): void
}
/** Resolve independent conversations with late-completion and manual-navigation protection. */
export class WorkflowDestinations {
  private revision = 0
  private disposed = false
  private isDisposed(): boolean { return this.disposed }
  private readonly creating = new Map<string, Promise<SessionId>>()
  private readonly abortCleanups = new Set<() => void>()
  constructor(private readonly port: DestinationPort) {}
  /** Record explicit history navigation; legacy presentation switches remain Chat ownership. */
  observe(): void {
    if (this.isDisposed()) return
    ++this.revision
    this.port.pending(undefined)
    const session = this.port.selection()
    if (session !== undefined) this.port.remember(session, this.port.snapshot().owners?.[session] ?? 'chat')
  }
  /** Open the remembered destination, creating a fresh conversation only on first entry. */
  async navigate(profile: WorkflowView): Promise<void> {
    if (this.isDisposed()) return
    const revision = ++this.revision
    const navigation = this.port.navigation()
    const source = this.port.selection()
    const state = this.port.snapshot()
    if (source !== undefined) this.port.remember(source, state.owners?.[source] ?? 'chat')
    const context = this.port.context(source)
    const key = JSON.stringify([context, profile])
    const remembered = this.port.snapshot().destinations?.[key]
    if (remembered !== undefined && this.port.available(remembered) && this.port.context(remembered) === context) {
      this.port.pending(undefined)
      this.port.remember(remembered, profile)
      if (source !== remembered) this.port.open(remembered)
      return
    }
    this.port.pending(profile)
    const aborted = (): void => { if (revision === this.revision) this.port.pending(undefined) }
    const cleanup = (): void => {
      navigation.removeEventListener('abort', aborted)
      this.abortCleanups.delete(cleanup)
    }
    navigation.addEventListener('abort', aborted, { once: true })
    this.abortCleanups.add(cleanup)
    if (navigation.aborted) aborted()
    try {
      let attempt = this.creating.get(key)
      if (attempt === undefined) {
        attempt = this.port.create(source)
        this.creating.set(key, attempt)
      }
      const session = await attempt
      if (this.isDisposed()) return
      const destination = this.port.snapshot().destinations?.[key]
      const current = revision === this.revision && !navigation.aborted && this.port.visible()
      // Keep the new session's provenance without replacing a newer history selection.
      this.port.remember(session, profile, current || destination === undefined || !this.port.available(destination))
      if (current) this.port.open(session)
    } catch (reason: unknown) {
      if (revision === this.revision && !navigation.aborted) this.port.failed(reason)
    } finally {
      cleanup()
      this.creating.delete(key)
      if (revision === this.revision) this.port.pending(undefined)
    }
  }
  /** Invalidate pending opens when the plugin is disposed. */
  dispose(): void {
    this.disposed = true
    ++this.revision
    for (const cleanup of this.abortCleanups) cleanup()
    this.port.pending(undefined)
  }
}
