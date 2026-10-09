






import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EngramScope } from '../types.ts'
import type { ExportData, MemoryEdge, MemoryRecord } from '../types.ts'


function slugify(input: string): string {
  const stripped = input
    .toLowerCase()
    .replace(/[\u4e00-\u9fa5]+/g, '记')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return stripped === '' ? 'untitled' : stripped.slice(0, 32)
}


function yaml(value: unknown): string {
  if (value === null || value === undefined) return '""'
  if (typeof value === 'string') {
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ')
    return `"${escaped}"`
  }
  return JSON.stringify(value)
}


function iso(ms: number): string {
  return new Date(ms).toISOString()
}



const ROOM_LABEL: Record<string, string> = {
  fact: 'Facts',
  preference: 'Preferences',
  decision: 'Decisions',
  episode: 'Episodes',
  skill: 'Skills',
}


export interface MirrorMemoryMeta {
  readonly id: string
  readonly scope: EngramScope
  readonly kind: string
  readonly status: string
  readonly file: string
  readonly importance: number
  readonly confidence: number
  readonly createdAt: number
}


export interface MirrorRoomSummary {
  readonly kind: string
  readonly memoryCount: number
  readonly active: number
  readonly archived: number
  readonly forgotten: number
}


export interface MirrorReport {
  readonly rootDir: string
  readonly fileCount: number
  readonly rooms: readonly MirrorRoomSummary[]
  readonly exportedAt: number
}


export interface SharedLoanEntry {
  readonly id: string
  readonly kind: string
  readonly status: string
  readonly importance: number
  readonly confidence: number
  readonly firstLentAt: number
  readonly lastAccessedAt: number
  readonly accessCount: number
}


export interface ShareManifest {
  readonly generatedAt: number
  readonly scope: 'shared'
  readonly memoryCount: number
  readonly loans: readonly SharedLoanEntry[]
}


function renderIndex(scope: EngramScope, data: ExportData, rooms: readonly MirrorRoomSummary[]): string {
  const total = data.records.length
  const active = data.records.filter(r => r.status === 'active').length
  const edges = data.edges.length
  const heading = `# Memory palace · ${scope === 'user' ? 'Private palace' : 'Project palace'}\n`
  const summary = [
    '',
    `> Exported ${iso(data.exportedAt)} · total **${total}** memories (active ${active} ) · relations ${edges}`,
    '',
    '## Rooms',
    '',
    ...rooms.map(room => `- **${ROOM_LABEL[room.kind] ?? room.kind}** · ${room.memoryCount} memories (active ${room.active} · archived ${room.archived} · forgotten ${room.forgotten}）`),
    '',
    '## Memories',
    '',
    ...data.records
      .slice()
      .sort((a, b) => b.importance - a.importance)
      .map(record => `- [${record.status === 'active' ? '●' : record.status === 'archived' ? '◇' : '×'}][${ROOM_LABEL[record.kind] ?? record.kind}] ${record.content.slice(0, 60)}${record.content.length > 60 ? '…' : ''} — [[${record.id.slice(0, 8)}]]`),
    '',
    '## Relations',
    '',
    ...(edges === 0 ? ['(No relations)'] : data.edges.map(edge => `- \`${edge.from.slice(0, 8)}\` --${edge.type}--> \`${edge.to.slice(0, 8)}\``)),
    '',
  ].join('\n')
  return heading + summary
}


function renderMemory(record: MemoryRecord, edges: readonly MemoryEdge[]): string {
  const relEdges = edges.filter(edge => edge.from === record.id || edge.to === record.id)
  const tags: string[] = []
  if (record.outcome !== undefined) tags.push(`outcome-${record.outcome}`)
  if (record.content.includes('[REDACTED:')) tags.push('redacted')
  const imagery = record.imagery
  const caption = imagery?.caption
  const sensory = imagery?.sensoryTags ?? []
  const frontmatter = [
    '---',
    `id: ${record.id}`,
    `scope: ${record.scope}`,
    `kind: ${record.kind}`,
    `status: ${record.status}`,
    `importance: ${record.importance.toFixed(3)}`,
    `confidence: ${record.confidence.toFixed(3)}`,
    `createdAt: "${iso(record.createdAt)}"`,
    `accessCount: ${record.accessCount}`,
    `sourceSession: ${record.sourceSessionId === null ? '""' : yaml(record.sourceSessionId)}`,
    `sourceRound: ${record.sourceRound ?? '""'}`,
    ...(tags.length === 0 ? [] : [`tags: [${tags.join(', ')}]`]),
    ...(caption !== undefined && caption !== null ? [`imageryCaption: ${yaml(caption)}`] : []),
    ...(sensory.length > 0 ? [`imagerySensory: [${sensory.map(s => yaml(s)).join(', ')}]`, `imageryValence: ${(imagery?.emotionalValence ?? 0).toFixed(3)}`] : []),
    '---',
  ].join('\n')
  const body = [
    `# ${record.content.split('\n')[0]?.slice(0, 80) ?? 'Memory placard'}`,
    '',
    record.content,
    '',
    '## Relations',
    '',
    ...(relEdges.length === 0 ? ['(This memory has no relations)'] : relEdges.map(edge => {
      const other = edge.from === record.id ? edge.to : edge.from
      const direction = edge.from === record.id ? '→' : '←'
      return `- ${direction} \`${other.slice(0, 8)}\`（${edge.type}）`
    })),
    '',
  ].join('\n')
  return frontmatter + '\n' + body
}


function renderMeta(scope: EngramScope, data: ExportData, rooms: readonly MirrorRoomSummary[]): string {
  const payload = {
    scope,
    exportedAt: data.exportedAt,
    total: data.records.length,
    rooms,
  }
  return JSON.stringify(payload, null, 2) + '\n'
}


function summarizeRooms(records: readonly MemoryRecord[]): MirrorRoomSummary[] {
  const map = new Map<string, { memoryCount: number; active: number; archived: number; forgotten: number }>()
  for (const record of records) {
    const entry = map.get(record.kind) ?? { memoryCount: 0, active: 0, archived: 0, forgotten: 0 }
    entry.memoryCount += 1
    if (record.status === 'active') entry.active += 1
    else if (record.status === 'archived') entry.archived += 1
    else if (record.status === 'forgotten') entry.forgotten += 1
    map.set(record.kind, entry)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => ({ kind, ...count }))
}







export async function writeMirror(rootDir: string, data: ExportData): Promise<MirrorReport> {
  const scope = (data.records[0]?.scope ?? 'user') as EngramScope
  await mkdir(rootDir, { recursive: true, mode: 0o700 })
  const rooms = summarizeRooms(data.records)
  const recordsByKind = new Map<string, MemoryRecord[]>()
  for (const record of data.records) {
    const list = recordsByKind.get(record.kind) ?? []
    list.push(record)
    recordsByKind.set(record.kind, list)
  }
  let fileCount = 0
  for (const record of data.records) {
    const roomRecords = recordsByKind.get(record.kind)
    if (roomRecords === undefined) continue
    const indexInRoom = roomRecords.indexOf(record)

    const roomDir = join(rootDir, record.kind)
    await mkdir(roomDir, { recursive: true, mode: 0o700 })
    const fileName = `${record.id.slice(0, 8)}-${slugify(record.content)}-${String(indexInRoom).padStart(3, '0')}.md`
    await writeFile(join(roomDir, fileName), renderMemory(record, data.edges), { mode: 0o600 })
    fileCount += 1
  }
  await writeFile(join(rootDir, '_index.md'), renderIndex(scope, data, rooms), { mode: 0o600 })
  await writeFile(join(rootDir, '_meta.json'), renderMeta(scope, data, rooms), { mode: 0o600 })
  fileCount += 2

  if (scope === 'shared') {
    const manifest = buildShareManifest(data)
    await writeFile(join(rootDir, 'share-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    fileCount += 1
  }
  return { rootDir, fileCount, rooms, exportedAt: data.exportedAt }
}





export function buildShareManifest(data: ExportData, now: number = Date.now()): ShareManifest {
  const loans: SharedLoanEntry[] = data.records
    .filter(record => record.scope === 'shared')
    .map(record => ({
      id: record.id,
      kind: record.kind,
      status: record.status,
      importance: record.importance,
      confidence: record.confidence,
      firstLentAt: record.createdAt,
      lastAccessedAt: record.lastAccessedAt,
      accessCount: record.accessCount,
    }))
  return { generatedAt: now, scope: 'shared', memoryCount: loans.length, loans }
}
