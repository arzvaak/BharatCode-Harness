/** Coding owns repository navigation and editing controls within the shared frame. */
import { useEffect, useRef, useState } from 'react'
import type { LanguageReview } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { DocumentPanelProps } from './DocumentPanel.tsx'
import { GitReviewPanel } from './GitReviewPanel.tsx'
import { DocumentPanel } from './DocumentPanel.tsx'
import type { WorkspaceSurfaceActions } from './surfaces.ts'
import css from './surfaces.module.css'

export type CodingWorkspaceProps = DocumentPanelProps & WorkspaceSurfaceActions
/** @param props - Recoverable source buffers and project filesystem access. @returns Coding's explorer and editable files. */
export function CodingWorkspace(props: CodingWorkspaceProps) {
  const { sessionId, view, t } = props
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
      <div className={css.toolbar}>
        <button type="button" disabled={sessionId === null} onClick={props.openTerminal}>
          {t('coding.terminal')}
        </button>
        <button
          type="button"
          disabled={current === undefined || sessionId === null}
          onClick={() => {
            if (current !== undefined && sessionId !== null) props.openPreview(sessionId, current.path)
          }}
        >
          {t('coding.preview')}
        </button>
        <span className={css.muted}>{t('coding.recovery')}</span>
      </div>
      <details>
        <summary>{t('coding.language')}</summary>
        {error !== undefined && <p role="alert">{error}</p>}
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
          disabled={busy || current === undefined || current.text !== current.base.text}
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
          disabled={busy || newName.trim() === '' || current === undefined || current.text !== current.base.text}
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
      </details>
      <GitReviewPanel {...props} />
      <DocumentPanel
        {...props}
        diagnostics={review?.base === current?.text ? review?.diagnostics : undefined}
        hideFiles
        profile="coding"
        titleKey="coding.editor"
        sourceKey="coding.source"
      />
    </section>
  )
}
