/** Queue private chat links across native launch and authenticated client boot. */
import { parseChatLink } from '@deepseek-ai/dsh-util-workspace-path'
/** The native process retains only the latest requested local chat identity. */
export class DesktopChatLinks {
  private pending: string | undefined
  private notify: (() => void) | undefined
  /**
   * Queue a canonical link without opening documents or creating conversations.
   * @param link - Native launch URI.
   * @returns Whether the URI identifies a profile-local chat.
   */
  accept(link: string): boolean {
    if (parseChatLink(link) === undefined) return false
    this.pending = link
    this.notify?.()
    return true
  }
  /**
   * Install the product-window notification callback.
   * @param listener - Signal that the authenticated product should read the queue.
   */
  listen(listener: () => void): void { this.notify = listener }
  /**
   * Consume the latest request after the product has connected.
   * @returns Pending private chat link, if any.
   */
  take(): string | undefined {
    const value = this.pending
    this.pending = undefined
    return value
  }
}
