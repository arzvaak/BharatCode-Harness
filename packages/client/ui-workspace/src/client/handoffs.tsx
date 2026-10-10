/** Shared handoff editor and composer context inspection, using shared modal controls. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useState, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { Button, MenuItemButton, Modal, useAnchoredPosition, IconCloseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsHooks, PropsLocale, PropsRuntime, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  CaptureSessionArtifactRequest,
  ArtifactSearchHit,
  SearchArtifactsResult,
  ArtifactRevisionId,
  ArtifactRevision,
  ArtifactInspection,
  WorkspaceId,
  ArtifactKind,
  PreparedHandoff,
  PrepareHandoffRequest,
  RegisterArtifactRequest,
  SearchArtifactsRequest,
  SubmitHandoffRequest,
  WorkflowProfile,
} from '@deepseek-ai/dsh-workspace/types'
import type { SessionMenuItemProps } from './contract/slots.ts'
import css from './handoffs.module.css'

/** UI request; changing layout never creates one. */
export interface HandoffTarget {
  readonly sessionId: SessionId
  readonly workflow: WorkflowProfile
  readonly sourceProjectId?: WorkspaceId
  readonly destinationProjectId?: WorkspaceId
  readonly destinationSessionId?: SessionId
  readonly evidence?: readonly ArtifactRevision[]
}
/** Host actions passed by the plugin registration owner. */
export interface HandoffActions {
  captureSession: (request: CaptureSessionArtifactRequest) => Promise<ArtifactRevision>
  registerArtifact: (request: RegisterArtifactRequest) => Promise<ArtifactRevision>
  searchArtifacts: (request: SearchArtifactsRequest) => Promise<SearchArtifactsResult>
  readArtifact: (id: ArtifactRevisionId) => Promise<ArtifactRevision>
  prepareHandoff: (request: PrepareHandoffRequest) => Promise<PreparedHandoff>
  submitHandoff: (request: SubmitHandoffRequest) => Promise<PreparedHandoff>
}
/** Row action share, independent of the agent's execution state. */
export interface HandoffMenuInjected {
  requestHandoff: (sessionId: SessionId, workflow: WorkflowProfile) => void
}
/** Global modal share. */
export interface HandoffDialogInjected extends HandoffActions {
  hooks: { handoffTarget: HostObservable<HandoffTarget | null> }
  closeHandoff: () => void
  openDestination: (sessionId: SessionId) => void
}
/** Composer inspection share. */
export interface UsingContextInjected extends HandoffMenuInjected {
  readContext: (sessionId: SessionId) => Promise<readonly PreparedHandoff[]>
  inspectArtifact: (id: ArtifactRevisionId) => Promise<ArtifactInspection>
  refreshContext: (sessionId: SessionId, handoff: PreparedHandoff, id: ArtifactRevisionId) => Promise<void>
}
/** Global modal props and framework-owned hooks. */
export type HandoffDialogProps = PropsRuntime<'shell.overlay'> &
  PropsLocale<'workspace'> &
  Omit<HandoffDialogInjected, 'hooks'> &
  PropsHooks<HandoffDialogInjected['hooks']>
/** Composer control props. */
export type UsingContextProps = PropsRuntime<'conversation.input.left'> &
  PropsLocale<'workspace'> &
  UsingContextInjected

/** @param props - Row identity and explicit handoff request. @returns The shared menu entry. */
export function HandoffMenuItem({
  sessionId,
  useMenuOpenState,
  requestHandoff,
  t,
}: SessionMenuItemProps<HandoffMenuInjected>) {
  const [, setOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      onSelect={() => {
        setOpen(false)
        requestHandoff(sessionId, 'coding')
      }}
    >
      {t('handoff.send')}
    </MenuItemButton>
  )
}
/** @param props - Global request and host actions. @returns Shared handoff modal or nothing. */
export function HandoffDialog(props: HandoffDialogProps) {
  const target = props.useHandoffTarget(value => value)
  if (target === null) return null
  return <HandoffForm key={`${target.sessionId}:${target.workflow}`} {...props} target={target} />
}
function HandoffForm({
  target,
  closeHandoff,
  openDestination,
  registerArtifact,
  captureSession,
  searchArtifacts,
  readArtifact,
  prepareHandoff,
  submitHandoff,
  useWorkspaces,
  t,
}: HandoffDialogProps & { target: HandoffTarget }) {
  const projects = useWorkspaces(value => value.items)
  const origin = projects.find(project =>
    target.sourceProjectId === undefined
      ? project.sessionIds.includes(target.sessionId)
      : project.workspaceId === target.sourceProjectId,
  )
  const [destination, setDestination] = useState(target.destinationProjectId ?? origin?.workspaceId)
  const [destinationSession, setDestinationSession] = useState<SessionId | undefined>(target.destinationSessionId)
  const [workflow, setWorkflow] = useState(target.workflow)
  const [objective, setObjective] = useState('')
  const [constraints, setConstraints] = useState('')
  const [questions, setQuestions] = useState('')
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<ArtifactKind>('finding')
  const [query, setQuery] = useState('')
  const [sourceSession, setSourceSession] = useState<SessionId | undefined>(
    origin?.sessionIds.includes(target.sessionId) ? target.sessionId : undefined,
  )
  const [evidence, setEvidence] = useState<readonly ArtifactRevision[]>(target.evidence ?? [])
  const [hits, setHits] = useState<readonly ArtifactSearchHit[]>([])
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [requestId] = useState(() => randomUUID())
  const [prepared, setPrepared] = useState<PreparedHandoff>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const act = (operation: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    void operation()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        setBusy(false)
      })
  }
  const add = (artifact: ArtifactRevision) => {
    setEvidence(previous => (previous.some(item => item.id === artifact.id) ? previous : [...previous, artifact]))
  }
  const prepare = () => {
    act(async () => {
      if (origin === undefined || destination === undefined) throw new Error(t('handoff.noProject'))
      const task = await prepareHandoff({
        requestId,
        sourceProjectId: origin.workspaceId,
        destinationProjectId: destination,
        ...(origin.sessionIds.includes(target.sessionId) ? { sourceSessionId: target.sessionId } : {}),
        ...(destinationSession === undefined ? {} : { destinationSessionId: destinationSession }),
        workflow,
        objective,
        revisionIds: evidence.map(item => item.id),
        constraints: constraints.split('\n').filter(line => line.trim()),
        questions: questions.split('\n').filter(line => line.trim()),
      })
      setPrepared(task)
    })
  }
  const submit = (mode: 'queue' | 'steer') => {
    act(async () => {
      if (prepared === undefined) return
      const result = await submitHandoff({ id: prepared.id, mode })
      closeHandoff()
      openDestination(result.destinationSessionId)
    })
  }
  const locked = busy || prepared !== undefined
  return (
    <Modal
      open
      title={t('handoff.send')}
      closeLabel={t('close')}
      onClose={() => {
        if (!busy) closeHandoff()
      }}
      footer={
        <>
          <Button variant="outline" disabled={busy} onClick={closeHandoff}>
            {t('cancel')}
          </Button>
          {prepared === undefined || destinationSession === undefined ? null : (
            <Button
              variant="outline"
              disabled={busy || !objective.trim()}
              onClick={() => {
                submit('steer')
              }}
            >
              {t('handoff.steer')}
            </Button>
          )}
          {prepared === undefined ? (
            <Button
              variant="primary"
              disabled={busy || !objective.trim() || destination === undefined}
              onClick={prepare}
            >
              {t('handoff.prepare')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                submit('queue')
              }}
            >
              {t('handoff.queue')}
            </Button>
          )}
        </>
      }
    >
      <div className={css.form}>
        <p className={css.hint}>{t('handoff.explanation')}</p>
        <label>
          {t('handoff.project')}
          <select
            disabled={locked}
            value={destination ?? ''}
            onChange={(event) => {
              setDestination(projects.find(project => project.workspaceId === event.target.value)?.workspaceId)
              setDestinationSession(undefined)
            }}
          >
            {projects.map(project => (
              <option key={project.workspaceId} value={project.workspaceId}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
        <div className={css.row}>
          <label>
            {t('handoff.workflow')}
            <select
              disabled={locked}
              value={workflow}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'coding' || value === 'research' || value === 'writing') setWorkflow(value)
              }}
            >
              {(['coding', 'research', 'writing'] as const).map(value => (
                <option key={value} value={value}>
                  {t(`handoff.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('handoff.session')}
            <select
              disabled={locked}
              value={destinationSession ?? ''}
              onChange={(event) => {
                setDestinationSession(
                  projects
                    .find(project => project.workspaceId === destination)
                    ?.sessionIds.find(id => id === event.target.value),
                )
              }}
            >
              <option value="">{t('handoff.newSession')}</option>
              {projects
                .find(project => project.workspaceId === destination)
                ?.sessionIds.map(id => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label>
          {t('handoff.objective')}
          <textarea
            disabled={locked}
            value={objective}
            onChange={(event) => {
              setObjective(event.target.value)
            }}
            rows={3}
          />
        </label>
        <details>
          <summary>{t('handoff.evidence')}</summary>
          <div className={css.row}>
            <label>
              {t('handoff.sourcePath')}
              <input
                disabled={locked}
                value={path}
                onChange={(event) => {
                  setPath(event.target.value)
                }}
              />
            </label>
            <label>
              {t('handoff.classification')}
              <select
                disabled={locked}
                value={kind}
                onChange={(event) => {
                  const value = event.target.value
                  if (
                    value === 'source' ||
                    value === 'note' ||
                    value === 'hypothesis' ||
                    value === 'finding' ||
                    value === 'decision' ||
                    value === 'requirement' ||
                    value === 'manuscript'
                  )
                    setKind(value)
                }}
              >
                {(['source', 'note', 'hypothesis', 'finding', 'decision', 'requirement', 'manuscript'] as const).map(
                  value => (
                    <option key={value} value={value}>
                      {t(`handoff.kind.${value}`)}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
          <div className={css.row}>
            <label>
              {t('handoff.sourceSession')}
              <select
                disabled={locked}
                value={sourceSession ?? ''}
                onChange={(event) => {
                  setSourceSession(origin?.sessionIds.find(id => id === event.target.value))
                }}
              >
                <option value="">{t('handoff.chooseSourceSession')}</option>
                {origin?.sessionIds.map(id => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={locked || sourceSession === undefined}
              onClick={() => {
                act(async () => {
                  if (origin !== undefined && sourceSession !== undefined)
                    add(
                      await captureSession({
                        projectId: origin.workspaceId,
                        sessionId: sourceSession,
                        title: t('handoff.sessionEvidence'),
                      }),
                    )
                })
              }}
            >
              {t('handoff.captureSession')}
            </Button>
          </div>
          <Button
            variant="outline"
            disabled={locked || !path.trim() || origin === undefined}
            onClick={() => {
              act(async () => {
                if (origin !== undefined) add(await registerArtifact({ projectId: origin.workspaceId, path, kind }))
              })
            }}
          >
            {t('handoff.register')}
          </Button>
          <label>
            {t('handoff.search')}
            <input
              disabled={locked}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
            />
          </label>
          <Button
            variant="outline"
            disabled={locked || !query.trim() || origin === undefined}
            onClick={() => {
              act(async () => {
                if (origin !== undefined) {
                  const result = await searchArtifacts({ projectId: origin.workspaceId, query })
                  setHits(result.hits)
                  setSearchHasMore(result.hasMore)
                }
              })
            }}
          >
            {t('handoff.search')}
          </Button>
          {searchHasMore ? <p role="status">{t('handoff.searchMore')}</p> : null}
          {hits.map(item => (
            <button
              disabled={locked}
              key={item.id}
              onClick={() => {
                act(async () => {
                  add(await readArtifact(item.id))
                })
              }}
            >
              {item.title}
            </button>
          ))}
        </details>
        <ul className={css.sources}>
          {evidence.map(item => (
            <li key={item.id}>
              <span>
                {item.title}
                <small>
                  {t(`handoff.kind.${item.kind}`)} · {item.revision.slice(0, 12)}
                </small>
              </span>
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => {
                  setEvidence(previous => previous.filter(source => source.id !== item.id))
                }}
              >
                {t('handoff.remove')}
              </Button>
            </li>
          ))}
        </ul>
        <div className={css.row}>
          <label>
            {t('handoff.constraints')}
            <textarea
              disabled={locked}
              value={constraints}
              onChange={(event) => {
                setConstraints(event.target.value)
              }}
              rows={3}
            />
          </label>
          <label>
            {t('handoff.questions')}
            <textarea
              disabled={locked}
              value={questions}
              onChange={(event) => {
                setQuestions(event.target.value)
              }}
              rows={3}
            />
          </label>
        </div>
        {prepared?.context.omitted.length ? (
          <p role="status">{t('handoff.omitted', { n: prepared.context.omitted.length })}</p>
        ) : null}
        {error === undefined ? null : <p role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
/** @param props - Session identity and host inspection. @returns Context disclosure beside the composer. */
export function UsingContext({
  sessionId,
  readContext,
  inspectArtifact,
  refreshContext,
  useSession,
  t,
}: UsingContextProps) {
  const watermark = useSession(value => value.running)
  const [context, setContext] = useState<readonly PreparedHandoff[]>([])
  const [error, setError] = useState<string>()
  const [statuses, setStatuses] = useState<Readonly<Record<string, ArtifactInspection['status']>>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialogId = useId()
  const position = useAnchoredPosition({ open, anchorRef: trigger, panelRef: panel, side: 'top', gap: 10, margin: 16 })
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const positioned = position !== null
  useEffect(() => {
    if (open && positioned) closeButton.current?.focus()
  }, [open, positioned])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  useEffect(() => {
    let current = true
    void readContext(sessionId)
      .then(async (value) => {
        const inspections = await Promise.all(
          value.flatMap(item => item.context.evidence).map(source => inspectArtifact(source.id)),
        )
        if (current) setStatuses(Object.fromEntries(inspections.map(item => [item.artifact.id, item.status])))
        if (current) {
          setContext(value)
          setError(undefined)
        }
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      current = false
    }
  }, [sessionId, readContext, inspectArtifact, watermark, retry])
  return (
    <div className={css.context} ref={container}>
      <button
        ref={trigger}
        type="button"
        className={css.contextTrigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? dialogId : undefined}
        onClick={() => {
          setOpen(!open)
        }}
      >
        {t('handoff.usingContext', { n: context.reduce((count, item) => count + item.context.evidence.length, 0) })}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={dialogId}
            style={position ?? { visibility: 'hidden' }}
            className={css.contextBody}
            role="dialog"
            aria-label={t('handoff.contextTitle')}
          >
            <div className={css.contextHeader}>
              <strong>{t('handoff.contextTitle')}</strong>
              <button ref={closeButton} type="button" aria-label={t('handoff.closeContext')} onClick={close}>
                <IconCloseOutlineRegular size={16} />
              </button>
            </div>
            {context.length === 0 ? (
              <p className={css.emptyContext}>{t('handoff.emptyContext')}</p>
            ) : (
              context.map(item => (
                <div key={item.id}>
                  <strong>{item.objective}</strong>
                  <small>{item.sourceSessionId ?? item.sourceProjectId}</small>
                  {item.context.evidence.map(source => (
                    <p key={source.id}>
                      {source.title}
                      <small>
                        {source.revision.slice(0, 12)}
                        {statuses[source.id] === undefined
                          ? null
                          : ` · ${t(`handoff.status.${statuses[source.id] ?? 'current'}`)}`}
                      </small>
                      {statuses[source.id] === 'stale' ? (
                        <Button
                          variant="outline"
                          disabled={refreshing}
                          onClick={() => {
                            setRefreshing(true)
                            void refreshContext(sessionId, item, source.id)
                              .catch((reason: unknown) => {
                                setError(reason instanceof Error ? reason.message : String(reason))
                              })
                              .finally(() => {
                                setRefreshing(false)
                              })
                          }}
                        >
                          {t('handoff.refreshContext')}
                        </Button>
                      ) : null}
                    </p>
                  ))}
                  {item.context.omitted.length ? (
                    <p>{t('handoff.omitted', { n: item.context.omitted.length })}</p>
                  ) : null}
                </div>
              ))
            )}
            {error === undefined ? null : (
              <div role="alert">
                <p>{t('handoff.contextUnavailable')}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRetry(value => value + 1)
                  }}
                >
                  {t('handoff.retryContext')}
                </Button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
