/** Shared complete-source editor; unsupported manuscript syntax remains untouched. */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DocumentEvidence, LanguageDiagnostic } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceKey } from '../locales.ts'
import type { EditorSession } from './documents.ts'
import { useWorkflowMotion } from './motion.ts'
import css from './documents.module.css'
import { acceptEdit, proposeEdit, documentOutline, type EditProposal, type SelectedText } from './editor-review.ts'
const CodeEditor = lazy(() => import('./CodeEditor.tsx').then(value => ({ default: value.CodeEditor })))
const ProseEditor = lazy(() => import('./ProseEditor.tsx').then(value => ({ default: value.ProseEditor })))

/** Plain workspace editor callbacks supplied by the owning plugin. */
export interface DocumentPanelActions {
  documentEvidence?(this: void, session: SessionId, path: string): Promise<DocumentEvidence>
  commentSelection?(session: SessionId, path: string, text: string, start: number, end: number, comment: string): Promise<unknown>
  requestSelectionEdit?(session: SessionId, path: string, selected: string, instruction: string): Promise<void>
  openDocument(session: SessionId, path: string): Promise<void>
  closeDocument(session: SessionId, path: string): Promise<void>
  selectDocument(session: SessionId, path: string): void
  editDocument(session: SessionId, path: string, text: string): Promise<void>
  saveDocument(session: SessionId, path: string): Promise<void>
  rebaseDocument(session: SessionId, path: string): Promise<void>
}
/** Source editor state and callbacks, with workspace-owned localized copy. */
export type DocumentPanelProps = PropsLocale<'workspace'> &
  DocumentPanelActions & {
    diagnostics?: readonly LanguageDiagnostic[] | undefined
    hideFiles?: boolean
    titleKey?: WorkspaceKey
    sourceKey?: WorkspaceKey
    collapseEditor: () => void
    sessionId: SessionId | null
    view: EditorSession | undefined
    profile: 'chat' | 'coding' | 'writing' | 'research'
  }

/** Render exact source, explicit saves, and conflicting disk text.
 * @param props - Session editor state, localized copy, and callbacks.
 * @returns The complete-source editor pane.
 */
export function DocumentPanel({
  sessionId,
  view,
  profile,
  t,
  collapseEditor,
  titleKey = 'editor.title',
  sourceKey = 'editor.source',
  hideFiles = false,
  diagnostics,
  ...actions
}: DocumentPanelProps) {
  const generation = useRef(0)
  const [comment, setComment] = useState('')
  const [evidence, setEvidence] = useState<DocumentEvidence>()
  const [evidenceReload, setEvidenceReload] = useState(0)
  const [path, setPath] = useState('')
  const [mode, setMode] = useState<'source' | 'formatted'>('formatted')
  const [selection, setSelection] = useState<SelectedText>()
  const [replacement, setReplacement] = useState('')
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState<EditProposal>()
  const [richUnavailable, setRichUnavailable] = useState(false)
  const [reviewError, setReviewError] = useState<string>()
  const [filesOpen, setFilesOpen] = useState<boolean | undefined>(undefined)
  const [opening, setOpening] = useState(false)
  const document = view?.active === undefined ? undefined : view.documents[view.active]
  useLayoutEffect(() => {
    ++generation.current
    setComment('')
    setSelection(undefined)
    setProposal(undefined)
    setReplacement('')
    setReviewError(undefined)
    setRichUnavailable(false)
    return () => {
      ++generation.current
    }
  }, [sessionId, document?.path])
  useLayoutEffect(() => {
    let active = true
    setEvidence(undefined)
    if (sessionId !== null && document !== undefined)
      void actions.documentEvidence?.(sessionId, document.path).then(
        (value) => {
          if (active) setEvidence(value)
        },
        (reason: unknown) => {
          if (active) setReviewError(String(reason))
        },
      )
    return () => {
      active = false
    }
  }, [sessionId, document?.path, evidenceReload, actions.documentEvidence])
  const motion = useWorkflowMotion<HTMLElement>(`${sessionId ?? ''}/${document?.path ?? ''}`, `${selection?.start ?? ''}/${selection?.end ?? ''}/${proposal !== undefined}`)
  const richSupported =
    document !== undefined && /\.(md|markdown)$/.test(document.path) && !/```|~~~|<[^>]+>|^\|/m.test(document.text)
  const select = (value: SelectedText): void => {
    setSelection(value)
    setProposal(undefined)
  }
  const change = (text: string): void => {
    if (sessionId !== null && document !== undefined) void actions.editDocument(sessionId, document.path, text)
  }
  const save = (): void => {
    if (sessionId !== null && document !== undefined && document.conflict === undefined && !document.busy)
      void actions.saveDocument(sessionId, document.path)
  }
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (hideFiles && document !== undefined) sourceRef.current?.focus()
  }, [hideFiles, document?.path])
  const open = async (): Promise<void> => {
    if (sessionId === null || path.trim() === '' || opening) return
    setOpening(true)
    try {
      await actions.openDocument(sessionId, path.trim())
    } finally {
      setOpening(false)
    }
  }
  return (
    <section ref={motion} className={css.panel} aria-label={t(titleKey)} data-profile={profile}>
      <div className={css.heading}>
        <strong title={document?.path}>{hideFiles ? t(titleKey) : (document?.path.split(/[\\/]/).at(-1) ?? t(titleKey))}</strong>
        <button type="button" onClick={collapseEditor} aria-label={t('editor.collapse')} title={t('editor.collapse')}>
          ›
        </button>
      </div>
      {!hideFiles && (
        <details className={css.files} open={filesOpen ?? document === undefined}>
          <summary
            onClick={(event) => {
              event.preventDefault()
              setFilesOpen(!(filesOpen ?? document === undefined))
            }}
          >
            <span>
              {t('editor.files')} ({Object.keys(view?.documents ?? {}).length})
            </span>
            <span className={css.filename} title={document?.path}>
              {document?.path.split(/[\\/]/).at(-1)}
            </span>
          </summary>
          <form
            className={css.toolbar}
            onSubmit={(event) => {
              event.preventDefault()
              void open()
            }}
          >
            <input
              aria-label={t('editor.path')}
              value={path}
              onChange={(event) => {
                setPath(event.target.value)
              }}
              placeholder={t('editor.path')}
              disabled={sessionId === null}
            />
            <button type="submit" disabled={opening || sessionId === null || path.trim() === ''}>
              {t(opening ? 'editor.opening' : 'editor.open')}
            </button>
          </form>
          <div className={css.tabs} role="tablist" aria-label={t('editor.tabs')}>
            {Object.keys(view?.documents ?? {}).map(file => (
              <div className={css.file} key={file}>
                <button
                  type="button"
                  role="tab"
                  title={file}
                  aria-selected={file === view?.active}
                  onClick={() => {
                    if (sessionId !== null) actions.selectDocument(sessionId, file)
                  }}
                >
                  {file.split(/[\\/]/).at(-1) ?? file}
                  {view?.documents[file]?.text !== view?.documents[file]?.base.text ? ' •' : ''}
                </button>
                <button
                  type="button"
                  aria-label={`${t('editor.close')}: ${file.split(/[\\/]/).at(-1) ?? file}`}
                  title={t('editor.close')}
                  onClick={() => {
                    if (sessionId !== null) void actions.closeDocument(sessionId, file)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
      {view?.error !== undefined && (
        <p role="alert" className={css.error}>
          {view.error}
        </p>
      )}
      {document === undefined ? (
        <div className={css.empty}>{t(sessionId === null ? 'editor.noSession' : 'editor.empty')}</div>
      ) : (
        <>
          <div className={css.status}>
            <span>
              {t(document.busy ? 'editor.saving' : document.text !== document.base.text ? 'editor.unsaved' : 'editor.saved')}
            </span>
            <button
              type="button"
              disabled={document.busy || document.conflict !== undefined || sessionId === null}
              onClick={() => {
                if (sessionId !== null) void actions.saveDocument(sessionId, document.path)
              }}
            >
              {t('editor.save')}
            </button>
          </div>
          {document.error !== undefined && (
            <p role="alert" className={css.error}>
              {document.error}
            </p>
          )}
          {document.conflict !== undefined && (
            <div className={css.conflict}>
              <p role="alert">{t('editor.conflict')}</p>
              <details>
                <summary>{t('editor.compare')}</summary>
                <pre>{document.conflict.text}</pre>
              </details>
              <button
                type="button"
                disabled={document.busy}
                onClick={() => {
                  if (sessionId !== null) void actions.rebaseDocument(sessionId, document.path)
                }}
              >
                {t('editor.rebase')}
              </button>
            </div>
          )}
          <div className={css.toolbar}>
            <button
              type="button"
              aria-pressed={mode === 'source'}
              onClick={() => {
                setMode(mode === 'source' ? 'formatted' : 'source')
              }}
            >
              {t(mode === 'source' ? 'editor.formatted' : 'editor.sourceMode')}
            </button>
            <details>
              <summary>{t('editor.outline')}</summary>
              {documentOutline(document.text).map(item => (
                <button
                  key={item.offset}
                  type="button"
                  onClick={() => {
                    setMode('source')
                    requestAnimationFrame(() => {
                      sourceRef.current?.focus()
                      sourceRef.current?.setSelectionRange(item.offset, item.offset + item.title.length + item.level + 1)
                    })
                  }}
                >
                  {item.title}
                </button>
              ))}
            </details>
            <details>
              <summary>{t('editor.revisions')}</summary>
              <pre>{document.base.text}</pre>
              <pre>{document.text}</pre>
            </details>
          </div>
          {reviewError !== undefined && <p role="alert">{reviewError}</p>}
          {selection !== undefined && (
            <details className={css.review} data-workflow-motion={`selection/${selection.start}/${selection.end}`} open>
              <summary>{t('editor.reviewSelection')}</summary>
              <blockquote>{selection.text}</blockquote>
              {actions.commentSelection !== undefined && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const epoch = generation.current
                    if (sessionId !== null)
                      void actions
                        .commentSelection?.(sessionId, document.path, document.text, selection.start, selection.end, comment)
                        .then(
                          () => {
                            if (generation.current === epoch) {
                              setComment('')
                              setEvidenceReload(value => value + 1)
                            }
                          },
                          (reason: unknown) => {
                            if (generation.current === epoch) setReviewError(String(reason))
                          },
                        )
                  }}
                >
                  <label>
                    {t('editor.comment')}
                    <textarea
                      value={comment}
                      onChange={(event) => {
                        setComment(event.target.value)
                      }}
                    />
                  </label>
                  <button disabled={comment.trim() === '' || document.text !== document.base.text}>
                    {t('editor.addComment')}
                  </button>
                </form>
              )}
              {actions.requestSelectionEdit !== undefined && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (sessionId !== null)
                      void actions
                        .requestSelectionEdit?.(sessionId, document.path, selection.text, instruction)
                        .catch((reason: unknown) => {
                          setReviewError(reason instanceof Error ? reason.message : String(reason))
                        })
                  }}
                >
                  <input
                    value={instruction}
                    aria-label={t('editor.instruction')}
                    onChange={(event) => {
                      setInstruction(event.target.value)
                    }}
                  />
                  <button disabled={instruction.trim() === ''}>{t('editor.requestEdit')}</button>
                </form>
              )}
              <textarea
                aria-label={t('editor.replacement')}
                value={replacement}
                onChange={(event) => {
                  setReplacement(event.target.value)
                  setProposal(undefined)
                }}
              />
              <button
                type="button"
                onClick={() => {
                  try {
                    setProposal(proposeEdit(document.text, selection, replacement))
                    setReviewError(undefined)
                  } catch (reason) {
                    setReviewError(reason instanceof Error ? reason.message : String(reason))
                  }
                }}
              >
                {t('editor.review')}
              </button>
              {proposal !== undefined && (
                <>
                  <del>{proposal.selection.text}</del>
                  <ins>{proposal.replacement}</ins>
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        change(acceptEdit(document.text, proposal))
                        setProposal(undefined)
                        setSelection(undefined)
                      } catch (reason) {
                        setReviewError(reason instanceof Error ? reason.message : String(reason))
                      }
                    }}
                  >
                    {t('editor.accept')}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelection(undefined)
                  setProposal(undefined)
                }}
              >
                {t('editor.dismiss')}
              </button>
            </details>
          )}
          {evidence !== undefined && (evidence.comments.length > 0 || evidence.sources.length > 0) && (
            <details className={css.review} data-workflow-motion="proposal" open>
              <summary>{t('editor.evidence')}</summary>
              {evidence.artifact?.text !== document.text && <p>{t('editor.evidenceStale')}</p>}
              {evidence.comments.map(
                record =>
                  record.payload.kind === 'comment' && (
                    <article key={record.id}>
                      <blockquote>{record.payload.quote}</blockquote>
                      <p>{record.payload.comment}</p>
                    </article>
                  ),
              )}
              {evidence.sources.map(value => (
                <article key={value.relation.id}>
                  <strong>{value.artifact.title}</strong>
                  <span>{value.relation.relation}</span>
                  <span>{t(`handoff.status.${value.status}`)}</span>
                  <blockquote>{value.relation.passage?.quote}</blockquote>
                  <details>
                    <summary>{t('editor.exactSource')}</summary>
                    <pre>
                      {value.relation.to === value.artifact.id && value.relation.passage !== undefined ? (
                        <>
                          {value.artifact.text.slice(0, value.relation.passage.start)}
                          <mark>{value.relation.passage.quote}</mark>
                          {value.artifact.text.slice(value.relation.passage.end)}
                        </>
                      ) : (
                        value.artifact.text
                      )}
                    </pre>
                  </details>
                </article>
              ))}
            </details>
          )}
          <Suspense fallback={<p>{t('surface.loading')}</p>}>
            {mode === 'formatted' && profile === 'coding' ? (
              <CodeEditor
                key={`${sessionId}/${document.path}`}
                text={document.text}
                path={document.path}
                label={t(sourceKey)}
                diagnostics={diagnostics}
                onChange={change}
                onSave={save}
                onSelection={select}
              />
            ) : mode === 'formatted' && richSupported && !richUnavailable ? (
              <ProseEditor
                key={`${sessionId}/${document.path}`}
                text={document.text}
                label={t(sourceKey)}
                onChange={change}
                t={t}
                onUnsupported={() => {
                  setRichUnavailable(true)
                }}
                onSelection={() => {
                  setSelection(undefined)
                  setProposal(undefined)
                  setMode('source')
                  setReviewError(t('editor.selectSource'))
                }}
              />
            ) : (
              <textarea
                ref={sourceRef}
                className={css.source}
                aria-label={t(sourceKey)}
                spellCheck={profile !== 'coding'}
                value={document.text}
                onSelect={(event) => {
                  const element = event.currentTarget
                  if (element.selectionEnd > element.selectionStart)
                    select({
                      start: element.selectionStart,
                      end: element.selectionEnd,
                      text: element.value.slice(element.selectionStart, element.selectionEnd),
                    })
                }}
                onChange={(event) => {
                  if (sessionId !== null) void actions.editDocument(sessionId, document.path, event.target.value)
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                    event.preventDefault()
                    event.stopPropagation()
                    save()
                  }
                }}
              />
            )}
          </Suspense>
        </>
      )}
    </section>
  )
}
