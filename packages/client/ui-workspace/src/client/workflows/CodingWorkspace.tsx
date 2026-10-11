/** Coding owns repository navigation and editing controls within the shared frame. */
import { useEffect, useRef, useState } from 'react'
import type { LanguageReview } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { DocumentPanelProps } from './DocumentPanel.tsx'
import { GitReviewPanel } from './GitReviewPanel.tsx'
import { DocumentPanel } from './DocumentPanel.tsx'
import type { WorkspaceSurfaceActions } from './surfaces.ts'
import css from './surfaces.module.css'
import { useToolMotion } from './tool-motion.ts'

export type CodingWorkspaceProps = DocumentPanelProps & WorkspaceSurfaceActions & { filesVisible?: boolean }
/** @param props - Recoverable source buffers and project filesystem access. @returns Coding's explorer and editable files. */
export function CodingWorkspace(props: CodingWorkspaceProps) {
  const { sessionId, view, t } = props
  const [tool, setTool] = useState<'editor' | 'changes' | 'checks'>('editor')
  const motion = useToolMotion<HTMLDivElement>(tool)
  const current = view?.active === undefined ? undefined : view.documents[view.active]
  const epoch = useRef(0)
  const [review, setReview] = useState<LanguageReview>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState(1)
  const [character, setCharacter] = useState(1)
  const [newName, setNewName] = useState('')
  useEffect(() => {
    ++epoch.current
    setTool('editor')
    setReview(undefined)
    setError(undefined)
    setBusy(false)
    return () => {
      ++epoch.current
    }
  }, [sessionId, current?.path])
  const request = (rename: boolean): void => {
    if (sessionId === null || current === undefined || props.languageReview === undefined) return
    const generation = ++epoch.current
    setBusy(true)
    setError(undefined)
    void props
      .languageReview(sessionId, current.path, current.text, line - 1, character - 1, rename ? newName : undefined)
      .then(
        (value) => {
          if (epoch.current === generation) setReview(value)
        },
        (reason: unknown) => {
          if (epoch.current === generation) setError(String(reason))
        },
      )
      .finally(() => {
        if (epoch.current === generation) setBusy(false)
      })
  }
  return (
    <section className={css.surface} aria-label={t('coding.workspace')}>
      <div className={css.toolHeader}>
        <div className={css.toolTabs} role="tablist" aria-label={t('coding.tools')}>
          {(['editor', 'changes', 'checks'] as const).map(value => <button key={value} type="button" role="tab"
            id={`coding-${sessionId}-${value}-tab`} aria-controls={`coding-${sessionId}-${value}`} aria-selected={tool === value}
            tabIndex={tool === value ? 0 : -1} onClick={() =>{  setTool(value) }}
            onKeyDown={(event) => {
              const tools = ['editor', 'changes', 'checks'] as const
              const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (direction !== 0 || event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tools.indexOf(value) + direction + 3) % 3
                const nextTool = tools[next]
                if (nextTool !== undefined) setTool(nextTool)
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
              }
            }}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden="true">
              <path d={value === 'editor' ? 'M7 5 2 10l5 5m6-10 5 5-5 5M11 3 9 17' : value === 'changes' ? 'M5 3v10a3 3 0 0 0 3 3h7M5 7h7a3 3 0 0 0 3-3' : 'm3 10 4 4 10-10'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>{t(`coding.${value === 'editor' ? 'editorTab' : value}`)}
          </button>)}
        </div>
        <button type="button" className={css.utilityButton} aria-expanded={props.filesVisible ?? false} onClick={props.toggleFiles}>{t('editor.files')}</button>
        <button type="button" className={css.utilityButton} disabled={sessionId === null} onClick={props.openTerminal}>{t('coding.terminal')}</button>
      </div>
      <div ref={motion} className={css.toolBody}>
        <div className={css.toolPanel} role="tabpanel" id={`coding-${sessionId}-checks`} aria-labelledby={`coding-${sessionId}-checks-tab`} hidden={tool !== 'checks'}>
          <header className={css.toolHeading}><span className={css.toolEyebrow}>{t('coding.checks')}</span><h2>{t('coding.language')}</h2><p>{t('coding.checksHint')}</p></header>
          <div className={css.checkFields}>        {error !== undefined && <p role="alert">{error}</p>}
            <label>
              {t('coding.line')}
              <input
                type="number"
                min="1"
                value={line}
                onChange={(event) => {
                  setLine(Number(event.target.value))
                }}
              />
            </label>
            <label>
              {t('coding.character')}
              <input
                type="number"
                min="1"
                value={character}
                onChange={(event) => {
                  setCharacter(Number(event.target.value))
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy || props.languageReview === undefined || current === undefined || current.text !== current.base.text}
              onClick={() => {
                request(false)
              }}
            >
              {t('coding.diagnostics')}
            </button>
            <input
              aria-label={t('coding.newName')}
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value)
              }}
            />
            <button
              type="button"
              disabled={busy || props.languageReview === undefined || newName.trim() === '' || current === undefined || current.text !== current.base.text}
              onClick={() => {
                request(true)
              }}
            >
              {t('coding.rename')}
            </button>
            {review !== undefined && (
              <>
                {review.base !== current?.text && <p>{t('coding.stale')}</p>}
                {review.diagnostics.map((item, index) => (
                  <p key={index}>
                    {item.range.start.line + 1}:{item.range.start.character + 1} {item.message}
                  </p>
                ))}
                {review.proposals.map((proposal, index) => (
                  <details key={index}>
                    <summary>{proposal.title}</summary>
                    {proposal.files.map(file => (
                      <article key={file.path}>
                        <strong>{file.path}</strong>
                        <pre>
                          <del>{file.before}</del>
                        </pre>
                        <pre>
                          <ins>{file.after}</ins>
                        </pre>
                        <button
                          type="button"
                          disabled={sessionId === null || current?.base.absolutePath !== file.path || current.text !== file.before}
                          onClick={() => {
                            if (sessionId !== null && current !== undefined && current.text === file.before)
                              void props.editDocument(sessionId, current.path, file.after)
                          }}
                        >
                          {t('coding.acceptDraft')}
                        </button>
                      </article>
                    ))}
                  </details>
                ))}
              </>
            )}
          </div>
        </div>
        <div className={css.toolPanel} role="tabpanel" id={`coding-${sessionId}-changes`} aria-labelledby={`coding-${sessionId}-changes-tab`} hidden={tool !== 'changes'}>
          <GitReviewPanel {...props} />
        </div>
        <div className={css.codePanel} role="tabpanel" id={`coding-${sessionId}-editor`} aria-labelledby={`coding-${sessionId}-editor-tab`} hidden={tool !== 'editor'}>
          <DocumentPanel
            {...props}
            openFiles={props.toggleFiles}
            {...props.openProject === undefined ? {} : { chooseProject: () => props.openProject?.('coding') }}
            {...current === undefined || sessionId === null ? {} : {
              previewDocument: () => { props.openPreview(sessionId, current.path) },
            }}
            diagnostics={review?.base === current?.text ? review?.diagnostics : undefined}
            hideFiles
            profile="coding"
            titleKey="coding.editor"
            sourceKey="coding.source"
          />
        </div>
      </div>
    </section>
  )
}
