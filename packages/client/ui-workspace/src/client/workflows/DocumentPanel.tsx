/** Shared complete-source editor; unsupported manuscript syntax remains untouched. */
import { useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditorSession } from './documents.ts'
import css from './documents.module.css'

/** Plain workspace editor callbacks supplied by the owning plugin. */
export interface DocumentPanelActions {
  openDocument(session: SessionId, path: string): Promise<void>
  selectDocument(session: SessionId, path: string): void
  editDocument(session: SessionId, path: string, text: string): Promise<void>
  saveDocument(session: SessionId, path: string): Promise<void>
  rebaseDocument(session: SessionId, path: string): Promise<void>
}
/** Source editor state and callbacks, with workspace-owned localized copy. */
export type DocumentPanelProps = PropsLocale<'workspace'> & DocumentPanelActions & {
  sessionId: SessionId | null
  view: EditorSession | undefined
  profile: 'chat' | 'coding' | 'writing' | 'research'
}

/** Render exact source, explicit saves, and conflicting disk text.
 * @param props - Session editor state, localized copy, and callbacks.
 * @returns The complete-source editor pane.
 */
export function DocumentPanel({ sessionId, view, profile, t, ...actions }: DocumentPanelProps) {
  const [path, setPath] = useState('')
  const [opening, setOpening] = useState(false)
  const document = view?.active === undefined ? undefined : view.documents[view.active]
  const open = async (): Promise<void> => {
    if (sessionId === null || path.trim() === '' || opening) return
    setOpening(true)
    try { await actions.openDocument(sessionId, path.trim()) }
    finally { setOpening(false) }
  }
  return <section className={css.panel} aria-label={t('editor.title')} data-profile={profile}>
    <form className={css.toolbar} onSubmit={(event) => { event.preventDefault(); void open() }}>
      <input aria-label={t('editor.path')} value={path} onChange={(event) => { setPath(event.target.value) }} placeholder={t('editor.path')} disabled={sessionId === null} />
      <button type="submit" disabled={opening || sessionId === null || path.trim() === ''}>{t(opening ? 'editor.opening' : 'editor.open')}</button>
    </form>
    {view?.error !== undefined && <p role="alert" className={css.error}>{view.error}</p>}
    <div className={css.tabs} role="tablist" aria-label={t('editor.tabs')}>
      {Object.keys(view?.documents ?? {}).map(file => <button key={file} type="button" role="tab" title={file} aria-selected={file === view?.active}
        onClick={() => { if (sessionId !== null) actions.selectDocument(sessionId, file) }}>
        {file.split(/[\\/]/).at(-1) ?? file}{view?.documents[file]?.text !== view?.documents[file]?.base.text ? ' •' : ''}
      </button>)}
    </div>
    {document === undefined ? <div className={css.empty}>{t(sessionId === null ? 'editor.noSession' : 'editor.empty')}</div> : <>
      <div className={css.status}>
        <span>{t(document.busy ? 'editor.saving' : document.text !== document.base.text ? 'editor.unsaved' : 'editor.saved')}</span>
        <button type="button" disabled={document.busy || document.conflict !== undefined || sessionId === null}
          onClick={() => { if (sessionId !== null) void actions.saveDocument(sessionId, document.path) }}>{t('editor.save')}</button>
      </div>
      {document.error !== undefined && <p role="alert" className={css.error}>{document.error}</p>}
      {document.conflict !== undefined && <div className={css.conflict}>
        <p role="alert">{t('editor.conflict')}</p>
        <details><summary>{t('editor.compare')}</summary><pre>{document.conflict.text}</pre></details>
        <button type="button" disabled={document.busy} onClick={() => { if (sessionId !== null) void actions.rebaseDocument(sessionId, document.path) }}>{t('editor.rebase')}</button>
      </div>}
      <textarea className={css.source} aria-label={t('editor.source')} spellCheck={profile !== 'coding'} value={document.text}
        onChange={(event) => { if (sessionId !== null) void actions.editDocument(sessionId, document.path, event.target.value) }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault(); event.stopPropagation()
            if (sessionId !== null) void actions.saveDocument(sessionId, document.path)
          }
        }} />
    </>}
  </section>
}
