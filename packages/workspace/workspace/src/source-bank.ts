/** Reversible source selection over immutable evidence, committed by the running host. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defineDomain, domainTable, type DomainFacility, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ArtifactRevision, ArtifactRevisionId, ArtifactRelation, WorkspaceId } from './types.ts'
import type { SourceStatus, SourceSelection, SourceBankItem, SourceBankRequest, SourceBankResult,
  CurateSourcesRequest, CurateSourcesResult, CheckSourcesRequest, CheckSourcesResult } from './source-bank-types.ts'

const selectionSchema = z.object({
  status: z.enum(['active', 'discovery', 'archived', 'removed']), reason: z.string(),
  replacementId: z.string().transform(value => value as ArtifactRevisionId).optional(),
})
const stateSchema = z.object({
  projectId: z.string().transform(value => value as WorkspaceId),
  selections: z.record(z.string(), selectionSchema),
})
const domain = defineDomain({ name: 'project_source_bank', version: 1,
  tables: { projects: domainTable<WorkspaceId, z.infer<typeof stateSchema>>(stateSchema) } })
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Library policy never changes an evidence revision or a citation offset. */
export class SourceBank {
  private table?: KvTable<WorkspaceId, z.infer<typeof stateSchema>>
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly evidence: () => readonly ArtifactRevision[],
    private readonly read: (id: ArtifactRevisionId) => ArtifactRevision,
    private readonly related: (id: ArtifactRevisionId) => readonly ArtifactRelation[]) {}

  /** Open an additive domain; existing evidence storage requires no migration.
   * @param storage - Host-owned domain facility.
   * @returns Disposer that drains pending writes and closes the domain. */
  async open(storage: DomainFacility): Promise<() => Promise<void>> {
    const opened = await storage.open(domain)
    this.table = opened.table('projects')
    return async () => { await this.tail; await opened.close() }
  }

  /** Classify discovery records separately, while explicit user selection wins.
   * @param artifact - Retained source revision.
   * @returns Current identity-level library membership. */
  selection(artifact: ArtifactRevision): SourceSelection {
    const selections = this.requireTable().get(artifact.projectId)?.selections
    const selected = selections !== undefined && Object.hasOwn(selections, artifact.path) ? selections[artifact.path] : undefined
    return selected ?? { status: /^source:(?:search:|https?:\/\/export\.arxiv\.org\/api\/query)/u.test(artifact.path)
      ? 'discovery' : 'active', reason: '' }
  }

  /** Enumerate the complete bank without inheriting the lexical-search result cap.
   * @param request - Project, selected memberships and pagination cursor.
   * @returns Full-bank totals and one bounded metadata page. */
  list(request: SourceBankRequest): SourceBankResult {
    const snapshot = this.snapshot(request.projectId)
    const limit = request.limit ?? 100
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Source page limit must be 1–200')
    let offset = 0
    const filter = digest(request.statuses ?? null)
    if (request.cursor !== undefined) {
      const cursor = JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8')) as { version: string; filter: string; offset: number }
      if (cursor.version !== snapshot.version || cursor.filter !== filter) throw new Error('Source bank changed; restart pagination')
      if (!Number.isInteger(cursor.offset) || cursor.offset < 0) throw new Error('Invalid source cursor')
      offset = cursor.offset
    }
    const matches = snapshot.items.filter(item => request.statuses === undefined || request.statuses.includes(item.status))
    const items = matches.slice(offset, offset + limit)
    return { version: snapshot.version, counts: snapshot.counts, storedRevisions: snapshot.storedRevisions,
      activeBytes: snapshot.activeBytes, items,
      ...(offset + items.length >= matches.length ? {} : { nextCursor: Buffer.from(JSON.stringify({
        version: snapshot.version, filter, offset: offset + items.length })).toString('base64url') }) }
  }

  /** Preview by default; commit the complete selection batch in one durable write.
   * @param request - Selected source changes and expected bank version.
   * @returns Validated preview or durable commit receipt. */
  curate(request: CurateSourcesRequest): Promise<CurateSourcesResult> {
    const operation = this.tail.then(async () => {
      const snapshot = this.snapshot(request.projectId)
      if (request.apply && request.expectedVersion !== snapshot.version) throw new Error('Source bank changed; preview again before applying')
      if (request.changes.length === 0 || request.changes.length > 200) throw new Error('Curation needs 1–200 changes')
      const selections = { ...this.requireTable().get(request.projectId)?.selections }
      const paths = new Set<string>()
      const changes: SourceBankItem[] = []
      for (const change of request.changes) {
        const artifact = this.read(change.id)
        if (artifact.projectId !== request.projectId) throw new Error('Source belongs to another project')
        if (paths.has(artifact.path)) throw new Error('Select a source identity only once per batch')
        paths.add(artifact.path)
        const parsed = selectionSchema.parse(change)
        if (parsed.reason.trim() === '' || parsed.reason.length > 2000) throw new Error('A bounded curation reason is required')
        if (parsed.replacementId !== undefined) {
          const replacement = this.read(parsed.replacementId)
          if (replacement.projectId !== request.projectId) throw new Error('Replacement belongs to another project')
          if (replacement.path === artifact.path) throw new Error('Replacement must be a different source identity')
        }
        const item = snapshot.items.find(item => item.path === artifact.path)
        if (item === undefined) throw new Error('Source identity is no longer present')
        Object.defineProperty(selections, artifact.path, { value: parsed, enumerable: true, writable: true, configurable: true })
        changes.push({ ...item, ...parsed, ...(parsed.replacementId === undefined ? { replacementId: undefined } : {}) })
      }
      // Reject replacement chains into excluded sources, including cycles in this batch.
      for (const change of changes) if (change.replacementId !== undefined) {
        const target = this.read(change.replacementId)
        const status = selections[target.path]?.status ?? this.selection(target).status
        if (status !== 'active') throw new Error('Replacement must remain active')
      }
      if (request.apply) await this.requireTable().put(request.projectId, { projectId: request.projectId, selections })
      return { applied: request.apply === true,
        version: request.apply ? this.snapshot(request.projectId).version : snapshot.version, changes }
    })
    this.tail = operation.then(() => {}, () => {})
    return operation
  }

  /** Check required evidence, exact duplicate content and preserved citation passages.
   * @param request - Owning project and required evidence selectors.
   * @returns Coverage, duplicate content and citation-integrity diagnostics. */
  check(request: CheckSourcesRequest): CheckSourcesResult {
    const snapshot = this.snapshot(request.projectId)
    const active = snapshot.items.filter(item => item.status === 'active').map(item => this.read(item.id))
    const activePaths = new Set(active.map(item => item.path))
    const missingIds = (request.requiredIds ?? []).filter((id) => {
      try { const item = this.read(id); return item.projectId !== request.projectId || !activePaths.has(item.path) }
      catch { return true }
    })
    const missingTexts = (request.requiredTexts ?? []).filter(text => !active.some(item => item.text.includes(text)))
    const hashes = new Map<string, ArtifactRevisionId[]>()
    for (const item of active) { const ids = hashes.get(item.revision) ?? []; ids.push(item.id); hashes.set(item.revision, ids) }
    const duplicates = [...hashes.values()].filter(ids => ids.length > 1)
    const issues: string[] = []
    const seen = new Set<string>()
    for (const item of this.evidence().filter(item => item.projectId === request.projectId)) for (const relation of this.related(item.id)) {
      if (relation.relation !== 'cites' || seen.has(relation.id)) continue
      seen.add(relation.id)
      try {
        const target = this.read(relation.to)
        const passage = relation.passage
        if (passage !== undefined && (passage.start < 0 || passage.end <= passage.start
          || passage.end > target.text.length || target.text.slice(passage.start, passage.end) !== passage.quote))
          issues.push(`Citation ${relation.id} has an invalid passage`)
      } catch { issues.push(`Citation ${relation.id} has missing evidence`) }
    }
    return { ok: missingIds.length === 0 && missingTexts.length === 0 && issues.length === 0,
      version: snapshot.version, counts: snapshot.counts, storedRevisions: snapshot.storedRevisions,
      missingIds, missingTexts, duplicateGroups: duplicates.slice(0, 100), citationIssues: issues.slice(0, 100),
      omittedDuplicateGroups: Math.max(0, duplicates.length - 100), omittedCitationIssues: Math.max(0, issues.length - 100) }
  }

  private snapshot(projectId: WorkspaceId) {
    const records = this.evidence().filter(item => item.projectId === projectId)
    const latest = new Map<string, ArtifactRevision>()
    const revisions = new Map<string, number>()
    for (const item of records) {
      revisions.set(item.path, (revisions.get(item.path) ?? 0) + 1)
      const previous = latest.get(item.path)
      if (previous === undefined || item.capturedAt >= previous.capturedAt) latest.set(item.path, item)
    }
    const items: SourceBankItem[] = [...latest.values()].sort((a, b) => a.path.localeCompare(b.path)).map(item => ({
      id: item.id, path: item.path, title: item.title, revision: item.revision, bytes: Buffer.byteLength(item.text),
      revisions: revisions.get(item.path) ?? 0, ...this.selection(item) }))
    const counts: Record<SourceStatus, number> = { active: 0, discovery: 0, archived: 0, removed: 0 }
    let activeBytes = 0
    for (const item of items) { ++counts[item.status]; if (item.status === 'active') activeBytes += item.bytes }
    return { items, counts, activeBytes, storedRevisions: records.length, version: digest([projectId, items]) }
  }
  private requireTable() {
    if (this.table === undefined) throw new Error('Source bank storage is unavailable')
    return this.table
  }
}
