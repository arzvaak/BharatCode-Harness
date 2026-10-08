/** Shared workflow frame preserves native conversation rendering and composer ownership. */
import type {
  PropsRuntime,
  PropsLocale,
  PropsHooks,
  HostObservable,
  PropsRenderFactories,
} from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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
  {
    showEditor: (key: string, visible: boolean) => void
    arrange: (key: string, preset: WorkspacePreset, swapped: boolean) => void
    restoreDocuments: (session: SessionId) => void
  } &
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
  showEditor,
  restoreDocuments,
  ...documents
}: WorkflowWorkspaceProps) {
  const profile = usePresentation(value => value.profiles[sessionId ?? 'new'] ?? 'chat')
  const layoutKey = JSON.stringify([sessionId ?? 'new', profile])
  const layout = usePresentation(value => value.layouts?.[layoutKey])
  const preset = layout?.preset ?? 'balanced'
  const swapped = layout?.swapped ?? false
  const view = useDocuments(value => sessionId === undefined ? undefined : value.sessions[sessionId])
  const editorPreference = usePresentation(value => value.editorVisibility?.[layoutKey])
  const hasDocuments = Object.keys(view?.documents ?? {}).length > 0
  const editorVisible = profile !== 'chat' && (editorPreference ?? hasDocuments)
  useEffect(() => { if (sessionId !== undefined) restoreDocuments(sessionId) }, [sessionId, restoreDocuments])
  const documentsToggle = useRef<HTMLButtonElement>(null)
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
        <button ref={documentsToggle} type="button" aria-expanded={editorVisible} onClick={() => { showEditor(layoutKey, !editorVisible) }}>
          {t('editor.documents')}
        </button>
        <select hidden={!editorVisible} disabled={!editorVisible} aria-label={t('layout.label')} value={preset}
          onChange={(event) => { arrange(layoutKey, event.target.value as WorkspacePreset, swapped) }}>
          {(['balanced', 'chat-focus', 'document-focus', 'focus'] as const).map(value => <option key={value} value={value}>{t(`layout.${value}`)}</option>)}
        </select>
        <button type="button" hidden={!editorVisible} disabled={!editorVisible} onClick={() => { arrange(layoutKey, preset, !swapped) }}>{t('layout.swap')}</button>
        <button type="button" hidden={!editorVisible} onClick={() => { arrange(layoutKey, 'balanced', false); showEditor(layoutKey, hasDocuments) }}>{t('layout.reset')}</button>
      </div>
      <div ref={body} className={css.workspaceBody} data-editor-collapsed={!editorVisible}
        data-workflow={profile} data-preset={preset} data-swapped={swapped}>
        <div className={css.chatPane}>
          {renderFactorySlot('conversation.content', { variant: 'main', phase, hero })}
        </div>
        <div className={css.documentPane} hidden={!editorVisible}>
          <DocumentPanel collapseEditor={() => { showEditor(layoutKey, false); documentsToggle.current?.focus() }}
            sessionId={sessionId ?? null} view={view} profile={profile} t={t} {...documents} />
        </div>
      </div>
    </section>
  )
}
