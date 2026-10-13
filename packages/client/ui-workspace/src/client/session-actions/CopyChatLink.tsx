/** Copy a private chat link from the existing conversation menu. */
import { useState } from 'react'
import { IconCopyOutlineRegular, MenuItemButton, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatChatLink } from '@deepseek-ai/dsh-util-workspace-path'
import type { SessionMenuItemProps } from '../contract/slots.ts'
/**
 * Copy the selected conversation identity without exporting its contents.
 * @param props - Existing conversation identity and locale seat.
 * @returns Copy action with truthful clipboard feedback.
 */
export function CopyChatLinkMenuItem({ sessionId, t }: SessionMenuItemProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return <MenuItemButton icon={<IconCopyOutlineRegular />} onSelect={() => {
    void writeClipboard(formatChatLink(sessionId)).then((ok) => { setState(ok ? 'copied' : 'failed') })
  }}>{t(state === 'idle' ? 'menu.copyChatLink' : state === 'copied' ? 'menu.chatLinkCopied' : 'menu.chatLinkCopyFailed')}</MenuItemButton>
}
