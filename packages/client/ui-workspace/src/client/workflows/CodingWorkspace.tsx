/** Coding owns repository navigation and editing controls within the shared frame. */
import type { DocumentPanelProps } from './DocumentPanel.tsx'
import { DocumentPanel } from './DocumentPanel.tsx'
import type { WorkspaceSurfaceActions } from './surfaces.ts'
import css from './surfaces.module.css'

export type CodingWorkspaceProps = DocumentPanelProps & Pick<WorkspaceSurfaceActions, 'listFiles' | 'openPreview' | 'openTerminal'>
/** @param props - Recoverable source buffers and project filesystem access. @returns Coding's explorer and editable files. */
export function CodingWorkspace(props: CodingWorkspaceProps) {
  const { sessionId, view, t } = props
  const current = view?.active === undefined ? undefined : view.documents[view.active]
  return <section className={css.surface} aria-label={t('coding.workspace')}>
    <div className={css.toolbar}>
      <button type="button" disabled={sessionId === null} onClick={props.openTerminal}>{t('coding.terminal')}</button>
      <button type="button" disabled={current === undefined || sessionId === null} onClick={() => {
        if (current !== undefined && sessionId !== null) props.openPreview(sessionId, current.path)
      }}>{t('coding.preview')}</button>
      <span className={css.muted}>{t('coding.recovery')}</span>
    </div>
    <DocumentPanel {...props} hideFiles profile="coding" titleKey="coding.editor" sourceKey="coding.source" />
  </section>
}
