/** Shared workflow frame preserves native conversation rendering and composer ownership. */
import type {
  PropsRuntime,
  PropsLocale,
  PropsHooks,
  HostObservable,
  PropsRenderFactories,
} from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef } from 'react'
import type { WorkflowPresentationState } from './presentation.ts'
import { WorkflowIcon } from './WorkflowNavigation.tsx'
import css from './workflows.module.css'

export type WorkflowWorkspaceProps = PropsRuntime<'conversation.workspace'> &
  PropsLocale<'workspace'> &
  PropsHooks<{ presentation: HostObservable<WorkflowPresentationState> }> &
  PropsRenderFactories

export function WorkflowWorkspace({
  sessionId,
  usePresentation,
  phase,
  hero,
  renderFactorySlot,
  t,
}: WorkflowWorkspaceProps) {
  const profile = usePresentation(value => value.profiles[sessionId ?? 'new'] ?? 'chat')
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
      </div>
      <div ref={body} className={css.workspaceBody}>
        {renderFactorySlot('conversation.content', { variant: 'main', phase, hero })}
      </div>
    </section>
  )
}
