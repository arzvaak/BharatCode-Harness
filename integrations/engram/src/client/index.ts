/**
 * dsh-engram client half: registers the "Memory Palace" section on the settings page.
 * Data is read and mutated through the loopback API (/api/engram/*), aligned with the host half's routes.
 * Copy flows through the host locale service (zh/en dictionaries; the renderer auto-re-renders on language switch).
 * @module @kenz1117/dsh-engram/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: ctx.locale service declaration (Context merge from the host locale plugin).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: ctx.slots (the renderer's SlotMap wiring).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: SlotMap merge for the settings.section slot (ui-settings contract).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: LocaleNamespaceMap declaration-merge target (key-type checking for the t seat).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { bindEngramSection } from './EngramPanel.tsx'
import type { SessionsLike, WorkspacesLike } from './EngramPanel.tsx'
import { NS, en, zh, type EngramKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    [NS]: EngramKey
  }
}

/** Required services: slots rendering wiring + locale dictionary registration. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: registers the zh/en dictionaries and the settings-page "Memory Palace"
 * section (order 20, after general/models/plugins).
 *
 * The panel's "project palace" follows the GUI's current workspace and needs the host's
 * workspace/session listing services; both are **optionally consumed** (`ctx.get`, not put in the
 * required inject): when absent, the rest of the panel works as usual, and only the project-palace
 * source chip shows "No workspace info (process default)".
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-engram: dictionaries')
  const t = ctx.locale.bind(NS)
  // Optional services: consumed by runtime shape (no hard dependency on @deepseek-ai/dsh-api-* client packages);
  // fetched live via getters rather than at apply time — these two services may mount after this plugin.
  const workspaces = (): WorkspacesLike | undefined => ctx.get('workspaces' as never) as WorkspacesLike | undefined
  const sessions = (): SessionsLike | undefined => ctx.get('sessions' as never) as SessionsLike | undefined
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'engram',
    order: 20,
    label: () => t('nav'),
    locale: NS,
  }, bindEngramSection({ workspaces, sessions }))), 'dsh-engram: settings section')
}
