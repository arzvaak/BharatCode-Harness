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
import type { JobsSnapshot } from '@deepseek-ai/dsh-api-job-controller/client'
import type { JobView } from '@deepseek-ai/dsh-api-job-controller/client'
import type { ResearchPreference, WorkspaceSurfaceActions } from './surfaces.ts'
import { ResearchWorkspace } from './ResearchWorkspace.tsx'
import { CodingWorkspace } from './CodingWorkspace.tsx'
import { DocumentPanel } from './DocumentPanel.tsx'
import type { EditorSnapshot } from './documents.ts'
import type { WorkspacePreset } from './layout.ts'
import type { WorkflowPresentationState } from './presentation.ts'
import { WorkflowIcon } from './WorkflowNavigation.tsx'
import css from './workflows.module.css'

export type WorkflowWorkspaceProps = PropsRuntime<'conversation.workspace'> &
  PropsLocale<'workspace'> &
  PropsHooks<{
    presentation: HostObservable<WorkflowPresentationState>
    documents: HostObservable<EditorSnapshot>
    jobs: HostObservable<JobsSnapshot>
  }> &
  {
    changeResearch: (key: string, change: Partial<ResearchPreference>) => void
    showResearchChat: (key: string, visible: boolean) => void
    watchRuns: (session: SessionId) => () => void
    observeRun: (session: SessionId, id: JobView['id']) => () => void
    showEditor: (key: string, visible: boolean) => void
    arrange: (key: string, preset: WorkspacePreset, swapped: boolean) => void
    restoreDocuments: (session: SessionId) => void
  } &
  DocumentPanelActions & WorkspaceSurfaceActions &
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
  changeResearch, showResearchChat: _showResearchChat, useJobs, watchRuns, observeRun,
  useWorkspaces, useSessions,
  openFiles, toggleFiles, toggleTerminal,
  ...documents
}: WorkflowWorkspaceProps) {
  const profile = usePresentation(value => value.profiles[sessionId ?? 'new'] ?? 'chat')
  const layoutKey = JSON.stringify([sessionId ?? 'new', profile])
  const layout = usePresentation(value => value.layouts?.[layoutKey])
  const preset = layout?.preset ?? 'chat-focus'
  const swapped = layout?.swapped ?? false
  const view = useDocuments(value => sessionId === undefined ? undefined : value.sessions[sessionId])
  const editorPreference = usePresentation(value => value.surfaceVisibility?.[layoutKey])
  const editorVisible = profile !== 'chat' && (editorPreference ?? false)
  const researchPreference: ResearchPreference = usePresentation(value => value.research?.[sessionId ?? 'new']) ?? { complexity: 'full', section: 'overview' }
  const researchChat = true
  const project = useWorkspaces(value => value.items.find(item => sessionId !== undefined && item.sessionIds.includes(sessionId)))
  const projectSessions = useSessions(value => project?.sessionIds.flatMap((id) => {
    const session = value.byId[id]
    return session === undefined ? [] : [{ id, title: session.displayTitle, running: session.running }]
  }) ?? [])
  const jobs = useJobs(value => value)
  const toggleKey = profile === 'research' ? 'research.toggle' : profile === 'coding' ? 'coding.editor' : 'editor.documents'
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
          {t(toggleKey)}
        </button>
        {profile !== 'chat' && <button type="button" onClick={() => { openFiles?.() }}>{t('editor.files')}</button>}
        <select disabled={!editorVisible} aria-label={t('layout.label')} value={preset}
          onChange={(event) => { arrange(layoutKey, event.target.value as WorkspacePreset, swapped) }}>
          {(['balanced', 'chat-focus', 'document-focus', ...(profile === 'research' ? [] : ['focus'])] as WorkspacePreset[])
            .map(value => <option key={value} value={value}>{t(`layout.${value}`)}</option>)}
        </select>
        <button type="button" disabled={!editorVisible} onClick={() => { arrange(layoutKey, preset, !swapped) }}>{t('layout.swap')}</button>
        <button type="button" onClick={() => { arrange(layoutKey, 'chat-focus', false); showEditor(layoutKey, true) }}>{t('layout.reset')}</button>
        <button type="button" aria-label={t('layout.toggleBottom')} title={t('layout.toggleBottom')} onClick={() => { toggleTerminal?.() }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" /><path d="M2 10h12" stroke="currentColor" /></svg>
        </button>
        <button type="button" aria-label={t('layout.toggleRight')} title={t('layout.toggleRight')} onClick={() => { toggleFiles?.() }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" /><path d="M10 2v12" stroke="currentColor" /></svg>
        </button>



      </div>
      <div ref={body} className={css.workspaceBody} data-editor-collapsed={!editorVisible}
        data-workflow={profile} data-research-chat={researchChat}
        data-preset={profile === 'research' && preset === 'focus' ? 'chat-focus' : preset} data-swapped={swapped}>
        <div className={css.chatPane}>
          {renderFactorySlot('conversation.content', { variant: profile === 'chat' ? 'main' : 'embedded', phase: profile === 'chat' ? phase : 'active', hero: profile === 'chat' && hero })}
        </div>
        <div className={css.documentPane} hidden={!editorVisible}>
          <div className={css.editorContent}>
            {profile === 'research' ? <ResearchWorkspace
              {...documents} sessionId={sessionId ?? null} profile="research" t={t} view={view}
              collapseEditor={() => { showEditor(layoutKey, false); documentsToggle.current?.focus() }}
              project={project} preference={researchPreference} sessions={projectSessions}
              changePreference={(change) => { changeResearch(sessionId ?? 'new', change) }}
              jobs={sessionId === undefined ? [] : jobs.rows[sessionId] ?? []} observed={jobs.observed}
              watchRuns={watchRuns} observeRun={observeRun}
            /> : profile === 'coding' ? <CodingWorkspace
              {...documents} sessionId={sessionId ?? null} profile="coding" t={t} view={view}
              collapseEditor={() => { showEditor(layoutKey, false); documentsToggle.current?.focus() }}
            /> : <DocumentPanel hideFiles={profile !== 'chat'} collapseEditor={() => { showEditor(layoutKey, false); documentsToggle.current?.focus() }}
              sessionId={sessionId ?? null} view={view} profile={profile} t={t} {...documents} />}
          </div>
        </div>
      </div>
    </section>
  )
}
