/** Shared workflow frame preserves native conversation rendering and composer ownership. */
import type {
  PropsRuntime,
  PropsLocale,
  PropsHooks,
  HostObservable,
  PropsRenderFactories,
} from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef } from 'react'
import type { DocumentPanelActions } from './DocumentPanel.tsx'
import { DocumentPanel } from './DocumentPanel.tsx'
import type { EditorSnapshot } from './documents.ts'
import type { WorkspacePreset } from './layout.ts'
import type { WorkflowPresentationState } from './presentation.ts'
import { WorkflowIcon } from './WorkflowNavigation.tsx'
import css from './workflows.module.css'

export type WorkflowWorkspaceProps = PropsRuntime<'conversation.workspace'> &
  PropsLocale<'workspace'> &
  PropsHooks<{ presentation: HostObservable<WorkflowPresentationState>; documents: HostObservable<EditorSnapshot> }> &
  { arrange: (key: string, preset: WorkspacePreset, swapped: boolean) => void; restoreDocuments: (session: import('@deepseek-ai/dsh-session/types').SessionId) => void } &
  DocumentPanelActions &
  PropsRenderFactories

export function WorkflowWorkspace({
  sessionId,
  usePresentation,
  phase,
  hero,
  renderFactorySlot,
  t,
  useDocuments,
  arrange,
  restoreDocuments,
  ...documents
}: WorkflowWorkspaceProps) {
  const profile = usePresentation(value => value.profiles[sessionId ?? 'new'] ?? 'chat')
  const layoutKey = JSON.stringify([sessionId ?? 'new', profile])
  const layout = usePresentation(value => value.layouts?.[layoutKey])
  const preset = layout?.preset ?? 'balanced'
  const swapped = layout?.swapped ?? false
  const view = useDocuments(value => sessionId === undefined ? undefined : value.sessions[sessionId])
  useEffect(() => { if (sessionId !== undefined) restoreDocuments(sessionId) }, [sessionId, restoreDocuments])
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const element = body.current
    if (element === null || typeof element.animate !== 'function') return
    const animation = element.animate(
      [
        { opacity: 0.72, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 200, easing: 'cubic-bezier(.2,.75,.2,1)' },
    )
    return () => {
      animation.cancel()
    }
  }, [profile])
  return (
    <section className={css.workspace} aria-label={t(`workflow.${profile}`)}>
      <div className={css.workspaceHeader} hidden={profile === 'chat'}>
        <span className={css.profileBadge}>
          <WorkflowIcon profile={profile} />
          {t(`workflow.${profile}`)}
        </span>
        <span className={css.workspaceCaption}>{t(`workflow.${profile}.detail`)}</span>
        <select aria-label={t('layout.label')} value={preset} onChange={(event) => { arrange(layoutKey, event.target.value as WorkspacePreset, swapped) }}>
          {(['balanced', 'chat-focus', 'document-focus', 'focus'] as const).map(value => <option key={value} value={value}>{t(`layout.${value}`)}</option>)}
        </select>
        <button type="button" onClick={() => { arrange(layoutKey, preset, !swapped) }}>{t('layout.swap')}</button>
        <button type="button" onClick={() => { arrange(layoutKey, 'balanced', false) }}>{t('layout.reset')}</button>
      </div>
      <div ref={body} className={css.workspaceBody} data-workflow={profile} data-preset={preset} data-swapped={swapped}>
        <div className={css.chatPane}>
          {renderFactorySlot('conversation.content', { variant: 'main', phase, hero })}
        </div>
        <div className={css.documentPane} hidden={profile === 'chat'}>
          <DocumentPanel sessionId={sessionId ?? null} view={view} profile={profile} t={t} {...documents} />
        </div>
      </div>
    </section>
  )
}
