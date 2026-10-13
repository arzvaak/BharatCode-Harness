/** Private, profile-local links to existing conversation identities. */
const PREFIX = 'dsh://sessions/'
/**
 * Format a chat identity without embedding its contents or credentials.
 * @param sessionId - Existing profile-local conversation identity.
 * @returns Canonical private chat link.
 */
export function formatChatLink(sessionId: string): string {
  return PREFIX + encodeURIComponent(sessionId).replace(/[.!'()*]/gu, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`)
}
/**
 * Read a canonical private link without accepting URL queries or other schemes.
 * @param link - Complete authored chat link.
 * @returns Decoded conversation identity, or undefined for unsupported links.
 */
export function parseChatLink(link: string): string | undefined {
  if (!link.startsWith(PREFIX)) return undefined
  try {
    const id = decodeURIComponent(link.slice(PREFIX.length))
    return id !== '' && formatChatLink(id) === link ? id : undefined
  } catch { return undefined }
}
