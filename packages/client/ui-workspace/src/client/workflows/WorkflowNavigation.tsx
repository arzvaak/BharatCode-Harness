/** Workflow views occupy the sidebar, independent of model context admission. */
import type {
  PropsRuntime,
  PropsLocale,
  PropsStore,
  PropsHooks,
  HostObservable,
} from '@deepseek-ai/dsh-client-ui-slots'
import { IconNewChatOutlineRegular, IconCodeOutlineRegular, IconSearchOutlineRegular, IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { createWorkflowPresentationStore, WorkflowView } from './presentation.ts'
import css from './workflows.module.css'

export interface WorkflowNavigationInjected {
  hooks: { selection: HostObservable<{ readonly sessionId?: SessionId }> }
  reveal: () => void
}
export type WorkflowNavigationProps = PropsRuntime<'sidebar.workflows'> &
  PropsLocale<'workspace'> &
  PropsStore<ReturnType<typeof createWorkflowPresentationStore>> &
  Omit<WorkflowNavigationInjected, 'hooks'> &
  PropsHooks<WorkflowNavigationInjected['hooks']>

const icons = {
  chat: IconNewChatOutlineRegular,
  coding: IconCodeOutlineRegular,
  research: IconSearchOutlineRegular,
  writing: IconEditOutlineRegular,
}
export function WorkflowIcon({ profile }: { profile: WorkflowView }) {
  const Icon = icons[profile]
  return <Icon size={19} />
}
export function WorkflowNavigation({ wide, useSelection, useStore, actions, reveal, t }: WorkflowNavigationProps) {
  const session = useSelection(value => value.sessionId) ?? 'new'
  const selected = useStore(value => value.profiles[session] ?? 'chat')
  return (
    <nav className={css.navigation} data-wide={wide} aria-label={t('workflow.label')}>
      {wide && <div className={css.sectionLabel}>{t('workflow.label')}</div>}
      {(['chat', 'coding', 'research', 'writing'] as const).map(profile => (
        <button
          key={profile}
          type="button"
          aria-label={t(`workflow.${profile}`)}
          title={wide ? undefined : t(`workflow.${profile}`)}
          aria-current={selected === profile ? 'page' : undefined}
          className={css.workflowChoice}
          onClick={() => {
            actions.choose(session, profile)
            reveal()
          }}
        >
          <span className={css.workflowIcon}>
            <WorkflowIcon profile={profile} />
          </span>
          {wide && (
            <span className={css.workflowCopy}>
              <strong>{t(`workflow.${profile}`)}</strong>
              <small>{t(`workflow.${profile}.detail`)}</small>
            </span>
          )}
          {wide && selected === profile && <span className={css.activeDot} aria-hidden="true" />}
        </button>
      ))}
    </nav>
  )
}
