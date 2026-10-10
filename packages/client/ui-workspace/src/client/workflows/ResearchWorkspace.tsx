/** Research presents project stages, sources, evidence, execution and writing as separate working areas. */
import { useEffect, useRef, useState } from 'react'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { JobView, ObservedJob } from '@deepseek-ai/dsh-api-job-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ArtifactRevision, ArtifactRevisionId, ArtifactSearchHit, ArtifactKind, PreparedHandoff } from '@deepseek-ai/dsh-workspace/types'
import type { DocumentPanelProps } from './DocumentPanel.tsx'
import { DocumentPanel } from './DocumentPanel.tsx'
import type { ResearchPreference, ResearchSection, WorkspaceSurfaceActions } from './surfaces.ts'
import css from './surfaces.module.css'

export type ResearchWorkspaceProps = DocumentPanelProps & WorkspaceSurfaceActions & {
  project: WorkspaceView | undefined
  preference: ResearchPreference
  changePreference: (change: Partial<ResearchPreference>) => void
  sessions: readonly { id: SessionId; title: string; running: boolean }[]
  jobs?: readonly JobView[]
  observed?: Readonly<Record<string, ObservedJob>>
  watchRuns?: (session: SessionId) => () => void
  observeRun?: (session: SessionId, id: JobView['id']) => () => void
}
const groups = {
  research: ['overview', 'sources', 'workspace', 'notes'],
  execution: ['runs', 'terminal'],
  review: ['evidence', 'manuscript'],
  operations: ['context', 'history'],
} as const
const simpleSections = ['overview', 'sources', 'notes'] as const
const evidenceKinds: readonly ArtifactKind[] = ['hypothesis', 'finding', 'decision', 'requirement']

/** @param props - Project records, research viewing preferences and Host actions. @returns The full or simple research workspace. */
export function ResearchWorkspace(props: ResearchWorkspaceProps) {
  const { t, project, sessionId, preference, changePreference } = props
  const [query, setQuery] = useState('')
  const [reload, setReload] = useState(0)
  const [hits, setHits] = useState<readonly ArtifactSearchHit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [evidenceSummary, setEvidenceSummary] = useState({ count: 0, hasMore: false })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [path, setPath] = useState('')
  const [kind, setKind] = useState<ArtifactKind>('source')
  const [selected, setSelected] = useState<ArtifactRevision>()
  const [sourceStatus, setSourceStatus] = useState<'current' | 'stale' | 'missing' | 'captured'>()
  const [context, setContext] = useState<readonly PreparedHandoff[]>([])
  const [selectedJob, setSelectedJob] = useState<{ sessionId: SessionId; id: JobView['id'] }>()
  const jobs = props.jobs ?? []
  const jobId = selectedJob?.sessionId === sessionId && jobs.some(job => job.id === selectedJob.id)
    ? selectedJob.id : undefined
  const generation = useRef(0)
  const section = preference.section
  const searchQuery = section === 'sources' || section === 'evidence' ? query : ''
  const evidenceOnly = section === 'evidence'
  const overview = section === 'overview'
  const group = (Object.keys(groups) as (keyof typeof groups)[]).find(key => (groups[key] as readonly ResearchSection[]).includes(section)) ?? 'research'
  useEffect(() => {
    const epoch = ++generation.current
    setSelected(undefined); setSourceStatus(undefined); setHits([]); setHasMore(false); setError(undefined); setBusy(false)
    setEvidenceSummary({ count: 0, hasMore: false })
    setLoading(project !== undefined)
    if (project !== undefined && overview) void props.searchArtifacts({
      projectId: project.workspaceId, query: '', kinds: evidenceKinds,
    }).then((result) => {
      if (generation.current === epoch) setEvidenceSummary({ count: result.hits.length, hasMore: result.hasMore })
    }, (reason: unknown) => { if (generation.current === epoch) setError(reason instanceof Error ? reason.message : String(reason)) })
    if (project !== undefined) void props.searchArtifacts({
      projectId: project.workspaceId, query: searchQuery, ...(evidenceOnly ? { kinds: evidenceKinds } : {}),
    }).then((result) => {
      if (generation.current === epoch) {
        setHits([...result.hits].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)))
        setHasMore(result.hasMore)
      }
    }, (reason: unknown) => {
      if (generation.current === epoch) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (generation.current === epoch) setLoading(false) })
    return () => { ++generation.current }
  }, [project?.workspaceId, searchQuery, evidenceOnly, overview, reload, props.searchArtifacts])
  useEffect(() => {
    let active = true
    setContext([])
    if (section === 'context' && sessionId !== null && props.readContext !== undefined) {
      void props.readContext(sessionId).then((value) => { if (active) setContext(value) }, (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
    }
    return () => { active = false }
  }, [section, sessionId, props.readContext, reload])
  useEffect(() => {
    if (section === 'runs' && sessionId !== null) return props.watchRuns?.(sessionId)
    return undefined
  }, [section, sessionId, props.watchRuns])
  useEffect(() => {
    if (section === 'runs' && sessionId !== null && jobId !== undefined) return props.observeRun?.(sessionId, jobId)
    return undefined
  }, [section, sessionId, jobId, props.observeRun])
  const act = (operation: () => Promise<void>): void => {
    const epoch = generation.current
    setBusy(true); setError(undefined)
    void operation().catch((reason: unknown) => {
      if (generation.current === epoch) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { if (generation.current === epoch) setBusy(false) })
  }
  const inspect = (id: ArtifactRevisionId): void => {
    act(async () => {
      const epoch = generation.current
      const [artifact, inspection] = await Promise.all([props.readArtifact(id), props.inspectArtifact(id)])
      if (generation.current === epoch && artifact.projectId === project?.workspaceId) {
        setSelected(artifact); setSourceStatus(inspection.status)
      }
    })
  }
  useEffect(() => {
    if ((section === 'sources' || section === 'evidence') && preference.sourceRevision !== undefined) inspect(preference.sourceRevision)
  }, [section, preference.sourceRevision, project?.workspaceId, searchQuery, reload])
  const navigate = (value: ResearchSection): void => { changePreference({ section: value }); setError(undefined) }
  const current = props.view?.active === undefined ? undefined : props.view.documents[props.view.active]
  const filtered = section === 'evidence' ? hits.filter(hit => evidenceKinds.includes(hit.kind)) : hits
  return <section className={css.surface} aria-label={t('research.workspace')} data-complexity={preference.complexity}>
    <div className={css.researchHeading}>
      <div><span className={css.eyebrow}>{t('workflow.research')}</span><h2>{project?.title ?? t('research.newProject')}</h2></div>
      <label>{t('research.presentation')}<select aria-label={t('research.presentation')} value={preference.complexity}
        onChange={(event) => { changePreference({ complexity: event.target.value as ResearchPreference['complexity'] }) }}>
        <option value="full">{t('research.full')}</option><option value="simple">{t('research.simple')}</option>
      </select></label>
    </div>
    <nav className={css.groupNav} aria-label={t('research.navigation')}>
      {preference.complexity === 'full' ? (Object.keys(groups) as (keyof typeof groups)[]).map(key =>
        <button type="button" key={key} aria-current={group === key ? 'page' : undefined} onClick={() => { navigate(groups[key][0]) }}>{t(`research.group.${key}`)}</button>)
        : <>{simpleSections.map(value => <button type="button" key={value} aria-current={section === value ? 'page' : undefined} onClick={() => { navigate(value) }}>{t(`research.section.${value}`)}</button>)}
          <details className={css.more}><summary>{t('research.more')}</summary><div>{Object.values(groups).flat().filter(value => !(simpleSections as readonly string[]).includes(value)).map(value =>
            <button type="button" key={value} onClick={(event) => { navigate(value); event.currentTarget.closest('details')?.removeAttribute('open') }}>{t(`research.section.${value}`)}</button>)}</div></details></>}
    </nav>
    {preference.complexity === 'full' && <nav className={css.sectionNav} aria-label={t('research.areas')}>
      {groups[group].map(value => <button type="button" key={value} aria-current={section === value ? 'page' : undefined} onClick={() => { navigate(value) }}>{t(`research.section.${value}`)}</button>)}
    </nav>}
    <div className={css.researchContent}>
      {project === undefined ? <div className={css.empty}><h3>{t('research.newProject')}</h3><p>{t('research.noProject')}</p></div> : <>
        {error !== undefined && <p className={css.notice} role="alert">{error}<button type="button" onClick={() => { setReload(value => value + 1) }}>{t('surface.refresh')}</button></p>}
        {section === 'overview' && <>
          <header className={css.pageHeading}><h3>{t('research.section.overview')}</h3><span>{t('research.projectRevision')}</span></header>
          {preference.complexity === 'full' && <div className={css.workflowPath} aria-label={t('research.workflow')}>
            {(['sources', 'notes', 'runs', 'evidence', 'manuscript'] as const).map((value, index) => <button type="button" key={value} onClick={() => { navigate(value) }}><span>{index + 1}</span>{t(`research.section.${value}`)}</button>)}
          </div>}
          <div className={css.summaryGrid}>
            <button type="button" onClick={() => { navigate('sources') }}><strong>{hits.length}{hasMore ? '+' : ''}</strong><span>{t('research.registered')}</span></button>
            <button type="button" onClick={() => { navigate('evidence') }}><strong>{evidenceSummary.count}{evidenceSummary.hasMore ? '+' : ''}</strong><span>{t('research.findings')}</span></button>
            <button type="button" onClick={() => { navigate('history') }}><strong>{props.sessions.length}</strong><span>{t('research.conversations')}</span></button>
          </div>
          <h4>{t('research.nextActions')}</h4><div className={css.actionRows}>
            <button type="button" onClick={() => { navigate('sources') }}><strong>{t('research.captureAction')}</strong><span>{t('research.captureDetail')}</span><b aria-hidden="true">↗</b></button>
            <button type="button" onClick={() => { navigate('evidence') }}><strong>{t('research.evidenceAction')}</strong><span>{t('research.evidenceDetail')}</span><b aria-hidden="true">↗</b></button>
            <button type="button" onClick={() => { navigate('notes') }}><strong>{t('research.notesAction')}</strong><span>{t('research.notesDetail')}</span><b aria-hidden="true">↗</b></button>
          </div>
          <h4>{t('research.recentSources')}</h4><ul className={css.recentList}>{hits.slice(0, 5).map(hit => <li key={hit.id}><button type="button" onClick={() => { changePreference({ section: 'sources', sourceRevision: hit.id }) }}>{hit.title}</button><span>{t(`handoff.kind.${hit.kind}`)}</span></li>)}</ul>
          {hits.length === 0 && !loading && <p className={css.muted}>{t('research.emptySources')}</p>}
        </>}
        {(section === 'sources' || section === 'evidence') && <>
          <header className={css.pageHeading}><h3>{t(`research.section.${section}`)}</h3><button type="button" onClick={() => { setReload(value => value + 1) }}>{t('surface.refresh')}</button></header>
          <form className={css.search} onSubmit={(event) => { event.preventDefault(); setReload(value => value + 1) }}>
            <input aria-label={t('research.filter')} placeholder={t('research.filter')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
          </form>
          <details className={css.capture} open={hits.length === 0}><summary>{t('research.captureSource')}</summary>
            <form className={css.captureForm} onSubmit={(event) => { event.preventDefault(); act(async () => {
              const epoch = generation.current
              const artifact = await props.registerArtifact({ projectId: project.workspaceId, path: path.trim(), kind })
              if (generation.current === epoch) { setQuery(''); setReload(value => value + 1); setPath(''); setSelected(artifact) }
            }) }}>
              <input aria-label={t('handoff.sourcePath')} placeholder={t('handoff.sourcePath')} value={path} onChange={(event) => { setPath(event.target.value) }} />
              <select aria-label={t('handoff.classification')} value={kind} onChange={(event) => { setKind(event.target.value as ArtifactKind) }}>
                {(['source', 'note', 'hypothesis', 'finding', 'decision', 'requirement', 'manuscript'] as const).map(value => <option key={value} value={value}>{t(`handoff.kind.${value}`)}</option>)}
              </select><button type="submit" disabled={busy || path.trim() === ''}>{t('handoff.register')}</button>
            </form><p>{t('research.captureDetail')}</p>
          </details>
          <div className={css.libraryBody} data-selected={selected !== undefined}>
            <div className={css.artifactList}>{filtered.map(hit => <article
              key={hit.id} className={css.artifact} data-selected={selected?.id === hit.id}>
              <span className={css.kind} data-kind={hit.kind}>{t(`handoff.kind.${hit.kind}`)}</span>
              <button type="button" disabled={busy} onClick={() => { changePreference({ sourceRevision: hit.id }) }}>{hit.title}</button>
              <p>{hit.excerpt}</p><small title={hit.path}>{hit.path}</small>
            </article>)}{filtered.length === 0 && !loading && <p className={css.empty}>{t(section === 'evidence' ? 'research.emptyEvidence' : 'research.emptySources')}</p>}</div>
            {selected !== undefined && <article className={css.reader} aria-label={t('research.reader')}>
              <header><h3>{selected.title}</h3><button type="button" aria-label={t('research.closeReader')} onClick={() => { setSelected(undefined); changePreference({ sourceRevision: undefined }) }}>×</button></header>
              <div className={css.readerMeta}><span>{t(`handoff.kind.${selected.kind}`)}</span>{sourceStatus !== undefined && <span>{t(`handoff.status.${sourceStatus}`)}</span>}<code title={selected.revision}>{selected.revision.slice(0, 12)}</code></div>
              <pre>{selected.text}</pre>
              <div className={css.toolbar}>
                <button type="button" disabled={sessionId === null || selected.origin !== undefined} onClick={() => { if (sessionId !== null) props.openPreview(sessionId, selected.path) }}>{t('research.openOriginal')}</button>
                {(['coding', 'writing'] as const).map(value => <button type="button" disabled={sessionId === null} key={value} onClick={() => { if (sessionId !== null) props.requestEvidenceHandoff(sessionId, selected, value) }}>{t(`handoff.use.${value}`)}</button>)}
              </div>
            </article>}
          </div>
          {hasMore && <p className={css.notice}>{t('handoff.searchMore')}</p>}
        </>}
        {(section === 'notes' || section === 'manuscript' || section === 'workspace') && <div className={css.researchEditor}>
          <div className={css.toolbar}><strong>{t(`research.section.${section}`)}</strong>
            <button type="button" disabled={sessionId === null || current === undefined} onClick={() => { if (sessionId !== null && current !== undefined) props.openPreview(sessionId, current.path) }}>{t('coding.preview')}</button>
            <button type="button" disabled={current === undefined} onClick={() => { if (current !== undefined) { setPath(current.path); setKind(section === 'manuscript' ? 'manuscript' : 'note'); navigate('sources') } }}>{t('research.captureSource')}</button>
          </div>
          <DocumentPanel {...props} hideFiles titleKey={section === 'manuscript' ? 'research.manuscriptEditor' : 'research.notesEditor'} />
        </div>}
        {section === 'runs' && <>
          <header className={css.pageHeading}><h3>{t('research.section.runs')}</h3><button type="button" disabled={sessionId === null} onClick={props.openTerminal}>{t('coding.terminal')}</button></header>
          <p className={css.muted}>{t('research.runEvidence')}</p>
          <div className={css.actionRows}>{jobs.map(job => <button type="button" key={job.id} onClick={() => { if (sessionId !== null) setSelectedJob({ sessionId, id: job.id }) }}>
            <strong>{job.label}</strong><span>{t(`research.job.${job.status}`)}{job.progress === undefined ? '' : ` · ${job.progress}`}</span><b aria-hidden="true">↗</b>
          </button>)}</div>
          {jobs.length === 0 && <p className={css.empty}>{t('research.emptyRuns')}</p>}
          {jobId !== undefined && <div className={css.log}><h4>{t('research.runOutput')}</h4>
            {props.observed?.[jobId]?.error !== undefined && <p role="alert">{props.observed[jobId].error}</p>}
            {props.observed?.[jobId]?.gapBefore === true && <p>{t('research.outputGap')}</p>}
            <pre>{props.observed?.[jobId]?.text ?? t('surface.loading')}</pre>
          </div>}
        </>}
        {section === 'terminal' && <div className={css.empty}><h3>{t('research.section.terminal')}</h3><p>{t('research.terminalDetail')}</p><button type="button" disabled={sessionId === null} onClick={props.openTerminal}>{t('coding.terminal')}</button></div>}
        {section === 'context' && <><header className={css.pageHeading}><h3>{t('research.section.context')}</h3><button type="button" onClick={() => { setReload(value => value + 1) }}>{t('surface.refresh')}</button></header>
          {context.length === 0 && <p className={css.empty}>{t('handoff.emptyContext')}</p>}
          {context.map(packet => <article className={css.artifact} key={packet.id}><h4>{packet.objective}</h4><span>{t(`workflow.${packet.workflow}`)}</span><p>{packet.context.evidence.map(value => value.title).join(', ')}</p></article>)}
        </>}
        {section === 'history' && <><header className={css.pageHeading}><h3>{t('research.section.history')}</h3></header><div className={css.actionRows}>
          {props.sessions.map(session => <button type="button" key={session.id} onClick={() => { props.openSession(session.id) }}><strong>{session.title}</strong><span>{t(session.running ? 'status.running' : 'status.idle')}</span><b aria-hidden="true">↗</b></button>)}
        </div></>}
        {loading && <p className={css.muted} role="status">{t('research.loading')}</p>}
      </>}
    </div>
  </section>
}
