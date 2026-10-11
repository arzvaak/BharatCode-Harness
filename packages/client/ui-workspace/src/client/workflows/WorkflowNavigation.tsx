/** Workflow views occupy the sidebar, independent of model context admission. */
import type {
  PropsRuntime,
  PropsLocale,
  PropsStore,
  PropsHooks,
  HostObservable,
} from '@deepseek-ai/dsh-client-ui-slots'
import { IconNewChatOutlineRegular, IconCodeOutlineRegular, IconSearchOutlineRegular, IconEditOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { createWorkflowPresentationStore, WorkflowView } from './presentation.ts'
import css from './workflows.module.css'
import { useRef } from 'react'
import { useControlMotion } from './control-motion.ts'

export interface WorkflowNavigationInjected {
  hooks: { selection: HostObservable<{ readonly sessionId?: SessionId }> }
  navigate: (profile: WorkflowView) => void
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
export function WorkflowNavigation({ wide, useSelection, useStore, usePanelInfo, navigate, reveal, t }: WorkflowNavigationProps) {
  const controls = useRef<HTMLElement>(null)
  useControlMotion(controls)
  const session = useSelection(value => value.sessionId) ?? 'new'
  const workflowVisible = usePanelInfo(info => info.activePanelId === null)
  const pending = useStore(value => value.navigating)
  const selected = useStore(value => value.profiles[session] ?? 'chat')
  return (
    <nav ref={controls} className={css.navigation} data-wide={wide} aria-label={t('workflow.label')}>
      {wide && <div className={css.sectionLabel}>{t('workflow.label')}</div>}
      {(['chat', 'coding', 'research', 'writing'] as const).map(profile => (
        <button
          key={profile}
          type="button"
          aria-label={t(`workflow.${profile}`)}
          title={wide ? undefined : t(`workflow.${profile}`)}
          aria-current={workflowVisible && selected === profile ? 'page' : undefined}
          className={css.workflowChoice}
          data-workflow={profile}
          aria-busy={pending === profile}
          onClick={() => {
            reveal()
            navigate(profile)
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
          {wide && workflowVisible && selected === profile && <span className={css.activeDot} aria-hidden="true" />}
        </button>
      ))}
    </nav>
  )
}
