/** Native file-backed research library, reader and evidence-aware editor. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ArtifactRevision,
  ArtifactSearchHit,
  ResearchInspection,
  ResearchLink,
  ResearchList,
  ResearchResolution,
} from '@deepseek-ai/dsh-workspace/types'
import {
  parseResearchMarkdown,
  prepareResearchCitation,
  researchRelativeLink,
  resolveResearchLink,
} from '@deepseek-ai/dsh-workspace/research-markdown'
import type { ResearchWorkspaceProps } from './ResearchWorkspace.tsx'
import { ResearchReader } from './ResearchReader.tsx'
import { DocumentPanel } from './DocumentPanel.tsx'
import css from './research-knowledge.module.css'

const reasonText = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))
/** One knowledge view retains the existing document owner, session and project. */
export function ResearchKnowledgePanel(props: ResearchWorkspaceProps & { home?: boolean }) {
  const { project, sessionId, view, t, home = false } = props
  const projectId = project?.workspaceId
  const current = view?.active === undefined ? undefined : view.documents[view.active]
  const [library, setLibrary] = useState<ResearchList>({ notes: [], total: 0, issues: [] })
  const [inspection, setInspection] = useState<ResearchInspection>()
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [heading, setHeading] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [path, setPath] = useState('')
  const [linkTarget, setLinkTarget] = useState('')
  const [ambiguous, setAmbiguous] = useState<string[]>([])
  const [sources, setSources] = useState<readonly ArtifactSearchHit[]>([])
  const [sourceId, setSourceId] = useState('')
  const [source, setSource] = useState<ArtifactRevision>()
  const [sourceStatus, setSourceStatus] = useState<'current' | 'stale' | 'missing' | 'captured'>()
  const [quote, setQuote] = useState('')
  const [images, setImages] = useState<Record<string, string>>({})
  const history = useRef<string[]>([])
  const generation = useRef(0)
  const listing = useRef(0)
  useLayoutEffect(() => {
    ++generation.current
    ++listing.current
    setLibrary({ notes: [], total: 0, issues: [] })
    setInspection(undefined)
    setSources([])
    setSource(undefined)
    setError(undefined)
    setNotice(undefined)
    setCreating(false)
    setAmbiguous([])
    setBusy(false)
    setQuery('')
    setSourceId('')
    setQuote('')
    setImages({})
    history.current = []
    return () => {
      ++generation.current
      ++listing.current
    }
  }, [projectId, sessionId])
  useEffect(() => {
    if (sessionId === null || props.watchResearchFiles === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const lifecycle = { stopped: false }
    const invalidate = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (lifecycle.stopped) return
        if (current !== undefined) void props.refreshDocument?.(sessionId, current.path)
        setRevision(value => value + 1)
      }, 180)
    }
    const unavailable = (): void => {
      if (!lifecycle.stopped) setNotice(t('knowledge.watchUnavailable'))
    }
    const root = props.watchResearchFiles(sessionId, '.', invalidate, unavailable)
    const document =
      current === undefined ? undefined : props.watchResearchFiles(sessionId, current.path, invalidate, unavailable)
    const focused = (): void => { invalidate() }
    window.addEventListener('focus', focused)
    return () => {
      lifecycle.stopped = true
      clearTimeout(timer)
      root()
      document?.()
      window.removeEventListener('focus', focused)
    }
  }, [sessionId, projectId, current?.path, props.watchResearchFiles, props.refreshDocument, t])
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    const epoch = generation.current
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await operation()
    } catch (reason) {
      if (epoch === generation.current) setError(reasonText(reason))
    } finally {
      if (epoch === generation.current) setBusy(false)
    }
  }
  useEffect(() => {
    const request = ++listing.current
    const lifecycle = { stopped: false }
    const list = props.researchList
    if (projectId === undefined || list === undefined) {
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(
      () => {
        void list(projectId, query)
          .then(
            (value) => {
              if (!lifecycle.stopped && request === listing.current) setLibrary(value)
            },
            (reason: unknown) => {
              if (!lifecycle.stopped && request === listing.current) setError(reasonText(reason))
            },
          )
          .finally(() => {
            if (!lifecycle.stopped && request === listing.current) setLoading(false)
          })
      },
      query ? 150 : 0,
    )
    return () => {
      lifecycle.stopped = true
      clearTimeout(timer)
    }
  }, [projectId, query, revision, props.researchList])
  useEffect(() => {
    const lifecycle = { stopped: false }
    setInspection(undefined)
    if (
      projectId !== undefined &&
      current !== undefined &&
      /\.(md|markdown)$/i.test(current.path) &&
      props.researchInspect !== undefined
    ) {
      void props.researchInspect(projectId, current.path).then(
        (value) => {
          if (!lifecycle.stopped) setInspection(value)
        },
        (reason: unknown) => {
          if (!lifecycle.stopped) setError(reasonText(reason))
        },
      )
    }
    return () => {
      lifecycle.stopped = true
    }
  }, [projectId, current?.path, current?.base.version, revision, props.researchInspect])
  useEffect(() => {
    const lifecycle = { stopped: false }
    if (!home && projectId !== undefined)
      void props.searchArtifacts({ projectId, query: '', kinds: ['source'] }).then(
        (value) => {
          if (!lifecycle.stopped) {
            setSources(value.hits)
            if (value.hasMore) setNotice(t('knowledge.moreSources'))
            if (value.captureIssues?.length) setNotice(value.captureIssues.join('\n'))
          }
        },
        (reason: unknown) => {
          if (!lifecycle.stopped) setError(reasonText(reason))
        },
      )
    return () => {
      lifecycle.stopped = true
    }
  }, [projectId, home, revision, props.searchArtifacts, t])
  useEffect(() => {
    const lifecycle = { stopped: false }
    setSource(undefined)
    setSourceStatus(undefined)
    setQuote('')
    if (sourceId)
      void Promise.all([props.readArtifact(sourceId as ArtifactRevision['id']), props.inspectArtifact(sourceId as ArtifactRevision['id'])]).then(
        ([value, inspected]) => {
          if (!lifecycle.stopped && value.projectId === projectId) { setSource(value); setSourceStatus(inspected.status) }
        },
        (reason: unknown) => {
          if (!lifecycle.stopped) setError(reasonText(reason))
        },
      )
    return () => {
      lifecycle.stopped = true
    }
  }, [sourceId, projectId, props.readArtifact, props.inspectArtifact])
  const parsed = useMemo(() => parseResearchMarkdown(current?.text ?? ''), [current?.text])
  useEffect(() => {
    const lifecycle = { stopped: false }
    setImages({})
    const active = (): boolean => !lifecycle.stopped
    const resource = props.researchResource
    if (projectId === undefined || current === undefined || resource === undefined) return
    const wanted = parsed.links
      .filter(link => link.embed && /\.(png|jpe?g|gif|webp)$/i.test(link.target))
      .slice(0, 24)
    const loaded: Record<string, string> = {}
    let loadedBytes = 0
    void (async () => {
      for (const link of wanted) {
        if (!active()) break
        try {
          const resolution =
            props.researchResolve === undefined
              ? resolveResearchLink(library.notes, current.path, link)
              : await props.researchResolve(projectId, current.path, link.target, link.wiki)
          if (resolution.status !== 'resolved' && resolution.status !== 'missing') continue
          const result = await resource(projectId, resolution.path)
          loadedBytes += Math.floor(result.base64.length * 0.75)
          if (loadedBytes > 16 * 1024 * 1024) {
            if (active()) setNotice(t('knowledge.figureFailed'))
            break
          }
          const key = link.wiki ? `research-wiki/${encodeURIComponent(link.target)}` : link.target
          loaded[key] = `data:${result.mime};base64,${result.base64}`
        } catch {
          if (active()) setNotice(t('knowledge.figureFailed'))
        }
      }
      if (active()) setImages(loaded)
    })()
    return () => {
      lifecycle.stopped = true
    }
  }, [
    projectId,
    current?.path,
    current?.base.version,
    parsed,
    props.researchResource,
    props.researchResolve,
    revision,
    t,
  ])
  const open = async (selected: string): Promise<void> => {
    if (sessionId === null) return
    const epoch = generation.current
    if (current !== undefined && current.path !== selected) history.current.push(current.path)
    await props.openDocument(sessionId, selected)
    await props.refreshDocument?.(sessionId, selected)
    if (epoch !== generation.current) return
    setHeading(undefined)
    setMode('read')
    setAmbiguous([])
    if (home) props.changePreference({ section: 'notes' })
  }
  const follow = async (link: Pick<ResearchLink, 'target' | 'wiki'>): Promise<void> => {
    if (current === undefined || projectId === undefined) return
    const epoch = generation.current
    const result: ResearchResolution =
      props.researchResolve === undefined
        ? resolveResearchLink(library.notes, current.path, link)
        : await props.researchResolve(projectId, current.path, link.target, link.wiki)
    if (epoch !== generation.current) return
    if (result.status === 'resolved') {
      await open(result.path)
      setHeading(result.heading)
      if (result.heading) setNotice(`${t('knowledge.heading')}: ${result.heading}`)
    } else if (result.status === 'ambiguous') {
      setAmbiguous(result.candidates)
      setNotice(t('knowledge.ambiguous'))
    } else if (result.status === 'missing') {
      const captured = /(?:^|\/)sources\/captured\/([\w-]+)\.md$/.exec(result.path)
      if (captured !== null) {
        const value = await props.readArtifact(captured[1] as ArtifactRevision['id'])
        if (epoch !== generation.current) return
        if (value.projectId !== projectId) throw new Error(t('knowledge.invalid'))
        setSourceId(value.id)
        setSource(value)
        setNotice(t('knowledge.capturedSource'))
      } else if (!/\.(md|markdown)$/i.test(result.path) && sessionId !== null) props.openPreview(sessionId, result.path)
      else {
        setPath(/\.(md|markdown)$/i.test(result.path) ? result.path : result.path + '.md')
        setTitle(
          link.target
            .split('#')[0]
            ?.split('/')
            .at(-1)
            ?.replace(/\.(md|markdown)$/i, '') ?? '',
        )
        setCreating(true)
        setNotice(t('knowledge.missing'))
      }
    } else if (result.status === 'external') window.open(result.url, '_blank', 'noopener,noreferrer')
    else setNotice(t('knowledge.invalid'))
  }
  const create = async (): Promise<void> => {
    if (projectId === undefined || props.researchCreate === undefined) return
    const epoch = generation.current
    const result = await props.researchCreate(projectId, path, title)
    if (epoch !== generation.current) return
    setCreating(false)
    setRevision(value => value + 1)
    await open(result.path)
    if (result.issues.length) setNotice(result.issues.join('\n'))
  }
  const save = async (): Promise<void> => {
    if (
      current === undefined ||
      sessionId === null ||
      projectId === undefined ||
      props.researchCaptureCitations === undefined
    )
      return
    const epoch = generation.current
    await props.saveDocument(sessionId, current.path)
    if (epoch !== generation.current) return
    const result = await props.researchCaptureCitations(projectId, current.path, current.text)
    if (epoch !== generation.current) return
    setNotice(result.issues.length ? result.issues.join('\n') : t('knowledge.saved'))
    setRevision(value => value + 1)
  }
  const insert = async (): Promise<void> => {
    if (source === undefined || current === undefined || sessionId === null) return
    const start = source.text.indexOf(quote)
    if (!quote || start < 0) throw new Error(t('knowledge.quoteMismatch'))
    if (start !== source.text.lastIndexOf(quote)) throw new Error(t('knowledge.quoteAmbiguous'))
    const text = prepareResearchCitation(current.text, {
      id: source.id,
      title: source.title,
      url: researchRelativeLink(current.path, `sources/captured/${source.id}.md`),
      quote,
      start,
      end: start + quote.length,
    })
    await props.editDocument(sessionId, current.path, text)
  }
  const download = async (): Promise<void> => {
    if (projectId === undefined || props.researchExport === undefined) return
    const epoch = generation.current
    const result = await props.researchExport(projectId)
    if (epoch !== generation.current) return
    const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
    const link = document.createElement('a')
    link.href = url
    link.download = result.filename
    link.click()
    setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
    setNotice([t('knowledge.exportHint'), ...result.issues].join('\n'))
  }
  if (project === undefined) return <p className={css.empty}>{t('research.noProject')}</p>
  if (props.researchList === undefined) return <p className={css.empty}>{t('knowledge.unavailable')}</p>
  if (home) {
    const topic = library.notes.find(note => note.path === 'Research.md')
    return (
      <section className={css.home} aria-label={t('knowledge.topic')}>
        <h3>{t('knowledge.topic')}</h3>
        <p>{t('knowledge.topicHint')}</p>
        <p>
          {library.total} {t('knowledge.notesCount')}
          {loading ? ` · ${t('knowledge.loading')}` : ''}
        </p>
        <button
          type="button"
          disabled={busy || sessionId === null}
          onClick={() => {
            void run(async () => {
              if (topic !== undefined) await open(topic.path)
              else if (projectId !== undefined && props.researchCreate !== undefined) {
                const epoch = generation.current
                const result = await props.researchCreate(projectId, 'Research.md', project.title)
                if (epoch !== generation.current) return
                await open(result.path)
                if (result.issues.length) setNotice(result.issues.join('\n'))
              }
            })
          }}
        >
          {t(topic === undefined ? 'knowledge.createTopic' : 'knowledge.openTopic')}
        </button>
        <button type="button" onClick={() => { props.changePreference({ section: 'notes' }) }}>
          {t('knowledge.openLibrary')}
        </button>
        {error !== undefined && <p role="alert">{error}</p>}
        {notice !== undefined && <p role="status">{notice}</p>}
        {library.issues.map(issue => (
          <p key={issue}>{issue}</p>
        ))}
      </section>
    )
  }
  return (
    <section className={css.panel} aria-label={t('knowledge.title')}>
      <header className={css.toolbar}>
        <strong>{t('knowledge.title')}</strong>
        <button type="button" onClick={() => { setCreating(!creating) }}>
          {t('knowledge.new')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              if (current !== undefined && sessionId !== null) await props.refreshDocument?.(sessionId, current.path)
              setRevision(value => value + 1)
            })
          }}
        >
          {t('knowledge.refresh')}
        </button>
        <button
          type="button"
          disabled={busy || props.researchExport === undefined}
          onClick={() => {
            void run(download)
          }}
        >
          {t('knowledge.export')}
        </button>
        <button type="button" onClick={() => { props.changePreference({ section: 'runs' }) }}>
          {t('knowledge.computational')}
        </button>
      </header>
      {creating && (
        <form
          className={css.create}
          onSubmit={(event) => {
            event.preventDefault()
            void run(create)
          }}
        >
          <label>
            {t('knowledge.noteTitle')}
            <input
              value={title}
              onChange={(event) => {
                const value = event.target.value
                setTitle(value)
                if (!path || path === `notes/${title}.md`) setPath(`notes/${value}.md`)
              }}
            />
          </label>
          <label>
            {t('knowledge.path')}
            <input value={path} onChange={(event) => { setPath(event.target.value) }} />
          </label>
          <button type="submit" disabled={busy || !title.trim() || !path.trim() || props.researchCreate === undefined}>
            {t('knowledge.create')}
          </button>
        </form>
      )}
      {error !== undefined && (
        <p className={`${css.notice} ${css.error}`} role="alert">
          {error}
        </p>
      )}
      {notice !== undefined && (
        <p className={css.notice} role="status">
          {notice}
        </p>
      )}
      {library.issues.length > 0 && (
        <details className={css.context}>
          <summary>{t('knowledge.indexIssues')}</summary>
          {library.issues.map((issue, i) => (
            <p key={i}>{issue}</p>
          ))}
        </details>
      )}
      {ambiguous.length > 0 && (
        <div className={css.toolbar}>
          {ambiguous.map(candidate => (
            <button
              type="button"
              key={candidate}
              onClick={() => {
                void run(() => open(candidate))
              }}
            >
              {candidate}
            </button>
          ))}
        </div>
      )}
      <div className={css.body}>
        <nav className={css.navigator} aria-label={t('knowledge.title')}>
          <input
            aria-label={t('knowledge.search')}
            placeholder={t('knowledge.search')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
          {loading && <p role="status">{t('knowledge.loading')}</p>}
          <ul>
            {library.notes.map(note => (
              <li key={note.path}>
                <button
                  type="button"
                  aria-current={note.path === current?.path ? 'page' : undefined}
                  onClick={() => {
                    void run(() => open(note.path))
                  }}
                >
                  {note.title}
                  <small>{note.path}</small>
                </button>
              </li>
            ))}
          </ul>
          {library.cursor !== undefined && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const epoch = generation.current
                  const request = listing.current
                  const list = props.researchList
                  if (list === undefined || projectId === undefined) return
                  const page = await list(projectId, query, library.cursor)
                  if (epoch !== generation.current || request !== listing.current) return
                  setLibrary(value => ({ ...page, notes: [...value.notes, ...page.notes] }))
                })
              }}
            >
              {t('knowledge.more')}
            </button>
          )}
        </nav>
        <div className={css.content}>
          {current === undefined ? (
            <div className={css.empty}>{t('knowledge.empty')}</div>
          ) : (
            <>
              <div className={css.toolbar}>
                <strong>{current.path.split('/').at(-1)}</strong>
                <button type="button" aria-pressed={mode === 'read'} onClick={() => { setMode('read') }}>
                  {t('knowledge.read')}
                </button>
                <button type="button" aria-pressed={mode === 'edit'} onClick={() => { setMode('edit') }}>
                  {t('knowledge.edit')}
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    current.busy ||
                    current.conflict !== undefined ||
                    props.researchCaptureCitations === undefined
                  }
                  onClick={() => {
                    void run(save)
                  }}
                >
                  {t('knowledge.save')}
                </button>
                <button
                  type="button"
                  disabled={!history.current.length || busy}
                  onClick={() => {
                    const previous = history.current.pop()
                    if (previous !== undefined) {
                      void run(async () => {
                        if (sessionId !== null) await props.openDocument(sessionId, previous)
                      })
                    }
                  }}
                >
                  {t('knowledge.back')}
                </button>
              </div>
              {current.text !== current.base.text && <p className={css.notice}>{t('knowledge.unsaved')}</p>}
              {current.error !== undefined && (
                <p className={`${css.notice} ${css.error}`} role="alert">
                  {current.error}
                </p>
              )}
              {current.conflict !== undefined && (
                <p className={css.notice} role="alert">
                  {t('editor.conflict')}{' '}
                  <button type="button" onClick={() => { setMode('edit') }}>
                    {t('knowledge.edit')}
                  </button>
                </p>
              )}
              {mode === 'read' ? (
                <ResearchReader
                  text={current.text}
                  t={t}
                  onLink={(link) => {
                    void run(() => follow(link))
                  }}
                  images={images}
                  heading={heading}
                />
              ) : (
                <DocumentPanel
                  {...props}
                  knowledgeRevision={revision}
                  hideFiles
                  titleKey="research.notesEditor"
                  saveDocument={async () => {
                    await run(save)
                  }}
                />
              )}
              <details className={css.context} open>
                <summary>{t('knowledge.links')}</summary>
                <strong>{t('knowledge.backlinks')}</strong>
                {inspection?.backlinks.map(note => (
                  <button
                    type="button"
                    key={note.path}
                    title={note.excerpt}
                    onClick={() => {
                      void run(() => open(note.path))
                    }}
                  >
                    {note.title}
                  </button>
                ))}
                {inspection?.backlinks.length === 0 && <p>{t('knowledge.none')}</p>}
                <p>{t('knowledge.outgoing')}</p>
                {parsed.links.map((link, index) => (
                  <button
                    type="button"
                    key={index}
                    onClick={() => {
                      void run(() => follow(link))
                    }}
                  >
                    {link.label || link.target}
                  </button>
                ))}
                <label>
                  {t('knowledge.linkTarget')}
                  <input
                    list={`research-targets-${projectId}`}
                    value={linkTarget}
                    onChange={(event) => { setLinkTarget(event.target.value) }}
                  />
                </label>
                <datalist id={`research-targets-${projectId}`}>
                  {library.notes.map(note => (
                    <option key={note.path} value={note.path.replace(/\.(md|markdown)$/i, '')}>
                      {note.title}
                    </option>
                  ))}
                </datalist>
                <button
                  type="button"
                  disabled={busy || !linkTarget || /[\[\]\r\n|]/.test(linkTarget)}
                  onClick={() => {
                    void run(async () => {
                      if (sessionId !== null)
                        await props.editDocument(
                          sessionId,
                          current.path,
                          `${current.text}${current.text.endsWith('\n') ? '' : '\n'}[[${linkTarget}]]\n`,
                        )
                    })
                  }}
                >
                  {t('knowledge.insertLink')}
                </button>
              </details>
              <details className={css.context} open={source !== undefined}>
                <summary>{t('knowledge.citations')}</summary>
                <label>
                  {t('knowledge.source')}
                  <select value={sourceId} onChange={(event) => { setSourceId(event.target.value) }}>
                    <option value="">{t('knowledge.source')}</option>
                    {sources.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                {source !== undefined && (
                  <>
                    <strong>{source.title}</strong>
                    {sourceStatus !== undefined && <p>{t(`handoff.status.${sourceStatus}`)}</p>}
                    <ResearchReader text={source.text} t={t} onLink={() => {}} />
                    <label>
                      {t('knowledge.quote')}
                      <textarea value={quote} onChange={(event) => { setQuote(event.target.value) }} />
                    </label>
                    <button
                      type="button"
                      disabled={busy || !quote}
                      onClick={() => {
                        void run(insert)
                      }}
                    >
                      {t('knowledge.insertCitation')}
                    </button>
                  </>
                )}
                <p>{t('knowledge.captureHint')}</p>
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
