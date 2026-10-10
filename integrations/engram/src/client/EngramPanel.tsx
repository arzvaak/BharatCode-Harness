








import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './panel.module.css'
import { KIND_KEY, NS, en, zh, type EngramKey } from './locales.ts'
import { CorridorMap } from './CorridorMap.tsx'
import { useToast, type ToastController } from './Toast.tsx'
import { usePersistedState, usePersistedString } from './UiStorage.ts'







/** Display legacy persisted room names in English without changing stored identifiers. */
function displayRoom(room: string): string {
  const names: Record<string, string> = { [String.fromCodePoint(20107,23454,21381)]: 'Facts', [String.fromCodePoint(20559,22909,38401)]: 'Preferences', [String.fromCodePoint(20915,31574,22530)]: 'Decisions', [String.fromCodePoint(24448,20107,24266)]: 'Episodes', [String.fromCodePoint(25216,27861,22346)]: 'Skills' }
  for (const [legacy, english] of Object.entries(names)) {
    if (room === legacy || room.startsWith(`${legacy}-`)) return english + room.slice(legacy.length)
  }
  return room
}

const ICONS = {

  today: <><circle cx="12" cy="12" r="3" /><path d="M2 12h3M19 12h3M12 2v3M12 19v3" /></>,
  library: <><rect x="4" y="4" width="9" height="9" rx="1" /><rect x="11" y="11" width="9" height="9" rx="1" /></>,
  corridor: <><circle cx="5" cy="6" r="1.8" /><circle cx="19" cy="6" r="1.8" /><circle cx="12" cy="18" r="1.8" /><path d="M6.5 7.5L11 16.5M17.5 7.5L13 16.5M7 6h10" /></>,
  episodes: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  entities: <><path d="M12 3 L21 12 L12 21 L3 12 Z" /><circle cx="12" cy="12" r="2.5" /></>,
  beliefs: <><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 00-3.5 10.9c.7.5 1.1 1.2 1.3 2.1h4.4c.2-.9.6-1.6 1.3-2.1A6 6 0 0012 3z" /></>,
  log: <><line x1="5" y1="6" x2="19" y2="6" /><line x1="5" y1="12" x2="19" y2="12" /><line x1="5" y1="18" x2="13" y2="18" /></>,
  backfill: <><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><line x1="4" y1="20" x2="20" y2="20" /></>,
  jev: <><path d="M12 3 L4 8 V16 L12 21 L20 16 V8 Z" /><path d="M9 12l2 2 4-4" /></>,

  user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></>,
  project: <><path d="M3 7 L9 7 L11 5 L21 5 L21 17 L3 17 Z" /><line x1="3" y1="7" x2="3" y2="17" /></>,
  shared: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 010 18" /><path d="M12 3a14 14 0 000 18" /></>,

  folder: <><path d="M3 7 L9 7 L11 5 L21 5 L21 17 L3 17 Z" /></>,
  refresh: <><path d="M3 12a9 9 0 0115-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 01-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  export: <><path d="M12 15V4" /><path d="M8 8l4-4 4 4" /><path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  brand: <><path d="M12 2 L14.5 9 L22 9.5 L16 14.5 L18 22 L12 17.5 L6 22 L8 14.5 L2 9.5 L9.5 9 Z" /></>,
} as const
type IconName = keyof typeof ICONS



function Icon({ name, className }: { readonly name: IconName; readonly className?: string | undefined }): React.ReactElement {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {ICONS[name]}
    </svg>
  )
}


interface MemoryRow {
  readonly id: string
  readonly scope: 'user' | 'project' | 'shared'
  readonly kind: string
  readonly content: string
  readonly importance: number
  readonly confidence: number
  readonly status: 'active' | 'archived' | 'forgotten'
  
  readonly outcome?: 'success' | 'failure'
  readonly createdAt: number
  readonly accessCount: number
  readonly sourceSessionId: string | null
  readonly sourceRound: number | null
  
  readonly slot?: { readonly room: string; readonly index: number }
}

interface ListResult {
  readonly records: MemoryRow[]
  readonly total: number
}

interface StatsPart {
  readonly scope: 'user' | 'project' | 'shared'
  readonly stats: {
    readonly total: number
    readonly active: number
    readonly archived: number
    readonly forgotten: number
    readonly redacted: number
    readonly signalRatio: number
    
    readonly byKind?: Readonly<Record<string, number>>
  }
}


interface ReviewView {
  readonly record: MemoryRow
  readonly supersededBy?: readonly string[]
  readonly supersedes?: readonly string[]
  readonly contradicts?: readonly string[]
  readonly related?: readonly string[]
  
  readonly revisions?: readonly { content: string; kind: string; importance: number; supersededAt: number }[]
  readonly operations?: readonly { at: number; op: string; detail: string | null }[]
}


type T = (key: EngramKey, params?: Record<string, unknown>) => string


const DICTS: Record<'zh' | 'en', Record<EngramKey, string>> = { zh, en }

function makeT(lang: 'zh' | 'en'): T {
  const dict = DICTS[lang]
  return (key, params) => (dict[key] ?? String(key)).replace(/\{(\w+)\}/g, (raw: string, name: string) => {
    const value = params?.[name]
    return value === undefined ? raw : String(value)
  })
}


const KINDS = ['fact', 'preference', 'decision', 'episode', 'skill'] as const
const PAGE_SIZE = 20


const STATUS_KEY: Record<MemoryRow['status'], EngramKey> = {
  active: 'statusActive',
  archived: 'statusArchived',
  forgotten: 'statusForgotten',
}
const SCOPE_KEY: Record<MemoryRow['scope'], EngramKey> = {
  user: 'scopeUser',
  project: 'scopeProject',
  shared: 'scopeShared',
}

const ROOM_CLASS: Record<string, string> = {
  fact: 'roomFact',
  preference: 'roomPreference',
  decision: 'roomDecision',
  episode: 'roomEpisode',
  skill: 'roomSkill',
}
const OP_KEY: Record<string, EngramKey> = {
  write: 'opWrite',
  'write-merge': 'opWriteMerge',
  update: 'opUpdate',
  forget: 'opForget',
  restore: 'opRestore',
  decay: 'opDecay',
  superseded: 'opSuperseded',
  'ingest-request': 'opIngestRequest',
  'ingest-done': 'opIngestDone',
  'outcome-report': 'opOutcomeReport',
  assess: 'opAssess',
  consolidation: 'opConsolidation',
  'review-answer': 'opReviewAnswer',
  'slot-assign': 'opSlotAssign',
  'slot-backfill': 'opSlotBackfill',
  'room-open': 'opRoomOpen',
  'search-rewrite-request': 'opSearchRewrite',
  'compress-request': 'opCompressRequest',
  'distill-request': 'opDistillRequest',
  'profile-edit': 'opProfileEdit',
}
const REL_KEY: Record<string, EngramKey> = {
  supersededBy: 'relSupersededBy',
  supersedes: 'relSupersedes',
  contradicts: 'relContradicts',
  related: 'relRelated',
}

const DETAIL_KEY: Record<string, EngramKey> = {
  kind: 'labelKind',
  scope: 'labelScope',
  status: 'labelStatus',
}


function kindLabel(t: T, kind: string): string {
  const key = KIND_KEY[kind]
  return key === undefined ? kind : t(key)
}


function roomPillClass(kind: string): string {
  return `${styles.pill} ${styles[ROOM_CLASS[kind] ?? 'kind'] ?? ''}`
}


function opLabel(t: T, op: string): string {
  const key = OP_KEY[op]
  return key === undefined ? op : t(key)
}


function formatOpDetail(t: T, op: string, detail: string | null): string {
  if (detail === null) return ''

  if (op === 'profile-edit') {
    try {
      const parsed = JSON.parse(detail) as { action?: unknown; fromVersion?: unknown; toVersion?: unknown; restoredFrom?: unknown; chars?: unknown }
      const to = Number(parsed.toVersion)
      const chars = Number(parsed.chars)
      if (parsed.action === 'edit' && parsed.fromVersion === null) {
        return ' ' + t('profileOpCreate', { to, chars })
      }
      const from = Number(parsed.fromVersion)
      if (parsed.action === 'edit') return ' ' + t('profileOpEdit', { from, to, chars })
      const restored = Number(parsed.restoredFrom)
      if (parsed.action === 'rollback' && Number.isInteger(from) && Number.isInteger(to) && Number.isInteger(restored)) {
        return ' ' + t('profileOpRollback', { from, to, restored, chars })
      }
    } catch {

    }
    return ` ${detail}`
  }
  if (op !== 'write' && op !== 'update' && op !== 'superseded') return ` ${detail}`
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>
    const entries = Object.entries(parsed)
    if (entries.length === 0) return ` ${detail}`
    return ' ' + entries.map(([key, value]) => {
      const label = DETAIL_KEY[key]
      if (label === undefined) return `${key}=${String(value)}`
      if (key === 'kind' && typeof value === 'string') return `${t(label)}=${kindLabel(t, value)}`
      if (key === 'scope' && (value === 'user' || value === 'project')) return `${t(label)}=${t(SCOPE_KEY[value])}`
      return `${t(label)}=${String(value)}`
    }).join(' · ')
  } catch {
    return ` ${detail}`
  }
}


function sourceLabel(t: T, record: Pick<MemoryRow, 'sourceSessionId' | 'sourceRound'>): string {
  if (record.sourceSessionId === null) return t('sourceExplicit')
  const id = `${record.sourceSessionId.slice(0, 16)}…`
  const withRound = record.sourceRound === null
    ? id
    : `${id} ${t('round', { n: record.sourceRound })}`
  return t('sourceSession', { id: withRound })
}






let activeProjectSelector: string | null = null





let healDeadProject: (() => void) | null = null


function isProjectScoped(path: string, init?: RequestInit): boolean {
  if (/(?:^|[?&])scope=project(?:&|$)/.test(path)) return true
  const body = init?.body
  if (typeof body !== 'string' || body === '') return false
  try {
    const parsed = JSON.parse(body) as { scope?: unknown } | null
    return typeof parsed === 'object' && parsed !== null && parsed.scope === 'project'
  } catch {

    return false
  }
}


function withProjectField(body: string, selector: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return JSON.stringify({ ...(parsed as Record<string, unknown>), project: selector })
  } catch {
    return undefined
  }
}


function withProjectParam(path: string, selector: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(selector)}`
}










async function api<T>(path: string, init?: RequestInit, forceProject = false): Promise<T> {
  const selector = activeProjectSelector
  let target = path
  let requestInit = init
  const projectScoped = selector !== null && (forceProject || isProjectScoped(path, init))
  if (projectScoped) {
    const body = init?.body
    const fromBody = typeof body === 'string' && body !== '' ? withProjectField(body, selector) : undefined
    if (fromBody !== undefined && init !== undefined) requestInit = { ...init, body: fromBody }
    else target = withProjectParam(path, selector)
  }
  const response = await fetch(`/api/engram/${target}`, requestInit)
  const parsed = (await response.json()) as T & { error?: string }
  if (!response.ok) {

    if (projectScoped && response.status === 404 && parsed.error === 'unknown project') healDeadProject?.()
    throw new Error(parsed.error ?? `HTTP ${String(response.status)}`)
  }
  return parsed
}


interface EngramProjectItem {
  readonly dbName: string
  
  readonly title?: string | null | undefined
  
  readonly path?: string | null | undefined
  
  readonly kind: 'workspace' | 'session' | 'process'
  
  readonly source: 'origin' | 'cwd' | 'workspace'
  
  readonly workspaceId?: string | null | undefined
  
  readonly exists: boolean
  
  readonly memories: number | null
}


interface EngramWorkspacesView {
  readonly items: readonly EngramProjectItem[]
  readonly processDefault: { readonly dbName: string; readonly path: string | null; readonly title: string | null } | null
}


export interface HostWorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}


interface ObservableLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}


export interface WorkspacesLike {
  readonly list: ObservableLike<{ readonly items: readonly HostWorkspaceView[] }>
}


export interface SessionsLike {
  readonly list: ObservableLike<{ readonly current?: string | undefined }>
}


const NO_WORKSPACES: readonly HostWorkspaceView[] = []


function noopUnsubscribe(): void {  }





function subscribeSnapshot<T>(source: ObservableLike<T> | undefined, onChange: () => void): () => void {
  if (source === undefined) return noopUnsubscribe
  const off = source.subscribe(onChange)
  return typeof off === 'function' ? off : noopUnsubscribe
}








function useCurrentWorkspace(workspaces: WorkspacesLike | undefined, sessions: SessionsLike | undefined): {
  workspace: HostWorkspaceView | null
  available: boolean
} {
  const subscribeWorkspaces = useCallback(
    (onChange: () => void): (() => void) => subscribeSnapshot(workspaces?.list, onChange),
    [workspaces],
  )
  const subscribeSessions = useCallback(
    (onChange: () => void): (() => void) => subscribeSnapshot(sessions?.list, onChange),
    [sessions],
  )
  const currentSessionId = useSyncExternalStore(subscribeSessions, () => sessions?.list.getSnapshot().current ?? null)
  const items = useSyncExternalStore(subscribeWorkspaces, () => workspaces?.list.getSnapshot().items ?? NO_WORKSPACES)
  const available = workspaces !== undefined && sessions !== undefined
  if (!available || currentSessionId === null) return { workspace: null, available }
  return { workspace: items.find(item => item.sessionIds.includes(currentSessionId)) ?? null, available }
}


function pathKey(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}


function lastSegment(path: string): string {
  const normalized = path.replace(/[/\\]+$/, '')
  const at = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return at < 0 ? normalized : normalized.slice(at + 1)
}


function shortDbName(dbName: string): string {
  const match = /^project-([0-9a-f]+)\.db$/i.exec(dbName)
  return match === null ? dbName.slice(0, 14) : `project-${match[1]!.slice(0, 8)}…`
}


function projectLabel(item: EngramProjectItem): { name: string; unregistered: boolean } {
  if (typeof item.path !== 'string' || item.path === '') return { name: shortDbName(item.dbName), unregistered: true }
  const title = item.title?.trim() ?? ''
  if (title !== '') return { name: title, unregistered: item.kind !== 'workspace' }
  return { name: lastSegment(item.path), unregistered: item.kind !== 'workspace' }
}


function projectOptionLabel(t: T, item: EngramProjectItem): string {
  const label = projectLabel(item)
  const parts = [label.unregistered ? `${label.name} · ${t('projectUnregistered')}` : label.name]
  parts.push(item.memories === null ? '—' : t('projectMemories', { n: item.memories }))
  return parts.join(' · ')
}


function matchFollowTarget(list: EngramWorkspacesView | null, workspace: HostWorkspaceView | null): EngramProjectItem | undefined {
  if (list === null || workspace === null) return undefined
  const byId = list.items.find(item => item.workspaceId === workspace.workspaceId)
  if (byId !== undefined) return byId
  const key = pathKey(workspace.path)
  return list.items.find(item => typeof item.path === 'string' && pathKey(item.path) === key)
}


function fmtTime(ms: number): string {

  return new Date(ms).toLocaleString(navigator.language || 'zh-CN', { hour12: false })
}


function relTime(t: T, ms: number): string {
  const diff = Math.max(0, Date.now() - ms)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('timeJustNow')
  if (minutes < 60) return t('timeMinutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return t('timeHoursAgo', { n: hours })
  return t('timeDaysAgo', { n: Math.floor(hours / 24) })
}


function Metric({ label, value, tail }: {
  label: string
  value: string | number
  tail?: string | undefined
}): React.ReactElement {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <b className={styles.metricValue}>{value}</b>
      {tail !== undefined && <span className={styles.metricTail}>{tail}</span>}
    </div>
  )
}


function HealthRing({ score }: { score: number }): React.ReactElement {
  const radius = 24
  const circumference = 2 * Math.PI * radius
  const filled = circumference * (Math.min(100, Math.max(0, score)) / 100)
  const tone = score >= 80 ? 'var(--dsw-alias-state-success-primary)'
    : score >= 50 ? 'var(--dsw-alias-state-warn-primary)'
      : 'var(--dsw-alias-state-error-primary)'
  return (
    <div className={styles.ring} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={radius} fill="none" stroke="var(--dsw-alias-border-l2)" strokeWidth="4" />
        <circle cx="28" cy="28" r={radius} fill="none" stroke={tone} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${filled.toFixed(1)} ${circumference.toFixed(1)}`} />
      </svg>
      <b>{score}</b>
    </div>
  )
}


function Meter({ value, conf }: { value: number; conf?: boolean }): React.ReactElement {
  return (
    <span className={conf === true ? `${styles.meter} ${styles.conf}` : styles.meter}>
      <i style={{ width: `${String(Math.round(Math.min(1, Math.max(0, value)) * 100))}%` }} />
    </span>
  )
}


function RelChips({ ids }: { ids: readonly string[] }): React.ReactElement {
  return (
    <div className={styles.relChips}>
      {ids.map(id => <span key={id} className={styles.relChip} title={id}>{id.slice(0, 18)}</span>)}
    </div>
  )
}


function ReviewBody({ t, recordId, scope, project }: {
  t: T
  recordId: string
  scope: 'user' | 'project' | 'shared'
  
  project: string | null
}): React.ReactElement {
  const [view, setView] = useState<ReviewView | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api<ReviewView>(`review?scope=${scope}&id=${encodeURIComponent(recordId)}`)
      .then((data) => { if (!cancelled) setView(data) })
      .catch((error: Error) => { if (!cancelled) setFailed(error.message) })
    return () => { cancelled = true }
  }, [recordId, scope, project, t])
  if (failed !== null) return <div className={styles.expandLoading}>{t('loadFailed', { msg: failed })}</div>
  if (view === null) return <div className={styles.expandLoading}>{t('loading')}</div>
  const { record } = view
  const relations = (['supersededBy', 'supersedes', 'contradicts', 'related'] as const)
    .map(key => ({ key, label: REL_KEY[key], ids: view[key] ?? [] }))
    .filter(entry => entry.ids.length > 0)
  const operations = view.operations ?? []
  return (
    <div className={styles.reviewGrid}>
      <div>
        <dl className={styles.attrGrid}>
          <dt>{t('labelContent')}</dt>
          <dd>{record.content}</dd>
          <dt>{t('labelKind')}</dt>
          <dd><span className={roomPillClass(record.kind)}>{kindLabel(t, record.kind)}</span></dd>
          <dt>{t('labelStatus')}</dt>
          <dd><span className={`${styles.pill} ${styles[`status${record.status.charAt(0).toUpperCase()}${record.status.slice(1)}`] ?? ''}`}>{t(STATUS_KEY[record.status])}</span></dd>
          <dt>{t('importance')}</dt>
          <dd>{record.importance.toFixed(2)}<Meter value={record.importance} /></dd>
          <dt>{t('confidence')}</dt>
          <dd>{record.confidence.toFixed(2)}<Meter value={record.confidence} conf /></dd>
          <dt>{t('detailSource')}</dt>
          <dd>{sourceLabel(t, record)}</dd>
          <dt>{t('labelCreated')}</dt>
          <dd>{fmtTime(record.createdAt)}</dd>
        </dl>
        {relations.map(({ key, label, ids }) => (
          <div key={key} className={styles.relBlock}>
            <h5>{label === undefined ? key : t(label)}</h5>
            <RelChips ids={ids} />
          </div>
        ))}
      </div>
      <div>
        {(view.revisions ?? []).length > 0 && (
          <div className={styles.relBlock}>
            <h5>{t('detailRevisions')}</h5>
            <ul className={styles.timeline}>
              {view.revisions!.map((rev, index) => (
                <li key={index}>
                  <time>{fmtTime(rev.supersededAt)}</time>
                  <b>{kindLabel(t, rev.kind)}</b>
                  {' '}{rev.content}
                </li>
              ))}
            </ul>
          </div>
        )}
        {operations.length > 0 && (
          <div className={styles.relBlock}>
            <h5>{t('detailOperations')}</h5>
            <ul className={styles.timeline}>
              {operations.map((op, index) => (
                <li key={index}>
                  <time>{fmtTime(op.at)}</time>
                  <b>{opLabel(t, op.op)}</b>
                  {formatOpDetail(t, op.op, op.detail)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}


function EditForm({ t, record, onClose, onSaved, toast }: {
  t: T
  record: MemoryRow
  onClose: () => void
  onSaved: () => void
  toast: ToastController
}): React.ReactElement {
  const [content, setContent] = useState(record.content)
  const [kind, setKind] = useState(record.kind)
  const [importance, setImportance] = useState(record.importance)
  const save = (): void => {
    api('update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: record.id, scope: record.scope, content, kind, importance }),
    })
      .then(onSaved)
      .catch((error: Error) => { toast.push('error', error.message) })
  }
  return (
    <div className={styles.editForm}>
      <div>
        <label className={styles.fieldLabel}>{t('labelContent')}</label>
        <textarea className={styles.input} rows={3} value={content} onChange={event => setContent(event.target.value)} />
      </div>
      <div>
        <label className={styles.fieldLabel}>{t('labelKind')}</label>
        {}
        <select className={styles.input} value={kind} onChange={event => setKind(event.target.value)}>
          {KINDS.map(option => <option key={option} value={option}>{kindLabel(t, option)}</option>)}
        </select>
      </div>
      <div className={styles.fieldRow}>
        <div>
          <label className={styles.fieldLabel}>{`${t('importance')} ${importance.toFixed(2)}`}</label>
          <input type="range" min={0} max={1} step={0.05} value={importance}
            onChange={event => setImportance(Number(event.target.value))} />
        </div>
      </div>
      <div className={styles.modalFoot}>
        <button type="button" className={styles.button} onClick={onClose}>{t('cancel')}</button>
        <button type="button" className={`${styles.button} ${styles.primary}`} onClick={save}>{t('saveWithHint')}</button>
      </div>
    </div>
  )
}


interface BenchHit {
  readonly id: string
  readonly score: number
  readonly via: 'fts' | 'vec' | 'both'
  readonly viaEdge?: { readonly from: string; readonly type: string }
  readonly scope: string
  readonly kind: string
  readonly content: string
}


interface BenchResult {
  readonly degraded: boolean
  readonly hits: readonly BenchHit[]
}


interface ActivityRow {
  readonly at: number
  readonly op: string
  readonly targetId: string
  readonly detail: string | null
  readonly scope: 'user' | 'project'
}


const VIA_KEY: Record<BenchHit['via'], EngramKey> = { fts: 'viaFts', vec: 'viaVec', both: 'viaBoth' }


function RecallBench({ t, scope }: { t: T; scope: 'user' | 'project' | 'shared' }): React.ReactElement {
  const [query, setQuery] = useState('')
  
  const [benchScope, setBenchScope] = useState<string>(scope)
  const [result, setResult] = useState<BenchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setBenchScope(scope) }, [scope])
  const run = (): void => {
    if (query.trim() === '' || busy) return
    setBusy(true)

    api<BenchResult>(`search-test?q=${encodeURIComponent(query.trim())}&scope=${benchScope}`, undefined, true)
      .then((data) => { setResult(data); setError(null) })
      .catch((benchError: Error) => setError(benchError.message))
      .finally(() => setBusy(false))
  }
  const hits = result?.hits ?? []
  return (
    <div>
      <div className={styles.benchBar}>
        <input className={`${styles.input} ${styles.search}`} placeholder={t('benchPlaceholder')} value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') run() }} />
        <select className={styles.input} value={benchScope}
          onChange={event => setBenchScope(event.target.value)}>
          <option value="all">{t('benchScopeAll')}</option>
          <option value="user">{t('scopeUser')}</option>
          <option value="project">{t('scopeProject')}</option>
          <option value="shared">{t('scopeShared')}</option>
        </select>
        <button type="button" className={`${styles.button} ${styles.primary}`}
          disabled={busy || query.trim() === ''} onClick={run}>{t('benchRun')}</button>
      </div>
      {error !== null && <div className={styles.expandLoading}>{t('loadFailed', { msg: error })}</div>}
      {result !== null && error === null && (
        <div className={styles.benchMeta}>
          <span>{t('benchHits', { n: hits.length })}</span>
          {result.degraded && <span className={styles.degradedNote}>{t('benchDegraded')}</span>}
        </div>
      )}
      <div className={styles.benchList}>
      {hits.map(hit => (
        <div key={hit.id} className={styles.benchRow}>
          <div className={styles.benchHead}>
            <span className={styles.viaChip}>{t(VIA_KEY[hit.via])}</span>
            {hit.viaEdge !== undefined && (
              <span className={styles.viaChip}
                title={`${hit.viaEdge.type} ${hit.viaEdge.from}`}>{t('viaEdgeLabel')} · {hit.viaEdge.type}</span>
            )}
            <span className={roomPillClass(hit.kind)}>{kindLabel(t, hit.kind)}</span>
            <span className={styles.benchScore}>{hit.score.toFixed(4)}</span>
          </div>
          <div className={styles.benchContent}>{hit.content}</div>
          <span className={styles.benchId} title={hit.id}>{hit.id}</span>
        </div>
      ))}
      </div>
      {result !== null && hits.length === 0 && error === null && (
        <div className={styles.benchEmpty}>{t('benchEmpty')}</div>
      )}
    </div>
  )
}



function activityDetail(t: T, detail: string | null): string {
  if (detail === null) return ''
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>
    if (typeof parsed.round === 'number' && typeof parsed.userText === 'string') {
      const mode = typeof parsed.mode === 'string' ? ` · ${parsed.mode}` : ''
      return `${t('round', { n: parsed.round })}${mode} · ${parsed.userText.slice(0, 48)}`
    }
    if (typeof parsed.query === 'string' && Array.isArray(parsed.queries)) {
      return `${t('benchRewrite', { n: parsed.queries.length })} · ${parsed.query.slice(0, 36)}`
    }
    if (typeof parsed.count === 'number' && Object.keys(parsed).length === 1) {
      return t('benchCompress', { n: parsed.count })
    }
    if (typeof parsed.batchId === 'string' && typeof parsed.sufficient === 'boolean') {
      const refs = Array.isArray(parsed.refs) ? parsed.refs.length : 0
      return `${parsed.batchId} · ${t(parsed.sufficient ? 'assessAdequate' : 'assessInadequate')} · ${t('assessRefs', { n: refs })}`
    }

    if (typeof parsed.archived === 'number' && typeof parsed.merged === 'number' && typeof parsed.skipped === 'number') {
      const scope = parsed.scope === 'project' ? t('scopeProject') : t('scopeUser')
      return `${scope} · ${t('consolidateArchived', { n: parsed.archived })} · ${t('consolidateMerged', { n: parsed.merged })} · ${t('consolidateSkipped', { n: parsed.skipped })}`
    }

    if (typeof parsed.archived === 'number' && parsed.merged === undefined) {
      return t('decayArchived', { n: parsed.archived })
    }
    if (typeof parsed.assigned === 'number') return t('slotBackfilled', { n: parsed.assigned })
    if (typeof parsed.room === 'string') return t('roomOpened', { room: displayRoom(parsed.room) })
    if (typeof parsed.grade === 'number' && typeof parsed.nextIntervalDays === 'number') {
      return t('reviewAnswered', { grade: parsed.grade, days: parsed.nextIntervalDays })
    }
  } catch {

  }
  return detail.length > 56 ? `${detail.slice(0, 56)}…` : detail
}


type LogFilter = 'all' | 'write' | 'ingest' | 'retrieve' | 'organize'
const LOG_GROUPS: Readonly<Record<LogFilter, readonly string[] | null>> = {
  all: null,
  write: ['write', 'update', 'forget', 'restore', 'decay', 'superseded', 'outcome-report'],
  ingest: ['ingest-request', 'ingest-done'],
  retrieve: ['search-rewrite-request', 'compress-request', 'assess'],
  organize: ['distill-request', 'consolidation', 'slot-assign', 'slot-backfill', 'room-open', 'review-answer', 'profile-edit'],
}
const LOG_FILTER_KEY: Readonly<Record<LogFilter, EngramKey>> = {
  all: 'logFilterAll',
  write: 'logFilterWrite',
  ingest: 'logFilterIngest',
  retrieve: 'logFilterRetrieve',
  organize: 'logFilterOrganize',
}

const LOG_DOT: Readonly<Record<'write' | 'ingest' | 'retrieve' | 'organize', string>> = {
  write: 'logDotWrite',
  ingest: 'logDotIngest',
  retrieve: 'logDotRetrieve',
  organize: 'logDotOrganize',
}

function logGroupOf(op: string): LogFilter {
  for (const group of ['write', 'ingest', 'retrieve', 'organize'] as const) {
    if (LOG_GROUPS[group]?.includes(op) === true) return group
  }
  return 'all'
}

function logDotClass(op: string): string {
  const group = logGroupOf(op)
  const base = styles.logDot ?? ''
  return group === 'all' ? base : `${base} ${styles[LOG_DOT[group]] ?? ''}`
}


function lineDiff(oldText: string, newText: string): readonly { kind: 'same' | 'add' | 'del'; text: string }[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const m = a.length
  const n = b.length

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const rows: { kind: 'same' | 'add' | 'del'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) { rows.push({ kind: 'same', text: a[i]! }); i += 1; j += 1 }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { rows.push({ kind: 'del', text: a[i]! }); i += 1 }
    else { rows.push({ kind: 'add', text: b[j]! }); j += 1 }
  }
  while (i < m) { rows.push({ kind: 'del', text: a[i]! }); i += 1 }
  while (j < n) { rows.push({ kind: 'add', text: b[j]! }); j += 1 }
  return rows
}


interface ProfileBlockView {
  scope: string
  block: { content: string; version: number; updatedAt: number } | null
  versions: readonly { version: number; content: string; source: string; at: number }[]
}





function ProfileCard({ t, scope, project }: { t: T; scope: 'user' | 'project' | 'shared'; project: string | null }): React.ReactElement {
  const [data, setData] = useState<ProfileBlockView | null>(null)
  const [failed, setFailed] = useState(false)
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [targetVersion, setTargetVersion] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    api<ProfileBlockView>(`profile-block?scope=${scope}`, undefined, true)
      .then((view) => {
        if (cancelled) return
        setData(view)
        setFailed(false)

        setBaseVersion(view.versions.length > 1 ? view.versions[1]!.version : null)
        setTargetVersion(view.versions.length > 0 ? view.versions[0]!.version : null)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [scope, project])
  if (failed) {
    return <div className={styles.expandLoading}>{t('profileLoadFailed')}</div>
  }
  if (data === null) {
    return <div className={styles.expandLoading}>{t('loading')}</div>
  }
  if (data.block === null) {
    return (
      <div className={styles.expandLoading}>
        <p>{t('profileEmpty')}</p>
        <p className={styles.sectionHint}>{t('profileEmptyHint')}</p>
      </div>
    )
  }
  const versions = data.versions
  const byVersion = new Map(versions.map(version => [version.version, version]))
  const base = baseVersion === null ? undefined : byVersion.get(baseVersion)
  const target = targetVersion === null ? undefined : byVersion.get(targetVersion)
  const diffRows = base !== undefined && target !== undefined ? lineDiff(base.content, target.content) : []
  const hasDiff = diffRows.some(row => row.kind !== 'same')
  return (
    <div className={styles.profileCard}>
      <h5 className={styles.profileHeading}>{t('profileCurrent', { n: data.block.version })}</h5>
      <pre className={styles.profileContent}>{data.block.content}</pre>
      {versions.length > 1 && (
        <>
          <h5 className={styles.profileHeading}>{t('profileHistory')}</h5>
          <div className={styles.profilePickerRow}>
            <label>
              <span className={styles.sectionHint}>{t('profileDiffBase')}</span>
              <select className={styles.profileSelect} value={baseVersion ?? undefined}
                onChange={event => { setBaseVersion(Number(event.target.value)) }}>
                {versions.map(version => (
                  <option key={version.version} value={version.version}>
                    v{version.version} · {version.source === 'rollback' ? t('profileSourceRollback') : t('profileSourceEdit')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={styles.sectionHint}>{t('profileDiffTarget')}</span>
              <select className={styles.profileSelect} value={targetVersion ?? undefined}
                onChange={event => { setTargetVersion(Number(event.target.value)) }}>
                {versions.map(version => (
                  <option key={version.version} value={version.version}>
                    v{version.version} · {version.source === 'rollback' ? t('profileSourceRollback') : t('profileSourceEdit')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {base !== undefined && target !== undefined && (
            <div className={styles.profileDiff}>
              {hasDiff
                ? diffRows.map((row, index) => (
                  <div key={index} className={
                    row.kind === 'add' ? styles.profileDiffAdd : row.kind === 'del' ? styles.profileDiffDel : styles.profileDiffSame
                  }>{row.kind === 'add' ? '+ ' : row.kind === 'del' ? '- ' : '  '}{row.text}</div>
                ))
                : <div className={styles.sectionHint}>{t('profileDiffNone')}</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}






function LogPanel({ t, telemetry, project }: {
  t: T
  telemetry: TelemetrySnapshot | null
  
  project: string | null
}): React.ReactElement {
  const [rows, setRows] = useState<ActivityRow[] | null>(null)
  const [filter, setFilter] = useState<LogFilter>('all')
  useEffect(() => {
    let cancelled = false
    api<{ operations: ActivityRow[] }>('activity?limit=50', undefined, true)
      .then((data) => { if (!cancelled) setRows(data.operations) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [project])
  const allow = LOG_GROUPS[filter]
  const visible = (rows ?? []).filter(row => allow === null || allow.includes(row.op))
  const counts = telemetry?.counts
  return (
    <section className={styles.section}>
      {
}
      <div className={styles.logToolbar}>
        <h4 className={styles.sectionTitle}>{t('tabLog')}</h4>
        <span className={styles.sectionHint}>{t('logCount', { n: visible.length })}</span>
        <span className={styles.logCounts}>
          <span><i className={`${styles.logDot} ${styles.logDotWrite}`} aria-hidden="true" />{t('teleWrites')} <b>{counts?.writes ?? 0}</b></span>
          <span><i className={`${styles.logDot} ${styles.logDotIngest}`} aria-hidden="true" />{t('teleIngest')} <b>{counts?.ingestDones ?? 0}</b></span>
          <span><i className={`${styles.logDot} ${styles.logDotOrganize}`} aria-hidden="true" />{t('teleConsolidate')} <b>{counts?.consolidations ?? 0}</b></span>
        </span>
        <div className={styles.segGroup} role="tablist">
          {(['all', 'write', 'ingest', 'retrieve', 'organize'] as const).map(option => (
            <button key={option} type="button" role="tab" aria-selected={filter === option}
              className={filter === option ? `${styles.segItem} ${styles.on}` : styles.segItem}
              onClick={() => { setFilter(option) }}>{t(LOG_FILTER_KEY[option])}</button>
          ))}
        </div>
      </div>
      <div className={styles.panelCard}>
        {rows === null
          ? <div className={styles.expandLoading}>{t('loading')}</div>
          : visible.length === 0
            ? <div className={styles.expandLoading}>{t('activityEmpty')}</div>
            : (
              <div className={styles.logList}>
                {visible.map((op, index) => (
                  <div key={index} className={styles.logRow}>
                    <i className={logDotClass(op.op)} aria-hidden="true" />
                    <span className={styles.logTime}>{relTime(t, op.at)}</span>
                    <span className={styles.logOp}>{opLabel(t, op.op)}</span>
                    <span className={styles.logScope}>{op.scope === 'user' ? t('scopeUser') : t('scopeProject')}</span>
                    <span className={styles.logDetail} title={op.detail ?? ''}>{activityDetail(t, op.detail)}</span>
                  </div>
                ))}
              </div>
            )}
      </div>
    </section>
  )
}




function TourProposalCard({ t, scope, project, onSelect }: {
  t: T
  scope: 'user' | 'project' | 'shared'
  
  project: string | null
  onSelect: (id: string) => void
}): React.ReactElement {
  interface Stop { id: string; kind: string; content: string; importance: number; confidence: number }
  interface Proposal { greeting: string; activeCount: number; empty: boolean; suggestedStops: readonly Stop[] }
  const KINDS_FOCUS = ['', 'fact', 'preference', 'decision', 'episode', 'skill'] as const
  const [focusKind, setFocusKind] = usePersistedState<string>('tour.focusKind', '', KINDS_FOCUS)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  useEffect(() => {
    let cancelled = false
    const path = focusKind === ''
      ? `tour-proposal?scope=${scope}`
      : `tour-proposal?scope=${scope}&focusKind=${focusKind}`
    api<Proposal>(path)
      .then((data) => { if (!cancelled) setProposal(data) })
      .catch(() => { if (!cancelled) setProposal({ greeting: t('tourProposalEmpty'), activeCount: 0, empty: true, suggestedStops: [] }) })
    return () => { cancelled = true }
  }, [t, scope, project, focusKind])
  const labelKind = (kind: string): string => {
    if (kind === '') return t('tourFocusAll')
    const key = KIND_KEY[kind]
    return key === undefined ? kind : t(key)
  }
  if (proposal === null) return <div className={styles.expandLoading}>{t('loading')}</div>
  return (
    <div className={styles.tourProposal}>
      <div className={styles.chipRow} role="tablist" aria-label="focus-kind">
        {KINDS_FOCUS.map(kind => (
          <button key={kind || 'all'} type="button" role="tab"
            aria-selected={focusKind === kind}
            className={focusKind === kind ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => { setFocusKind(kind) }}>
            {labelKind(kind)}
          </button>
        ))}
      </div>
      {proposal.empty
        ? <div className={styles.expandLoading}>{t('tourProposalEmpty')}</div>
        : (
          <>
            <p className={styles.tourGreeting}>{proposal.greeting}</p>
            <ol className={styles.tourStops}>
              {proposal.suggestedStops.map((stop, index) => (
                <li key={stop.id}>
                  <button type="button" className={styles.tourStop} onClick={() => { onSelect(stop.id) }}>
                    <span className={styles.tourStopIndex}>{index + 1}</span>
                    <span className={styles.tourStopBody}>
                      <span className={styles.tourStopKind}>{kindLabel(t, stop.kind)}</span>
                      <span className={styles.tourStopText}>{stop.content.length > 60 ? `${stop.content.slice(0, 60)}…` : stop.content}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className={styles.tourHint}>{t('tourProposalHint')}</p>
          </>
        )}
    </div>
  )
}





function RefurbCard({ t, scope, project, onSelect, onAfterAction, toast }: {
  t: T
  scope: 'user' | 'project' | 'shared'
  
  project: string | null
  onSelect: (id: string) => void
  onAfterAction: () => void
  toast: ToastController
}): React.ReactElement {
  interface Suggestion { action: 'merge' | 'demote' | 'review' | 'split'; primaryId: string; candidates: readonly string[]; reason: string; confidence: number }
  interface RefurbReport { count: number; suggestions: readonly Suggestion[] }
  const [report, setReport] = useState<RefurbReport | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = useCallback(() => {
    setBusy(true)
    api<RefurbReport>(`refurb?scope=${scope}`)
      .then((data) => { setReport(data) })
      .catch(() => { setReport({ count: 0, suggestions: [] }) })
      .finally(() => { setBusy(false) })
  }, [scope, project])
  useEffect(() => { reload() }, [reload])
  const labelOf = (action: Suggestion['action']): string => {
    switch (action) {
      case 'demote': return t('refurbActionDemote')
      case 'merge': return t('refurbActionMerge')
      case 'review': return t('refurbActionReview')
      case 'split': return t('refurbActionSplit')
    }
  }
  
  const execute = useCallback((suggestion: Suggestion) => {
    if (suggestion.action === 'review' || suggestion.action === 'split') {
      onSelect(suggestion.primaryId)
      return
    }
    if (suggestion.action === 'demote') {
      if (!window.confirm(t('refurbConfirmDemote'))) return
      setBusy(true)
      api<{ id: string }>('forget', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: suggestion.primaryId,
          scope,
          reason: "Refurbishment checklist downgrade",
          affects: "None",
          stillUseful: "Can be restored using engram_restore",
        }),
      })
        .then(() => {
          reload()
          onAfterAction()
          toast.push('success', t('refurbDemoteDone'))
        })
        .catch((error: Error) => { toast.push('error', t('refurbActionFailed', { msg: error.message })) })
        .finally(() => { setBusy(false) })
      return
    }
    if (suggestion.action === 'merge') {
      const n = suggestion.candidates.length + 1
      if (n < 2) {
        toast.push('warning', t('refurbMergeEmpty'))
        return
      }
      if (!window.confirm(t('refurbConfirmMerge', { n }))) return
      setBusy(true)

      const candidates = [suggestion.primaryId, ...suggestion.candidates]
      api<Record<string, unknown>>('consolidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope, candidates }),
      })
        .then(() => {
          reload()
          onAfterAction()
          toast.push('success', t('refurbMergeDone'))
        })
        .catch((error: Error) => { toast.push('error', t('refurbActionFailed', { msg: error.message })) })
        .finally(() => { setBusy(false) })
    }
  }, [reload, onSelect, onAfterAction, toast, t, scope])
  if (report === null) return <div className={styles.expandLoading}>{t('loading')}</div>
  return (
    <div className={styles.refurb}>
      <div className={styles.refurbHead}>
        <span className={styles.refurbCount}>{t('refurbCount', { n: report.count })}</span>
        <button type="button" className={styles.button} disabled={busy} onClick={reload}>{t('refurbRun')}</button>
      </div>
      {report.count === 0
        ? <div className={styles.expandLoading}>{t('refurbEmpty')}</div>
        : (
          <ul className={styles.refurbList}>
            {report.suggestions.map((suggestion, index) => (
              <li key={`${suggestion.action}-${suggestion.primaryId}-${index}`} className={styles.refurbItem}>
                <button type="button" className={styles.refurbBadge} onClick={() => { onSelect(suggestion.primaryId) }}>
                  {labelOf(suggestion.action)}
                </button>
                <div className={styles.refurbReason}>{suggestion.reason}</div>
                <span className={styles.refurbConfidence}>{(suggestion.confidence * 100).toFixed(0)}%</span>
                <button type="button" className={`${styles.refurbExec} ${styles.button}`} disabled={busy}
                  onClick={() => { execute(suggestion) }}>{t('refurbExecute')}</button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}


interface CorridorGraph {
  readonly nodes: ReadonlyArray<{
    readonly id: string
    readonly scope: string
    readonly kind: string
    readonly status: string
    readonly importance: number
    readonly confidence: number
    readonly title: string
    readonly content?: string
  }>
  readonly edges: ReadonlyArray<{ readonly id: string; readonly from: string; readonly to: string; readonly type: string }>
}

function CorridorPanel({ t, scope, project, onSelect }: {
  t: T
  scope: 'user' | 'project' | 'shared'
  
  project: string | null
  onSelect: (id: string) => void
}): React.ReactElement {
  const [graph, setGraph] = useState<CorridorGraph | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api<CorridorGraph>(`corridor?status=active,archived&scope=${scope}`)
      .then(data => { if (!cancelled) setGraph(data); setFailed(null) })
      .catch((err: Error) => { if (!cancelled) setFailed(err.message) })
    return () => { cancelled = true }
  }, [scope, project])
  if (failed !== null) return <div className={styles.expandLoading}>{t('corridorFailed')}：{failed}</div>
  if (graph === null) return <div className={styles.expandLoading}>{t('corridorLoad')}</div>
  if (graph.nodes.length === 0) return <div className={styles.empty}>{t('corridorEmpty')}</div>
  return <CorridorMap scope={scope} nodes={graph.nodes} edges={graph.edges} onSelect={onSelect} t={t} />
}


interface EpisodeRowView {
  readonly id: string
  readonly kind: string
  readonly content: string
  readonly createdAt: number
}


interface EpisodeGroupsView {
  readonly groups: ReadonlyArray<{
    readonly sessionId: string | null
    readonly summary?: string | undefined
    readonly startedAt: number
    readonly endedAt: number
    readonly episodes: readonly EpisodeRowView[]
  }>
}


interface EpisodeAroundView {
  readonly anchor: EpisodeRowView
  readonly neighbors: readonly EpisodeRowView[]
}





function EpisodeTimelineView({ t, scope, project, reloadTick }: {
  t: T
  scope: 'user' | 'project' | 'shared'
  
  project: string | null
  reloadTick: number
}): React.ReactElement {
  const [sinceDate, setSinceDate] = useState('')
  const [untilDate, setUntilDate] = useState('')
  const [sessionIdInput, setSessionIdInput] = useState('')
  
  const [applied, setApplied] = useState<{ readonly since: string; readonly until: string; readonly sessionId: string }>({ since: '', until: '', sessionId: '' })
  const [data, setData] = useState<EpisodeGroupsView | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  
  const [around, setAround] = useState<EpisodeAroundView | null>(null)
  const [aroundBusy, setAroundBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ scope })

    if (applied.since !== '') params.set('since', String(new Date(`${applied.since}T00:00:00`).getTime()))
    if (applied.until !== '') params.set('until', String(new Date(`${applied.until}T23:59:59.999`).getTime()))
    if (applied.sessionId !== '') params.set('sessionId', applied.sessionId)
    api<EpisodeGroupsView>(`episode-timeline?${params.toString()}`)
      .then(d => { if (!cancelled) { setData(d); setFailed(null) } })
      .catch((err: Error) => { if (!cancelled) setFailed(err.message) })
    return () => { cancelled = true }
  }, [scope, project, applied, reloadTick])

  
  const openAround = (id: string): void => {
    setAroundBusy(true)
    api<EpisodeAroundView>(`episode-timeline?scope=${scope}&around=${encodeURIComponent(id)}`)
      .then(d => { setAround(d); setAroundBusy(false); setFailed(null) })
      .catch((err: Error) => { setFailed(err.message); setAroundBusy(false) })
  }

  
  const renderRow = (row: EpisodeRowView): React.ReactElement => (
    <div key={row.id} className={styles.episodeRow} title={row.id}>
      <time className={styles.episodeRowTime}>{fmtTime(row.createdAt)}</time>
      <span className={styles.episodeRowKind}>{kindLabel(t, row.kind)}</span>
      <span className={styles.episodeRowText}>{row.content}</span>
      <button type="button" className={styles.button} disabled={aroundBusy}
        onClick={() => { openAround(row.id) }}>
        {t('episodeNearby')}
      </button>
    </div>
  )

  return (
    <>
      {}
      <div className={styles.toolbarRow}>
        <input type="date" className={styles.input} value={sinceDate} aria-label={t('episodeSince')}
          onChange={event => { setSinceDate(event.target.value) }} />
        <span className={styles.episodeRangeSep} aria-hidden="true">–</span>
        <input type="date" className={styles.input} value={untilDate} aria-label={t('episodeUntil')}
          onChange={event => { setUntilDate(event.target.value) }} />
        <input className={`${styles.input} ${styles.search}`} placeholder={t('episodeSessionId')} value={sessionIdInput}
          onChange={event => { setSessionIdInput(event.target.value) }} />
        <button type="button" className={`${styles.button} ${styles.primary}`}
          onClick={() => { setApplied({ since: sinceDate, until: untilDate, sessionId: sessionIdInput.trim() }); setAround(null) }}>
          {t('episodeApply')}
        </button>
        <button type="button" className={styles.button}
          onClick={() => {
            setSinceDate(''); setUntilDate(''); setSessionIdInput('')
            setApplied({ since: '', until: '', sessionId: '' }); setAround(null)
          }}>
          {t('episodeReset')}
        </button>
      </div>
      {failed !== null && <div className={styles.expandLoading}>{t('loadFailed', { msg: failed })}</div>}
      {around !== null && (
        <section className={`${styles.panelCard} ${styles.episodeAround}`}>
          <header className={styles.episodeAroundHead}>
            <b>{t('episodeAroundTitle')}</b>
            <button type="button" className={styles.button} onClick={() => { setAround(null) }}>
              {t('episodeClose')}
            </button>
          </header>
          {renderRow(around.anchor)}
          {around.neighbors.length === 0
            ? <p className={styles.sectionHint}>{t('episodeAroundEmpty')}</p>
            : around.neighbors.map(renderRow)}
        </section>
      )}
      {data === null && failed === null && <div className={styles.expandLoading}>{t('loading')}</div>}
      {data !== null && data.groups.length === 0 && <div className={styles.empty}>{t('episodeNoGroups')}</div>}
      {data?.groups.map(group => (
        <section key={group.sessionId ?? 'none'} className={styles.panelCard}>
          <header className={styles.episodeHead}>
            {group.summary === undefined
              ? <p className={`${styles.episodeSummary} ${styles.episodeSummaryMissing}`}>{t('episodeSummaryMissing')}</p>
              : <p className={styles.episodeSummary}>{group.summary}</p>}
            <span className={styles.episodeHeadMeta}>
              {group.sessionId === null ? t('episodeNoSession') : `#${group.sessionId}`}
              {' · '}
              {new Date(group.startedAt).toLocaleDateString()} ~ {new Date(group.endedAt).toLocaleDateString()}
              {' · '}
              {t('episodeEntries', { n: group.episodes.length })}
            </span>
          </header>
          <div>{group.episodes.map(renderRow)}</div>
        </section>
      ))}
    </>
  )
}


interface EntityListItemView {
  readonly entity: {
    readonly id: string
    readonly name: string
    readonly kind: string
    readonly aliases: readonly string[]
  }
  readonly memoryCount: number
}


interface EntityListView {
  readonly items: readonly EntityListItemView[]
  readonly total: number
}


interface EntityDetailView {
  readonly entity: EntityListItemView['entity']
  readonly memories: readonly MemoryRow[]
}


interface FactView {
  readonly id: string
  readonly content: string
  readonly validAt: number
  readonly invalidAt: number | null
  readonly replacedBy: string | null
}


interface EntityFactsView {
  readonly items: readonly FactView[]
  readonly total: number
}


const ENTITY_KIND_KEY: Record<string, EngramKey> = {
  person: 'entityKindPerson',
  project: 'entityKindProject',
  tool: 'entityKindTool',
  concept: 'entityKindConcept',
  other: 'entityKindOther',
}
const ENTITY_KINDS = ['person', 'project', 'tool', 'concept', 'other'] as const


function entityKindLabel(t: T, kind: string): string {
  return t(ENTITY_KIND_KEY[kind] ?? 'entityKindOther')
}





function EntityView({ t, scope, project, reloadTick }: {
  t: T
  scope: 'user' | 'project' | 'shared'
  
  project: string | null
  reloadTick: number
}): React.ReactElement {
  const [kind, setKind] = useState<'all' | (typeof ENTITY_KINDS)[number]>('all')
  const [q, setQ] = useState('')
  const [data, setData] = useState<EntityListView | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  
  const [detail, setDetail] = useState<EntityDetailView | null>(null)
  const [facts, setFacts] = useState<EntityFactsView | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ scope })
    if (kind !== 'all') params.set('kind', kind)
    if (q !== '') params.set('q', q)
    api<EntityListView>(`entities?${params.toString()}`)
      .then(d => { if (!cancelled) { setData(d); setFailed(null) } })
      .catch((err: Error) => { if (!cancelled) setFailed(err.message) })
    return () => { cancelled = true }
  }, [scope, project, kind, q, reloadTick])

  
  const openDetail = (id: string): void => {
    setDetailBusy(true)
    Promise.all([
      api<EntityDetailView>(`entity?scope=${scope}&id=${encodeURIComponent(id)}`),
      api<EntityFactsView>(`facts?scope=${scope}&entityId=${encodeURIComponent(id)}&includeInvalid=1`),
    ])
      .then(([d, f]) => { setDetail(d); setFacts(f); setDetailBusy(false); setFailed(null) })
      .catch((err: Error) => { setFailed(err.message); setDetailBusy(false) })
  }

  
  const renderMemory = (row: MemoryRow): React.ReactElement => (
    <div key={row.id} className={styles.episodeRow} title={row.id}>
      <time className={styles.episodeRowTime}>{fmtTime(row.createdAt)}</time>
      <span className={styles.episodeRowKind}>{kindLabel(t, row.kind)}</span>
      <span className={styles.episodeRowText}>{row.content}</span>
    </div>
  )

  
  const renderFact = (fact: FactView): React.ReactElement => (
    <div key={fact.id} className={styles.episodeRow} title={fact.id}>
      <time className={styles.episodeRowTime}>{new Date(fact.validAt).toLocaleDateString()}</time>
      <span className={styles.episodeRowKind}>{fact.invalidAt === null ? t('factValid') : t('factInvalid')}</span>
      <span className={styles.episodeRowText}>{fact.content}</span>
    </div>
  )

  return (
    <>
      {}
      <div className={styles.chipRow}>
        {([
          ['all', t('entityKindAll')],
          ...ENTITY_KINDS.map(option => [option, t(ENTITY_KIND_KEY[option] ?? 'entityKindOther')] as const),
        ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={kind === value}
            className={kind === value ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => { setKind(value); setDetail(null); setFacts(null) }}>
            {label}
          </button>
        ))}
      </div>
      <div className={styles.toolbarRow}>
        <input className={`${styles.input} ${styles.search}`} placeholder={t('entitySearchPlaceholder')} value={q}
          onChange={event => { setQ(event.target.value.trim()); setDetail(null); setFacts(null) }} />
        {data !== null && <span className={styles.sectionHint}>{t('entityCount', { n: data.total })}</span>}
      </div>
      {failed !== null && <div className={styles.expandLoading}>{t('loadFailed', { msg: failed })}</div>}
      {detail !== null && (
        <section className={`${styles.panelCard} ${styles.episodeAround}`}>
          <header className={styles.episodeAroundHead}>
            <b>{detail.entity.name}</b>
            <span className={styles.episodeRowKind}>{entityKindLabel(t, detail.entity.kind)}</span>
            <button type="button" className={styles.button} onClick={() => { setDetail(null); setFacts(null) }}>
              {t('episodeClose')}
            </button>
          </header>
          {detail.entity.aliases.length > 0 && (
            <p className={styles.sectionHint}>{`${t('entityAliases')}：${detail.entity.aliases.join('、')}`}</p>
          )}
          {detail.memories.length === 0
            ? <p className={styles.sectionHint}>{t('entityNoMemories')}</p>
            : <div>{detail.memories.map(renderMemory)}</div>}
          {facts !== null && (
            <>
              <p className={styles.sectionHint}>{t('factSection', { n: facts.total })}</p>
              {facts.items.length === 0
                ? <p className={styles.sectionHint}>{t('factEmpty')}</p>
                : <div>{facts.items.map(renderFact)}</div>}
            </>
          )}
        </section>
      )}
      {data === null && failed === null && <div className={styles.expandLoading}>{t('loading')}</div>}
      {data !== null && data.items.length === 0 && <div className={styles.empty}>{t('entityEmpty')}</div>}
      {data !== null && data.items.map(item => (
        <div key={item.entity.id} className={styles.episodeRow} title={item.entity.id}>
          <span className={styles.episodeRowKind}>{entityKindLabel(t, item.entity.kind)}</span>
          <span className={styles.episodeRowText}>
            {item.entity.name}
            {item.entity.aliases.length > 0 && (
              <small className={styles.sectionHint}>{`（${item.entity.aliases.join('、')}）`}</small>
            )}
          </span>
          <span className={styles.episodeRowTime}>{t('entityMemories', { n: item.memoryCount })}</span>
          <button type="button" className={styles.button} disabled={detailBusy}
            onClick={() => { openDetail(item.entity.id) }}>
            {t('entityOpen')}
          </button>
        </div>
      ))}
    </>
  )
}


interface BeliefRow {
  readonly id: string
  readonly scope: 'user' | 'project' | 'shared'
  readonly belief: string
  readonly status: 'active' | 'stale' | 'refuted'
  readonly sourceIds: readonly string[]
  readonly proofCount: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastValidatedAt: number
}


const BELIEF_STATUS: Readonly<Record<'active' | 'stale' | 'refuted', { key: EngramKey; pill: 'statusActive' | 'statusArchived' | 'statusForgotten' }>> = {
  active: { key: 'beliefStatusActive', pill: 'statusActive' },
  stale: { key: 'beliefStatusStale', pill: 'statusArchived' },
  refuted: { key: 'beliefStatusRefuted', pill: 'statusForgotten' },
}






function BeliefsView({ t, scope, project, reloadTick }: {
  t: T
  scope: 'user' | 'project' | 'shared'
  
  project: string | null
  reloadTick: number
}): React.ReactElement {
  const [status, setStatus] = useState<'all' | 'active' | 'stale' | 'refuted'>('all')
  const [data, setData] = useState<{ items: readonly BeliefRow[]; total: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  
  const [openId, setOpenId] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<readonly MemoryRow[] | null>(null)
  const [evidenceBusy, setEvidenceBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ scope })
    if (status !== 'all') params.set('status', status)
    api<{ items: readonly BeliefRow[]; total: number }>(`observations?${params.toString()}`)
      .then(d => { if (!cancelled) { setData(d); setFailed(null) } })
      .catch((err: Error) => { if (!cancelled) setFailed(err.message) })
    return () => { cancelled = true }
  }, [scope, project, status, reloadTick])

  
  const toggleEvidence = (row: BeliefRow): void => {
    if (openId === row.id) { setOpenId(null); setEvidence(null); return }
    setOpenId(row.id)
    setEvidence(null)
    setEvidenceBusy(true)
    api<{ items: readonly MemoryRow[] }>(`observation-evidence?scope=${scope}&ids=${encodeURIComponent(row.sourceIds.join(','))}`)
      .then(d => { setEvidence(d.items); setEvidenceBusy(false); setFailed(null) })
      .catch((err: Error) => { setFailed(err.message); setEvidenceBusy(false) })
  }

  return (
    <>
      <div className={styles.chipRow}>
        {([
          ['all', t('beliefStatusAll')],
          ['active', t('beliefStatusActive')],
          ['stale', t('beliefStatusStale')],
          ['refuted', t('beliefStatusRefuted')],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={status === value}
            className={status === value ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            onClick={() => { setStatus(value); setOpenId(null); setEvidence(null) }}>
            {label}
          </button>
        ))}
        {data !== null && <span className={styles.sectionHint}>{t('beliefCount', { n: data.total })}</span>}
      </div>
      {failed !== null && <div className={styles.expandLoading}>{t('loadFailed', { msg: failed })}</div>}
      {data === null && failed === null && <div className={styles.expandLoading}>{t('loading')}</div>}
      {data !== null && data.items.length === 0 && <div className={styles.empty}>{t('beliefNone')}</div>}
      {data !== null && data.items.map(row => (
        <section key={row.id} className={`${styles.panelCard} ${styles.beliefCard}`}>
          <p className={styles.beliefText}>{row.belief}</p>
          <div className={styles.beliefMeta}>
            <span className={`${styles.pill} ${styles[BELIEF_STATUS[row.status].pill]}`}>{t(BELIEF_STATUS[row.status].key)}</span>
            <button type="button" aria-expanded={openId === row.id}
              className={openId === row.id ? `${styles.button} ${styles.chipOn}` : styles.button}
              onClick={() => { toggleEvidence(row) }}>
              {t('beliefEvidence', { n: row.proofCount })}
            </button>
            <time className={styles.beliefTime} title={new Date(row.updatedAt).toLocaleString()}>
              {fmtTime(row.updatedAt)}
            </time>
          </div>
          {openId === row.id && (
            <div className={styles.expand}>
              {evidenceBusy && <div className={styles.expandLoading}>{t('loading')}</div>}
              {evidence !== null && evidence.length === 0 && <div className={styles.expandLoading}>{t('beliefEvidenceEmpty')}</div>}
              {evidence !== null && evidence.map(item => (
                <div key={item.id} className={styles.episodeRow} title={item.id}>
                  <time className={styles.episodeRowTime}>{fmtTime(item.createdAt)}</time>
                  <span className={styles.episodeRowKind}>{kindLabel(t, item.kind)}</span>
                  <span className={styles.episodeRowText}>{item.content}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  )
}


interface HealthReport {
  readonly overall: number
  readonly parts: ReadonlyArray<{
    readonly scope: string
    readonly score: number
    readonly signal: number
    readonly activeRatio: number
    readonly edgeCount: number
    readonly redacted: number
    readonly archivedRatio: number
  }>
  readonly evaluatedAt: number
}


function RoomDirectory({ t, byKind }: { t: T; byKind: Readonly<Record<string, number>> }): React.ReactElement {
  return (
    <div className={styles.roomList}>
      {KINDS.map(kind => (
        <div key={kind} className={styles.roomRow}>
          <span className={`${styles.roomSwatch} ${styles[ROOM_CLASS[kind] ?? ''] ?? ''}`} aria-hidden="true" />
          <span>{kindLabel(t, kind)}</span>
          <b className={styles.roomCount}>{byKind[kind] ?? 0}</b>
        </div>
      ))}
    </div>
  )
}


interface TelemetrySnapshot {
  readonly windowDays: number
  readonly counts: {
    readonly writes: number
    readonly forgets: number
    readonly ingestRequests: number
    readonly ingestDones: number
    readonly distillRequests: number
    readonly consolidations: number
  }
}








function usePalaceOverview(scope: 'user' | 'project' | 'shared', project: string | null): {
  stats: StatsPart['stats'] | null
  byKind: Readonly<Record<string, number>>
  telemetry: TelemetrySnapshot | null
  health: HealthReport | null
  failed: string | null
} {
  const [state, setState] = useState<{
    stats: StatsPart['stats'] | null
    byKind: Readonly<Record<string, number>>
    telemetry: TelemetrySnapshot | null
    health: HealthReport | null
    failed: string | null
  }>({ stats: null, byKind: {}, telemetry: null, health: null, failed: null })
  useEffect(() => {
    let cancelled = false
    Promise.all([

      api<{ parts: StatsPart[] }>(`stats?scope=${scope}`),
      api<TelemetrySnapshot>(`telemetry?days=7&scope=${scope}`),
      api<HealthReport>(`health?scope=${scope}`),
    ])
      .then(([statRes, tele, health]) => {
        if (cancelled) return
        const stats = statRes.parts.find(part => part.scope === scope)?.stats ?? null
        setState({ stats, byKind: stats?.byKind ?? {}, telemetry: tele, health, failed: null })
      })
      .catch((error: Error) => {
        if (!cancelled) setState(current => ({ ...current, failed: error.message }))
      })
    return () => { cancelled = true }
  }, [scope, project])
  return state
}





function TodayHero({ t, overview, dueCount }: { t: T; overview: ReturnType<typeof usePalaceOverview>; dueCount: number }): React.ReactElement {
  const { stats, telemetry, health, failed } = overview
  if (failed !== null) {
    return <section className={styles.panelCard}><div className={styles.expandLoading}>{t('teleFailed')}：{failed}</div></section>
  }
  if (telemetry === null) {
    return <section className={styles.panelCard}><div className={styles.expandLoading}>{t('teleLoading')}</div></section>
  }
  const counts = telemetry.counts
  return (
    <section className={styles.panelCard}>
      <div className={styles.hero}>
        <div className={styles.heroMetrics}>
          <Metric label={t('kpiTotal')} value={stats?.total ?? 0}
            tail={`${t('teleGroupRecent')} +${String(counts.writes)}`} />
          <Metric label={t('kpiActive')} value={stats?.active ?? 0}
            tail={`${t('kpiForgotten')} ${String(stats?.forgotten ?? 0)}`} />
          <Metric label={t('kpiSignal')} value={`${String(Math.round((stats?.signalRatio ?? 0) * 100))}%`}
            tail={t('cardRedacted', { n: stats?.redacted ?? 0 })} />
        </div>
        <HealthRing score={health?.overall ?? 0} />
      </div>
      <div className={styles.heroFoot}>
        {}
        <div className={styles.heroStats}>
          <span className={styles.heroStat}>
            <span className={styles.heroStatLabel}>{t('teleWrites')}</span>
            <span className={styles.heroStatValue}>{counts.writes}</span>
          </span>
          <span className={styles.heroStat}>
            <span className={styles.heroStatLabel}>{t('teleIngest')}</span>
            <span className={styles.heroStatValue}>{counts.ingestRequests}</span>
          </span>
          <span className={styles.heroStat}>
            <span className={styles.heroStatLabel}>{t('teleConsolidate')}</span>
            <span className={styles.heroStatValue}>{counts.consolidations}</span>
          </span>
          {}
          <span className={styles.heroStat}>
            <span className={styles.heroStatLabel}>{t('heroDue')}</span>
            <span className={dueCount > 0 ? `${styles.heroStatValue} ${styles.heroStatDue}` : styles.heroStatValue}>{dueCount}</span>
          </span>
          <span className={styles.heroFootDivider} aria-hidden="true" />
          <span className={styles.sectionHint}>
            {health === null ? t('healthLoading') : t('healthEvaluatedAt', { time: relTime(t, health.evaluatedAt) })}
          </span>
        </div>
        {}
        <span className={styles.telePrivacy} role="note" aria-label={t('telePrivacyHint')} tabIndex={0}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
            <line x1="7" y1="6" x2="7" y2="10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <circle cx="7" cy="4.2" r="0.7" fill="currentColor"/>
          </svg>
          <span className={styles.telePrivacyHint}>{t('telePrivacyHint')}</span>
          <span className={styles.telePrivacyTip} role="tooltip">{t('telePrivacyTip')}</span>
        </span>
      </div>
    </section>
  )
}


interface BackfillEstimateView {
  readonly rules: {
    readonly days: number
    readonly maxTurnsPerSession: number
    readonly maxTotalTurns: number
    readonly includeSubagents: boolean
    readonly includeSeeded: boolean
    readonly includeNoCwd: boolean
  }
  readonly candidates: number
  readonly eligibleTurns: number
  readonly pendingTurns: number
  readonly alreadyIngested: number
  readonly skipped: {
    readonly subagent: number
    readonly seeded: number
    readonly noCwd: number
    readonly tooOld: number
    readonly unreadable: number
  }
  readonly truncated: boolean
  readonly unavailable?: string
}


interface ModelsView {
  readonly providers: readonly { readonly id: string; readonly name: string; readonly models: readonly { readonly id: string; readonly name: string }[] }[]
  readonly failures: readonly string[]
}


interface BackfillStatusView {
  readonly progress: {
    readonly state: 'running' | 'done' | 'cancelled' | 'failed'
    readonly sessionsTotal: number
    readonly sessionsDone: number
    readonly turnsPlanned: number
    readonly turnsDone: number
    readonly memoriesWritten: number
    readonly turnsSkipped: number
    readonly turnsFailed: number
    readonly skipReasons: Readonly<Record<string, number>>
    readonly currentSession?: string
  }
  readonly failures: readonly { readonly sessionId: string; readonly turn: number; readonly reason: string }[]
  readonly error?: string
}


const SKIP_KEY: Record<string, EngramKey> = {
  'low-activity': 'skipLowActivity',
  chitchat: 'skipChitchat',
  'capture-forbidden': 'skipForbidden',
  'no-user-content': 'skipNoContent',
  'already-ingested': 'skipAlready',
  'no-such-turn': 'skipNoTurn',
  'no-previous-turn': 'skipNoTurn',
  'no-route-in-log': 'skipNoRoute',
  unparsable: 'skipUnparsable',
}


function skipLabel(t: T, reason: string): string {
  const key = SKIP_KEY[reason]
  return key === undefined ? reason : t(key)
}





function HistoryBackfillCard({ t, toast }: { t: T; toast: ToastController }): React.ReactElement {
  
  const [days, setDays] = usePersistedState<string>('backfill.days', '7', ['7', '30', '90', '0'])
  const [maxTurns, setMaxTurns] = usePersistedString('backfill.maxTurns', '20')
  const [maxTotal, setMaxTotal] = usePersistedString('backfill.maxTotal', '200')
  const [subagents, setSubagents] = usePersistedState<string>('backfill.subagents', 'false', ['false', 'true'])
  const [seeded, setSeeded] = usePersistedState<string>('backfill.seeded', 'false', ['false', 'true'])
  const [noCwd, setNoCwd] = usePersistedState<string>('backfill.noCwd', 'false', ['false', 'true'])
  
  const [modelChoice, setModelChoice] = usePersistedString('backfill.model', '')
  const [models, setModels] = useState<ModelsView | null>(null)
  const [estimate, setEstimate] = useState<BackfillEstimateView | null>(null)
  const [status, setStatus] = useState<BackfillStatusView | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<ModelsView>('models')
      .then((data) => { if (!cancelled) setModels(data) })
      .catch(() => { if (!cancelled) setModels({ providers: [], failures: [] }) })
    return () => { cancelled = true }
  }, [])

  
  const selection = ((): { provider: string; model: string } | undefined => {
    if (modelChoice === '') return undefined
    const separator = modelChoice.indexOf('::')
    if (separator <= 0) return undefined
    return { provider: modelChoice.slice(0, separator), model: modelChoice.slice(separator + 2) }
  })()

  const params = new URLSearchParams({
    days, maxTurnsPerSession: maxTurns, maxTotalTurns: maxTotal,
    includeSubagents: subagents, includeSeeded: seeded, includeNoCwd: noCwd,
  })
  if (selection !== undefined) {
    params.set('provider', selection.provider)
    params.set('model', selection.model)
  }
  const query = params.toString()

  const reload = useCallback((): void => {
    setBusy(true)
    api<{ estimate: BackfillEstimateView }>(`history-backfill?${query}`)
      .then((data) => { setEstimate(data.estimate) })
      .catch((error: Error) => { toast.push('error', error.message) })
      .finally(() => { setBusy(false) })
  }, [query, toast])
  useEffect(() => { reload() }, [reload])

  const running = status?.progress.state === 'running'
  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      api<BackfillStatusView>('history-backfill/status')
        .then((data) => { if (!cancelled) setStatus(data) })
        .catch(() => {  })
    }
    poll()
    if (!running) return () => { cancelled = true }
    const timer = window.setInterval(poll, 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [running])

  const start = (): void => {
    setBusy(true)
    api<{ ok: boolean; status: BackfillStatusView }>('history-backfill/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        days: Number(days), maxTurnsPerSession: Number(maxTurns), maxTotalTurns: Number(maxTotal),
        includeSubagents: subagents === 'true', includeSeeded: seeded === 'true', includeNoCwd: noCwd === 'true',
        ...(selection === undefined ? {} : { provider: selection.provider, model: selection.model }),
      }),
    })
      .then((data) => { setStatus(data.status) })
      .catch((error: Error) => { toast.push('error', error.message) })
      .finally(() => { setBusy(false) })
  }
  const pause = (): void => {
    api<{ status: BackfillStatusView }>('history-backfill/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
      .then((data) => { setStatus(data.status) })
      .catch((error: Error) => { toast.push('error', error.message) })
  }

  const progress = status?.progress
  const stateLabel = progress === undefined
    ? ''
    : progress.state === 'running' ? t('backfillStateRunning')
      : progress.state === 'done' ? t('backfillStateDone')
        : progress.state === 'cancelled' ? t('backfillStateCancelled')
          : t('backfillStateFailed')
  const percent = progress === undefined || progress.turnsPlanned === 0
    ? 0
    : Math.min(100, Math.round((progress.turnsDone / progress.turnsPlanned) * 100))

  return (
    <div className={styles.backfill}>
      <p className={styles.backfillIntro}>{t('backfillIntro')}</p>

      {}
      <div className={styles.backfillRules}>
        <label className={styles.backfillRule}>
          <span>{t('backfillDays')}</span>
          <select className={styles.input} value={days} onChange={event => { setDays(event.target.value) }}>
            <option value="7">{t('backfillDaysUnit', { n: 7 })}</option>
            <option value="30">{t('backfillDaysUnit', { n: 30 })}</option>
            <option value="90">{t('backfillDaysUnit', { n: 90 })}</option>
            <option value="0">{t('backfillDaysAll')}</option>
          </select>
        </label>
        <label className={styles.backfillRule}>
          <span>{t('backfillMaxTurns')}</span>
          <input className={styles.input} type="number" min={1} max={500} value={maxTurns}
            onChange={event => { setMaxTurns(event.target.value) }} />
        </label>
        <label className={styles.backfillRule}>
          <span>{t('backfillMaxTotal')}</span>
          <input className={styles.input} type="number" min={1} max={5000} value={maxTotal}
            onChange={event => { setMaxTotal(event.target.value) }} />
        </label>
        {}
        <label className={styles.backfillRule}>
          <span>{t('backfillModel')}</span>
          <select className={styles.input} value={modelChoice}
            onChange={event => { setModelChoice(event.target.value) }}>
            <option value="">{t('backfillModelAuto')}</option>
            {(models?.providers ?? []).map(provider => (
              <optgroup key={provider.id} label={provider.name}>
                {provider.models.map(model => (
                  <option key={`${provider.id}::${model.id}`} value={`${provider.id}::${model.id}`}>{model.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.backfillToggles}>
        <label className={styles.backfillToggle}>
          <input type="checkbox" checked={subagents === 'true'}
            onChange={event => { setSubagents(event.target.checked ? 'true' : 'false') }} />
          {t('backfillIncludeSubagents')}
        </label>
        <label className={styles.backfillToggle}>
          <input type="checkbox" checked={seeded === 'true'}
            onChange={event => { setSeeded(event.target.checked ? 'true' : 'false') }} />
          {t('backfillIncludeSeeded')}
        </label>
        <label className={styles.backfillToggle}>
          <input type="checkbox" checked={noCwd === 'true'}
            onChange={event => { setNoCwd(event.target.checked ? 'true' : 'false') }} />
          {t('backfillIncludeNoCwd')}
        </label>
      </div>

      {}
      <div className={styles.backfillEstimate}>
        {estimate === null
          ? <span className={styles.backfillMuted}>{t('backfillEstimating')}</span>
          : estimate.unavailable !== undefined
            ? <span className={styles.backfillMuted}>{estimate.unavailable}</span>
            : (
              <>
                <div className={styles.backfillNumbers}>
                  <span className={styles.backfillMetric}>{t('backfillCandidates', { n: estimate.candidates })}</span>
                  <span className={styles.backfillMetric}>{t('backfillPendingTurns', { n: estimate.pendingTurns })}</span>
                  <span className={styles.backfillMetric}>{t('backfillAlready', { n: estimate.alreadyIngested })}</span>
                </div>
                <div className={styles.backfillMuted}>
                  {t('backfillSkippedDetail', {
                    subagent: estimate.skipped.subagent,
                    seeded: estimate.skipped.seeded,
                    noCwd: estimate.skipped.noCwd,
                    tooOld: estimate.skipped.tooOld,
                    unreadable: estimate.skipped.unreadable,
                  })}
                </div>
                {estimate.truncated && <div className={styles.backfillMuted}>{t('backfillTruncated')}</div>}
              </>
            )}
      </div>

      <div className={styles.backfillActions}>
        <button type="button" className={styles.button} disabled={busy} onClick={reload}>{t('backfillReestimate')}</button>
        <button type="button" className={`${styles.button} ${styles.primary}`}
          disabled={busy || running || estimate === null || estimate.unavailable !== undefined || estimate.pendingTurns === 0}
          onClick={start}>{t('backfillStart')}</button>
        <button type="button" className={styles.button} disabled={!running} onClick={pause}>{t('backfillPause')}</button>
      </div>
      {progress !== undefined && (
        <div className={styles.backfillProgress}>
          <div className={styles.backfillProgressHead}>
            <span>{stateLabel}</span>
            <span>{t('backfillProgressTurns', { done: progress.turnsDone, total: progress.turnsPlanned })}</span>
          </div>
          <div className={styles.progressBar}><i style={{ width: `${String(percent)}%` }} /></div>
          <div className={styles.backfillMeta}>
            <span>{t('backfillProgressSessions', { done: progress.sessionsDone, total: progress.sessionsTotal })}</span>
            <span>{t('backfillWritten', { n: progress.memoriesWritten })}</span>
            <span>{t('backfillTurnsSkipped', { n: progress.turnsSkipped })}</span>
            <span>{t('backfillTurnsFailed', { n: progress.turnsFailed })}</span>
          </div>
          {}
          {Object.keys(progress.skipReasons).length > 0 && (
            <div className={styles.backfillMeta}>
              <span>{t('backfillSkipReasons')}</span>
              {Object.entries(progress.skipReasons).sort(([, a], [, b]) => b - a).map(([reason, count]) => (
                <span key={reason}>{`${skipLabel(t, reason)} ${String(count)}`}</span>
              ))}
            </div>
          )}
          {(status?.failures ?? []).length > 0 && (
            <ul className={styles.backfillFailures}>
              <li className={styles.backfillMuted}>{t('backfillFailures')}</li>
              {status!.failures.slice(0, 3).map((failure, index) => (
                <li key={`${failure.sessionId}-${String(failure.turn)}-${String(index)}`}>
                  {`${failure.sessionId.slice(-12)} · ${String(failure.turn)} · ${failure.reason}`}
                </li>
              ))}
            </ul>
          )}
          {(status?.failures ?? []).length > 0 && (
            <div className={styles.backfillMuted}>{t('backfillRouteHint')}</div>
          )}
          {status?.error !== undefined && <div className={styles.backfillMuted}>{status.error}</div>}
        </div>
      )}
    </div>
  )
}


interface JevPanelView {
  readonly enabled: boolean
  readonly apiKeySet: boolean
  readonly apiKeyMask: string | null
  readonly baseUrl: string
  readonly model: string
  readonly timeoutMs: number
  readonly deferMergeAbove: number
  readonly deferAcceptBelow: number
  readonly contradictMinProbability: number
}






function JevConfigCard({ t, toast }: { t: T; toast: ToastController }): React.ReactElement {
  const [view, setView] = useState<JevPanelView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [timeoutMs, setTimeoutMs] = useState('3000')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<JevPanelView>('jev-config')
      .then((data) => {
        if (cancelled) return
        setView(data)
        setEnabled(data.enabled)
        setBaseUrl(data.baseUrl)
        setModel(data.model)
        setTimeoutMs(String(data.timeoutMs))
      })
      .catch((error: Error) => { if (!cancelled) toast.push('error', `${t('jevLoadFailed')}: ${error.message}`) })
    return () => { cancelled = true }
  }, [t, toast])

  const save = (): void => {
    setBusy(true)
    api<{ ok: boolean; view: JevPanelView }>('jev-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },

      body: JSON.stringify({
        enabled,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        timeoutMs: Number(timeoutMs),
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
      }),
    })
      .then((data) => {
        setView(data.view)
        setApiKey('')
        toast.push('success', t('jevSaved'))
      })
      .catch((error: Error) => { toast.push('error', error.message) })
      .finally(() => { setBusy(false) })
  }

  const clearKey = (): void => {
    setBusy(true)
    api<{ ok: boolean; view: JevPanelView }>('jev-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },

      body: JSON.stringify({ apiKey: '' }),
    })
      .then((data) => { setView(data.view); toast.push('success', t('jevKeyCleared')) })
      .catch((error: Error) => { toast.push('error', error.message) })
      .finally(() => { setBusy(false) })
  }

  const testConnection = (): void => {
    setTesting(true)
    api<{ ok: boolean; elapsedMs: number; probability: number | undefined; error: string | undefined }>('jev-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
      }),
    })
      .then((result) => {
        if (result.ok) toast.push('success', t('jevTestOk', { ms: result.elapsedMs, p: result.probability }))
        else toast.push('error', t('jevTestFail', { error: result.error ?? '' }))
      })
      .catch((error: Error) => { toast.push('error', error.message) })
      .finally(() => { setTesting(false) })
  }

  if (view === null) return <span className={styles.jevMuted}>{t('loading')}</span>

  return (
    <div className={styles.jev}>
      <p className={styles.jevIntro}>{t('jevIntro')}</p>
      <div className={styles.jevToggleRow}>
        <label className={styles.jevToggle}>
          <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
          {t('jevEnabled')}
        </label>
        <span className={styles.jevStatus}>{view.enabled ? t('jevStatusOn') : t('jevStatusOff')}</span>
      </div>
      <div className={styles.jevForm}>
        <label className={styles.jevField}>
          <span>{t('jevApiKey')}</span>
          <input className={styles.input} type="password" value={apiKey} autoComplete="off"
            placeholder={view.apiKeyMask ?? t('jevApiKeyUnset')}
            onChange={event => setApiKey(event.target.value)} />
          <span className={styles.jevMuted}>{t('jevApiKeyHint')}</span>
        </label>
        <label className={styles.jevField}>
          <span>{t('jevBaseUrl')}</span>
          <input className={styles.input} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} />
        </label>
        <label className={styles.jevField}>
          <span>{t('jevModel')}</span>
          <input className={styles.input} value={model} onChange={event => setModel(event.target.value)} />
        </label>
        <label className={styles.jevField}>
          <span>{t('jevTimeoutMs')}</span>
          <input className={styles.input} type="number" min={1000} max={60000} value={timeoutMs}
            onChange={event => setTimeoutMs(event.target.value)} />
        </label>
      </div>
      <div className={styles.jevMuted}>{t('jevThresholdsTitle')}</div>
      <div className={styles.jevMuted}>{t('jevThresholdLine', {
        merge: view.deferMergeAbove,
        accept: view.deferAcceptBelow,
        contradict: view.contradictMinProbability,
      })}</div>
      <div className={styles.jevActions}>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={save}>
          {t('jevSave')}
        </button>
        <button type="button" className={styles.button} disabled={busy || testing} onClick={testConnection}>
          {t('jevTest')}
        </button>
        {view.apiKeySet && (
          <button type="button" className={styles.button} disabled={busy} onClick={clearKey}>
            {t('jevClearKey')}
          </button>
        )}
      </div>
    </div>
  )
}


interface JevObservationView {
  readonly at: number
  readonly site: 'band' | 'contradiction'
  readonly question: string
  readonly answered: boolean
  readonly probability: number | undefined
  readonly elapsedMs: number
  readonly error: string | undefined
  readonly verdict: 'merge' | 'accept' | 'defer' | 'confirm' | 'reject' | 'fallback'
}


const VERDICT_KEY: Readonly<Record<JevObservationView['verdict'], EngramKey>> = {
  merge: 'jevObsVerdictMerge',
  accept: 'jevObsVerdictAccept',
  defer: 'jevObsVerdictDefer',
  confirm: 'jevObsVerdictConfirm',
  reject: 'jevObsVerdictReject',
  fallback: 'jevObsVerdictFallback',
}





function JevObservationsCard({ t, toast }: { t: T; toast: ToastController }): React.ReactElement {
  const [items, setItems] = useState<readonly JevObservationView[] | null>(null)

  useEffect(() => {
    let cancelled = false

    const reload = (reportFailure: boolean): void => {
      api<{ items: readonly JevObservationView[] }>('jev-observations')
        .then((data) => { if (!cancelled) setItems(data.items) })
        .catch((error: Error) => {
          if (cancelled) return
          setItems(previous => previous ?? [])
          if (reportFailure) toast.push('error', `${t('jevObsLoadFailed')}: ${error.message}`)
        })
    }
    reload(true)
    const timer = window.setInterval(() => reload(false), 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [t, toast])

  if (items === null) return <span className={styles.jevMuted}>{t('loading')}</span>
  if (items.length === 0) return <span className={styles.jevMuted}>{t('jevObsEmpty')}</span>

  return (
    <div className={styles.jevObs}>
      <div className={styles.jevObsHead}>{t('jevObsTitle')}</div>
      {items.map((item, index) => (
        <div key={`${item.at}-${item.site}-${index}`} className={styles.jevObsItem}>
          <span className={styles.jevObsTime}>{new Date(item.at).toLocaleTimeString()}</span>
          <span>{item.site === 'band' ? t('jevObsSiteBand') : t('jevObsSiteContradiction')}</span>
          <span className={item.verdict === 'fallback'
            ? styles.jevObsBadgeWarn
            : item.verdict === 'confirm' || item.verdict === 'merge' ? styles.jevObsBadgeGood : styles.jevObsBadge}>
            {t(VERDICT_KEY[item.verdict])}
          </span>
          <span>{item.answered ? `p=${item.probability?.toFixed(3)}` : t('jevObsNoAnswer')}</span>
          <span>{item.elapsedMs}ms</span>
          {item.error !== undefined && <span className={styles.jevObsError}>{t('jevObsErrorLine', { error: item.error })}</span>}
        </div>
      ))}
    </div>
  )
}



function ExportMenu({ t, scope, project }: {
  t: T
  scope: 'user' | 'project' | 'shared'
  
  project: string | null
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent): void => {
      if (wrapRef.current === null || !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => { window.removeEventListener('mousedown', handler) }
  }, [open])
  const projectQuery = scope === 'project' && project !== null ? `&project=${encodeURIComponent(project)}` : ''
  const options: Array<{ label: string; hint: string; href: string }> = [
    { label: t('exportMd'), hint: t('exportMdHint'), href: `/api/engram/export?scope=${scope}${projectQuery}&format=markdown` },
    { label: t('exportJson'), hint: t('exportJsonHint'), href: `/api/engram/export?scope=${scope}${projectQuery}&format=json` },
    { label: t('exportMirror'), hint: t('exportMirrorHint'), href: `/api/engram/mirror?scope=${scope}${projectQuery}` },
  ]
  return (
    <div className={styles.exportWrap} ref={wrapRef}>
      <button type="button" className={styles.button} aria-haspopup="menu" aria-expanded={open}
        title={t('export')} aria-label={t('export')}
        onClick={() => { setOpen(value => !value) }}>
        <Icon name="export" className={styles.brandIcon} />
        <span className={styles.exportCaret} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={styles.exportMenu} role="menu">
          {options.map(option => (
            <a key={option.href} role="menuitem" className={styles.exportItem} href={option.href}
              onClick={() => { setOpen(false) }}>
              <span className={styles.exportItemLabel}>{option.label}</span>
              <span className={styles.exportItemHint}>{option.hint}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}


export type EngramSectionProps = PropsLocale<typeof NS> & {
  
  readonly workspaces?: WorkspacesLike | undefined
  
  readonly sessions?: SessionsLike | undefined
}


export function EngramSection({ t: hostT, workspaces, sessions }: EngramSectionProps): React.ReactElement {
  const toast = useToast()
  
  const [lang, setLang] = usePersistedState<'zh' | 'en'>('library.lang', hostT('scopeUser') === zh.scopeUser ? 'zh' : 'en', ['zh', 'en'])
  const t = useMemo<T>(() => makeT(lang), [lang])
  
  const [scope, setScope] = usePersistedState<'user' | 'project' | 'shared'>('library.scope', 'user', ['user', 'project', 'shared'])
  
  const [status, setStatus] = usePersistedState<string>('library.status', 'all', ['all', 'active', 'archived', 'forgotten'])
  const [kind, setKind] = usePersistedState<string>('library.kind', 'all', ['all', 'fact', 'preference', 'decision', 'episode', 'skill'])
  const [q, setQ] = usePersistedString('library.q', '')
  
  const [sort, setSort] = usePersistedState<'time' | 'tour'>('library.sort', 'time', ['time', 'tour'])
  
  const [dueCount, setDueCount] = useState(0)
  const [dueIds, setDueIds] = useState<ReadonlySet<string>>(new Set())
  
  const [dueOnly, setDueOnly] = useState(false)
  
  const [redacted] = useState('all')
  const [offset, setOffset] = useState(0)
  const [list, setList] = useState<ListResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  const [expanded, setExpanded] = useState<{ kind: 'review' | 'edit'; record: MemoryRow } | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  
  const [confirmForget, setConfirmForget] = useState(false)
  
  const [activeTab, setActiveTab] = useState<'today' | 'library' | 'corridor' | 'episodes' | 'entities' | 'beliefs' | 'log' | 'backfill' | 'jev'>('today')
  
  const [projectMode, setProjectMode] = usePersistedString('library.project', 'follow')
  
  const currentWorkspace = useCurrentWorkspace(workspaces, sessions)
  const [workspaceList, setWorkspaceList] = useState<EngramWorkspacesView | null>(null)
  const workspaceId = currentWorkspace.workspace?.workspaceId ?? ''

  
  useEffect(() => {
    let cancelled = false
    api<EngramWorkspacesView>('workspaces')
      .then((data) => { if (!cancelled) setWorkspaceList(data) })
      .catch(() => {  })
    return () => { cancelled = true }
  }, [workspaceId, projectMode, reloadTick])

  
  const followedProject = matchFollowTarget(workspaceList, currentWorkspace.workspace)
  
  const projectSelector = projectMode === 'follow' ? followedProject?.dbName ?? null : projectMode

  activeProjectSelector = projectSelector
  
  const pinnedMissing = projectMode !== 'follow'
    && !(workspaceList?.items ?? []).some(item => item.dbName === projectMode)

  
  const overview = usePalaceOverview(scope, projectSelector)

  const reload = useCallback((): void => { setReloadTick(tick => tick + 1) }, [])

  
  const healingRef = useRef(false)
  useEffect(() => {
    healDeadProject = (): void => {

      if (healingRef.current || projectMode === 'follow') return
      healingRef.current = true
      setProjectMode('follow')
      setOffset(0)
      setExpanded(null)
      setSelected(new Set())
      reload()
    }
    return () => { healDeadProject = null }
  }, [projectMode, reload])
  useEffect(() => {
    if (projectMode === 'follow') healingRef.current = false
  }, [projectMode])

  
  const refreshDue = useCallback((): void => {
    api<{ items: readonly { id: string }[] }>(`review-due?scope=${scope}&limit=50`)
      .then(data => {
        setDueCount(data.items.length)
        setDueIds(new Set(data.items.map(item => item.id)))
      })
      .catch(() => { setDueCount(0); setDueIds(new Set()) })
  }, [scope, projectSelector])
  useEffect(() => { refreshDue() }, [refreshDue])

  
  const goToDue = (): void => {
    setActiveTab('library')
    setDueOnly(true)
  }

  
  const openReview = useCallback((id: string): void => {
    const record = list?.records.find(row => row.id === id)
    setExpanded({
      kind: 'review',
      record: record ?? ({
        id: id as never, scope, kind: 'fact', content: '', importance: 0.5, confidence: 0.5,
        status: 'active', createdAt: Date.now(), accessCount: 0, sourceSessionId: null, sourceRound: null,
      } as MemoryRow),
    })
  }, [list, scope])

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({
      scope, status, kind, redacted, limit: String(PAGE_SIZE), offset: String(offset),
    })
    if (q !== '') qs.set('q', q)
    if (sort === 'tour') qs.set('sort', 'tour')
    api<ListResult>(`list?${qs.toString()}`)
      .then((data) => { if (!cancelled) { setList(data); setError(null) } })
      .catch((loadError: Error) => { if (!cancelled) setError(loadError.message) })
    return () => { cancelled = true }
  }, [scope, status, kind, redacted, q, sort, offset, reloadTick, projectSelector])

  
  const lastProject = useRef(projectSelector)
  useEffect(() => {
    if (lastProject.current === projectSelector) return
    lastProject.current = projectSelector
    setOffset(0)
    setExpanded(null)
    setSelected(new Set())
  }, [projectSelector])

  const act = (route: string, record: MemoryRow): void => {
    api(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: record.id, scope: record.scope }),
    })
      .then(reload)
      .catch((actError: Error) => { toast.push('error', actError.message) })
  }

  const toggle = (expandKind: 'review' | 'edit', record: MemoryRow): void => {
    setExpanded(current => (current !== null && current.kind === expandKind && current.record.id === record.id)
      ? null
      : { kind: expandKind, record })
  }

  const allRecords = list?.records ?? []

  const pageRecords = dueOnly ? allRecords.filter(record => dueIds.has(record.id)) : allRecords
  const selectedRecords = pageRecords.filter(record => selected.has(record.id))
  const forgetable = selectedRecords.filter(record => record.status === 'active').length
  const restorable = selectedRecords.length - forgetable
  const allSelected = pageRecords.length > 0 && pageRecords.every(record => selected.has(record.id))

  const toggleSelect = (id: string): void => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = (): void => { setSelected(new Set()); setConfirmForget(false) }

  const toggleAllPage = (): void => {
    setSelected(current => {
      const next = new Set(current)
      if (allSelected) pageRecords.forEach(record => next.delete(record.id))
      else pageRecords.forEach(record => next.add(record.id))
      return next
    })
  }

  
  const runBatch = (mode: 'forget' | 'restore'): void => {
    const targets = mode === 'forget'
      ? selectedRecords.filter(record => record.status === 'active')
      : selectedRecords.filter(record => record.status !== 'active')
    if (targets.length === 0) return
    void Promise.allSettled(targets.map(target => api(mode, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: target.id, scope: target.scope }),
    }))).then(() => { clearSelection(); reload() })
  }

  const armBatchForget = (): void => {

    if (confirmForget) { runBatch('forget'); return }
    setConfirmForget(true)
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = list === null ? 1 : Math.max(1, Math.ceil(list.total / PAGE_SIZE))
  
  const segRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map())
  const [segIndicator, setSegIndicator] = useState<{ left: number; width: number; opacity: number }>({ left: 0, width: 0, opacity: 0 })
  const measureSeg = useCallback((): void => {
    const node = segRefs.current.get(scope)
    if (node === null || node === undefined) return
    setSegIndicator({ left: node.offsetLeft, width: node.offsetWidth, opacity: 1 })
  }, [scope])
  useEffect(() => {
    measureSeg()
    const onResize = (): void => measureSeg()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [measureSeg])

  return (
    <div className={styles.panel}>
      {}
      {
}
      {expanded !== null && (
        <>
          <div className={styles.drawerScrim} onClick={() => { setExpanded(null) }} />
          <div className={styles.drawerLayer}>
            <aside className={styles.drawer} role="dialog" aria-label={t('drawerTitle')}>
              <header className={styles.drawerHead}>
                <div className={styles.drawerTitle}>
                  <h3>{t('drawerTitle')}</h3>
                  <span title={expanded.record.id}>
                    {`#${expanded.record.id.slice(0, 8)}…`}
                  </span>
                </div>
                <button type="button" className={styles.drawerClose} aria-label={t('drawerClose')}
                  onClick={() => { setExpanded(null) }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M2 2 L12 12 M12 2 L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </button>
              </header>
              <div className={styles.drawerBody}>
                {expanded.kind === 'review'
                  ? <ReviewBody t={t} recordId={expanded.record.id} scope={expanded.record.scope} project={projectSelector} />
                  : <EditForm t={t} record={expanded.record} onClose={() => { setExpanded(null) }}
                      onSaved={() => { setExpanded(null); reload() }} toast={toast} />}
              </div>
            </aside>
          </div>
        </>
      )}
      {
}
      <div className={styles.header}>
        <div className={styles.headerActions}>
          <div className={`${styles.segGroup} ${styles.segScope}`}>
            <span className={styles.segIndicator}
              style={{ left: `${String(segIndicator.left)}px`, width: `${String(segIndicator.width)}px`, opacity: segIndicator.opacity }} />
            {(['user', 'project', 'shared'] as const).map(option => (
              <button key={option} type="button" ref={node => { segRefs.current.set(option, node) }}
                className={scope === option ? `${styles.segItem} ${styles.on}` : styles.segItem}
                onClick={() => { setScope(option); setOffset(0); setExpanded(null); clearSelection() }}>
                <Icon name={option === 'user' ? 'user' : option === 'project' ? 'project' : 'shared'} className={styles.scopeIcon} />
                {t(SCOPE_KEY[option])}
              </button>
            ))}
          </div>
          {}
          {scope === 'project' && (
            <select className={`${styles.input} ${styles.wsSelect}`} value={projectMode}
              aria-label={t('projectSwitch')} title={t('projectSwitch')}
              onChange={event => { setProjectMode(event.target.value); setOffset(0); setExpanded(null); clearSelection() }}>
              <option value="follow">{t('projectFollow')}</option>
              {(workspaceList?.items ?? []).map(item => (
                <option key={item.dbName} value={item.dbName}>{projectOptionLabel(t, item)}</option>
              ))}
              {pinnedMissing && (
                <option value={projectMode}>{`${shortDbName(projectMode)} · ${t('projectUnregistered')}`}</option>
              )}
            </select>
          )}
        </div>
        <div className={styles.headerActions}>
          {}
          {dueCount > 0 && (
            <button type="button" className={styles.dueBadge}
              title={t('dueBadgeLabel', { n: dueCount })} aria-label={t('dueBadgeLabel', { n: dueCount })}
              onClick={goToDue}>
              <Icon name="clock" className={styles.dueIcon} />
              {dueCount}
            </button>
          )}
          <button type="button" className={styles.button} title={t('refresh')} aria-label={t('refresh')}
            onClick={() => { reload(); refreshDue() }}>
            <Icon name="refresh" className={styles.brandIcon} />
          </button>
          {}
          <div className={styles.langSeg} role="group" aria-label="Language">
            <button type="button" className={lang === 'zh' ? `${styles.langOpt} ${styles.langOn}` : styles.langOpt}
              onClick={() => { setLang('zh') }}>Default</button>
            <button type="button" className={lang === 'en' ? `${styles.langOpt} ${styles.langOn}` : styles.langOpt}
              onClick={() => { setLang('en') }}>EN</button>
          </div>
          <ExportMenu t={t} scope={scope} project={projectSelector} />
        </div>
      </div>

      {
}
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab"
          className={activeTab === 'today' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'today'}
          onClick={() => { setActiveTab('today') }}>
          <Icon name="today" className={styles.tabIcon} />
          {t('tabToday')}
        </button>
        <button type="button" role="tab"
          className={activeTab === 'library' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'library'}
          onClick={() => { setActiveTab('library') }}>
          <Icon name="library" className={styles.tabIcon} />
          {t('tabLibrary')}
        </button>
        <button type="button" role="tab"
          className={activeTab === 'corridor' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'corridor'}
          onClick={() => { setActiveTab('corridor') }}>
          <Icon name="corridor" className={styles.tabIcon} />
          {t('tabCorridor')}
        </button>
        <button type="button" role="tab"
          className={activeTab === 'episodes' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'episodes'}
          onClick={() => { setActiveTab('episodes') }}>
          <Icon name="episodes" className={styles.tabIcon} />
          {t('tabEpisodes')}
        </button>
        <button type="button" role="tab"
          className={activeTab === 'entities' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'entities'}
          onClick={() => { setActiveTab('entities') }}>
          <Icon name="entities" className={styles.tabIcon} />
          {t('tabEntities')}
        </button>
        <button type="button" role="tab"
          className={activeTab === 'beliefs' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'beliefs'}
          onClick={() => { setActiveTab('beliefs') }}>
          <Icon name="beliefs" className={styles.tabIcon} />
          {t('tabBeliefs')}
        </button>
        <button type="button" role="tab"
          className={activeTab === 'log' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'log'}
          onClick={() => { setActiveTab('log') }}>
          <Icon name="log" className={styles.tabIcon} />
          {t('tabLog')}
        </button>
        <button type="button" role="tab"
          className={activeTab === 'backfill' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'backfill'}
          onClick={() => { setActiveTab('backfill') }}>
          <Icon name="backfill" className={styles.tabIcon} />
          {t('tabBackfill')}
        </button>
        <button type="button" role="tab"
          className={activeTab === 'jev' ? `${styles.tabItem} ${styles.on}` : styles.tabItem}
          aria-selected={activeTab === 'jev'}
          onClick={() => { setActiveTab('jev') }}>
          <Icon name="jev" className={styles.tabIcon} />
          {t('tabJev')}
        </button>
      </div>

      {activeTab === 'library' && (
        <div className={styles.tabPanel}>
          <div className={styles.sectionHead}>
            <h4 className={styles.sectionTitle}>{t('tabLibrary')}</h4>
          </div>
          {}
          <div className={styles.toolbarRow}>
            <input className={`${styles.input} ${styles.search}`} placeholder={t('searchPlaceholder')} value={q}
              onChange={event => { setQ(event.target.value.trim()); setOffset(0); setExpanded(null); clearSelection() }} />
            <div className={styles.segGroup}>
              {([
                ['all', t('allStatuses')],
                ['active', t('statusActive')],
                ['archived', t('statusArchived')],
                ['forgotten', t('statusForgotten')],
              ] as const).map(([value, label]) => (
                <button key={value} type="button"
                  className={status === value ? `${styles.segItem} ${styles.on}` : styles.segItem}
                  onClick={() => { setStatus(value); setOffset(0); setExpanded(null); clearSelection() }}>
                  {label}
                </button>
              ))}
            </div>
            {}
            <div className={styles.segGroup}>
              <button type="button" aria-pressed={dueOnly}
                className={dueOnly ? `${styles.segItem} ${styles.on}` : styles.segItem}
                onClick={() => { setDueOnly(!dueOnly); setOffset(0); setExpanded(null); clearSelection() }}>
                {t('filterDueToday')}
              </button>
            </div>
            <div className={styles.segGroup}>
              {([['time', t('sortTime')], ['tour', t('sortTour')]] as const).map(([value, label]) => (
                <button key={value} type="button"
                  className={sort === value ? `${styles.segItem} ${styles.on}` : styles.segItem}
                  onClick={() => { setSort(value); setOffset(0); setExpanded(null); clearSelection() }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.chipRow}>
            {([
              ['all', t('allKinds')],
              ...KINDS.map(option => [option, kindLabel(t, option)] as const),
            ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={kind === value}
                className={kind === value ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                onClick={() => { setKind(value); setOffset(0); setExpanded(null); clearSelection() }}>
                {label}
              </button>
            ))}
          </div>

          {selected.size > 0 && (
            <div className={styles.batchBar}>
              <span>{t('selectedCount', { n: selected.size })}</span>
              <button type="button" className={styles.button} onClick={toggleAllPage}>
                {allSelected ? t('deselectAll') : t('selectAll')}
              </button>
              <button type="button" className={styles.button} disabled={restorable === 0}
                onClick={() => runBatch('restore')}>{t('batchRestore', { n: restorable })}</button>
              <button type="button"
                className={confirmForget ? `${styles.button} ${styles.danger}` : styles.button}
                disabled={forgetable === 0}
                onClick={armBatchForget}>
                {confirmForget ? t('batchForgetConfirm', { n: forgetable }) : t('batchForget', { n: forgetable })}
              </button>
              <button type="button" className={styles.button} onClick={clearSelection}>{t('clearSelection')}</button>
            </div>
          )}

          {error !== null && (
            <div className={styles.empty}>
              <b>{t('loadFailed', { msg: error })}</b>
              <span>{t('emptyHint')}</span>
            </div>
          )}
          {error === null && list === null && (
            <div className={styles.skeletonList}>
              {[0, 1, 2, 3].map(index => (
                <div key={index} className={styles.skeleton} style={{ animationDelay: `${String(index * 60)}ms` }}><i /><i /><i /></div>
              ))}
            </div>
          )}
          {error === null && list !== null && pageRecords.length === 0 && (
            <div className={styles.empty}>
              <b>{t('empty')}</b>
              <span>{t('emptyHint')}</span>
            </div>
          )}

          {pageRecords.length > 0 && (
            <div className={styles.itemList}>
              {pageRecords.map((record, index) => (
                <div key={record.id}
                  className={selected.has(record.id) ? `${styles.item} ${styles.selected}` : styles.item}
                  style={{ animationDelay: `${String(Math.min(index, 12) * 36)}ms` }}>
                  <input type="checkbox" className={styles.itemCheck} checked={selected.has(record.id)}
                    aria-label={record.content.slice(0, 24)} onChange={() => toggleSelect(record.id)} />
                  <div className={styles.itemBody}>
                    <div className={styles.itemTags}>
                      <span className={`${styles.pill} ${styles[`status${record.status.charAt(0).toUpperCase()}${record.status.slice(1)}`] ?? ''}`}>{t(STATUS_KEY[record.status])}</span>
                      <span className={roomPillClass(record.kind)}>{kindLabel(t, record.kind)}</span>
                      {record.slot !== undefined && (
                        <span className={styles.pill}>{displayRoom(record.slot.room)}#{record.slot.index}</span>
                      )}
                      {record.content.includes('[REDACTED:') && (
                        <span className={`${styles.pill} ${styles.redacted}`}>{t('tagRedacted')}</span>
                      )}
                      {record.outcome !== undefined && (
                        <span className={`${styles.pill} ${record.outcome === 'success' ? styles.outcomeSuccess : styles.outcomeFailure}`}>
                          {record.outcome === 'success' ? t('tagOutcomeSuccess') : t('tagOutcomeFailure')}
                        </span>
                      )}
                      <span className={styles.itemStamp} title={fmtTime(record.createdAt)}>
                        {t(SCOPE_KEY[record.scope])} · {relTime(t, record.createdAt)}
                      </span>
                    </div>
                    <div className={styles.content}>{record.content}</div>
                    <div className={styles.itemMeta}>
                      <span><b>{t('importance')}</b> {record.importance.toFixed(2)}</span>
                      <span><b>{t('confidence')}</b> {record.confidence.toFixed(2)}</span>
                      <span>{t('accessCount', { n: record.accessCount })}</span>
                      <span>{sourceLabel(t, record)}</span>
                    </div>
                  </div>
                  <div className={styles.itemOps}>
                    <button type="button" className={styles.button}
                      onClick={() => { toggle('review', record) }}>{t('detail')}</button>
                    <button type="button" className={styles.button}
                      onClick={() => { toggle('edit', record) }}>{t('edit')}</button>
                    {record.status === 'active'
                      ? <button type="button" className={styles.button}
                          onClick={() => { act('forget', record) }}>{t('forget')}</button>
                      : <button type="button" className={styles.button}
                          onClick={() => { act('restore', record) }}>{t('restore')}</button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.pager}>
            <button type="button" className={styles.button} disabled={offset === 0} aria-label={t('prevPage')}
              onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setExpanded(null); clearSelection() }}>‹</button>
            <span>{t('pagerInfo', { page, pages, total: list?.total ?? 0 })}</span>
            <button type="button" className={styles.button} disabled={list === null || offset + PAGE_SIZE >= list.total}
              aria-label={t('nextPage')}
              onClick={() => { setOffset(offset + PAGE_SIZE); setExpanded(null); clearSelection() }}>›</button>
          </div>
        </div>
      )}

      {activeTab === 'today' && (
        <div className={styles.tabPanel}>
          {}
          <TodayHero t={t} overview={overview} dueCount={dueCount} />
          <div className={styles.layout}>
            {
}
            <div className={styles.mainCol}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h4 className={styles.sectionTitle}>{t('tourProposalTitle')}</h4>
                </div>
                <div className={styles.panelCard}>
                  <TourProposalCard t={t} scope={scope} project={projectSelector} onSelect={openReview} />
                </div>
              </section>
            </div>
            <aside className={styles.sideCol}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h4 className={styles.sectionTitle}>{t('profileTitle')}</h4>
                </div>
                <div className={styles.panelCard}>
                  <ProfileCard t={t} scope={scope} project={projectSelector} />
                </div>
              </section>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h4 className={styles.sectionTitle}>{t('roomsTitle')}</h4>
                  <span className={styles.sectionHint}>{t('roomsHint')}</span>
                </div>
                <div className={styles.panelCard}>
                  <RoomDirectory t={t} byKind={overview.byKind} />
                </div>
              </section>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h4 className={styles.sectionTitle}>{t('refurbTitle')}</h4>
                </div>
                <div className={styles.panelCard}>
                  <RefurbCard t={t} scope={scope} project={projectSelector} onSelect={openReview} onAfterAction={reload} toast={toast} />
                </div>
              </section>
            </aside>
          </div>
        </div>
      )}

      {activeTab === 'corridor' && (
        <div className={styles.tabPanel}>
          {}
          <div className={styles.mainCol}>
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h4 className={styles.sectionTitle}>{t('sectionCorridor')}</h4>
              </div>
              <div className={styles.panelCard}>
                <CorridorPanel t={t} scope={scope} project={projectSelector} onSelect={openReview} />
              </div>
            </section>
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h4 className={styles.sectionTitle}>{t('benchTitle')}</h4>
                <span className={styles.sectionHint}>{t('benchNote')}</span>
              </div>
              <div className={styles.panelCard}>
                <RecallBench t={t} scope={scope} />
              </div>
            </section>
          </div>
        </div>
      )}

      {activeTab === 'episodes' && (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{t('tabEpisodes')}</h4>
              <span className={styles.sectionHint}>{t('episodeHint')}</span>
            </div>
            <EpisodeTimelineView t={t} scope={scope} project={projectSelector} reloadTick={reloadTick} />
          </section>
        </div>
      )}

      {activeTab === 'entities' && (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{t('tabEntities')}</h4>
              <span className={styles.sectionHint}>{t('entityHint')}</span>
            </div>
            <EntityView t={t} scope={scope} project={projectSelector} reloadTick={reloadTick} />
          </section>
        </div>
      )}

      {activeTab === 'beliefs' && (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{t('tabBeliefs')}</h4>
              <span className={styles.sectionHint}>{t('beliefHint')}</span>
            </div>
            <BeliefsView t={t} scope={scope} project={projectSelector} reloadTick={reloadTick} />
          </section>
        </div>
      )}

      {activeTab === 'log' && (
        <div className={styles.tabPanel}>
          <LogPanel t={t} telemetry={overview.telemetry} project={projectSelector} />
        </div>
      )}

      {activeTab === 'backfill' && (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{t('backfillRulesTitle')}</h4>
            </div>
            <div className={styles.panelCard}>
              <HistoryBackfillCard t={t} toast={toast} />
            </div>
          </section>
        </div>
      )}

      {activeTab === 'jev' && (
        <div className={styles.tabPanel}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h4 className={styles.sectionTitle}>{t('tabJev')}</h4>
            </div>
            <div className={styles.panelCard}>
              <JevConfigCard t={t} toast={toast} />
            </div>
          </section>
          <section className={styles.section}>
            <div className={styles.panelCard}>
              <JevObservationsCard t={t} toast={toast} />
            </div>
          </section>
        </div>
      )}

      {}
      {toast.viewport}
    </div>
  )
}








export function bindEngramSection(services: {
  readonly workspaces: () => WorkspacesLike | undefined
  readonly sessions: () => SessionsLike | undefined
}): (props: PropsLocale<typeof NS>) => React.ReactElement {
  return function EngramSectionBound(props: PropsLocale<typeof NS>): React.ReactElement {
    return <EngramSection {...props} workspaces={services.workspaces()} sessions={services.sessions()} />
  }
}
