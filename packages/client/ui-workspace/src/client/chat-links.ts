/** Navigate native chat links through the existing profile/session controller. */
import { parseChatLink } from '@deepseek-ai/dsh-util-workspace-path'
/** Origin-scoped native link delivery exposed by the product preload. */
export interface ChatLinkBridge {
  peekPending(): Promise<string | undefined>
  acknowledge(link: string): Promise<void>
  subscribe(listener: () => void): () => void
}
/** Metadata and navigation operations that never create or resume a session. */
export interface ChatLinkNavigationPort {
  ready(): boolean
  available(id: string): boolean
  open(id: string): void
  unavailable(): void
  navigation(): AbortSignal
  subscribe(listener: () => void): () => void
}
/**
 * Open queued links only after profile metadata arrives, respecting later navigation.
 * @param bridge - Product-owned native link queue.
 * @param port - Current profile metadata and viewing operations.
 * @returns Cleanup that prevents pending native opens after disposal.
 */
export function installChatLinkNavigation(bridge: ChatLinkBridge, port: ChatLinkNavigationPort): () => void {
  let disposed = false
  let reading = false
  let again = false
  let pending: { id: string; link: string; signal: AbortSignal } | undefined
  const isDisposed = (): boolean => disposed
  const requestedAgain = (): boolean => again
  const acknowledge = (link: string): void => {
    void bridge.acknowledge(link).catch(() => { if (!isDisposed()) port.unavailable() })
  }
  const flush = (): void => {
    if (isDisposed() || reading || !port.ready() || pending === undefined) return
    const value = pending
    pending = undefined
    if (value.signal.aborted) { acknowledge(value.link); return }
    if (port.available(value.id)) port.open(value.id)
    else port.unavailable()
    acknowledge(value.link)
  }
  const poll = async (): Promise<void> => {
    if (isDisposed()) return
    if (reading) { again = true; return }
    reading = true
    const signal = port.navigation()
    try {
      do {
        again = false
        const link = await bridge.peekPending()
        if (isDisposed()) return
        if (signal.aborted) { if (link !== undefined) acknowledge(link); return }
        if (link !== undefined) {
          const id = parseChatLink(link)
          if (id === undefined) { pending = undefined; port.unavailable(); acknowledge(link) }
          else pending = { id, link, signal }
        }
      } while (requestedAgain())
    } catch {
      if (!isDisposed() && !signal.aborted) port.unavailable()
    } finally {
      reading = false
      flush()
    }
  }
  const stopRequests = bridge.subscribe(() => { void poll() })
  const stopMetadata = port.subscribe(flush)
  void poll()
  return () => { disposed = true; pending = undefined; stopRequests(); stopMetadata() }
}
