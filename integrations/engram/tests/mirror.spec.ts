import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeMirror } from '../src/mirror/markdown.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'

let dir: string
let store: EngramStore
let mirrorRoot: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-mirror-'))
  store = await openEngramStore(join(dir, 'user.db'))
  mirrorRoot = join(dir, 'mirror')
})

afterEach(async () => {
  await store.close()
})

describe('Markdown mirror export', () => {
  it('writes one .md per memory: frontmatter, placard body, corridor list', async () => {
    const a = await store.write({ scope: 'user', kind: 'fact', content: '部署端口是 4000', importance: 0.7, confidence: 0.8 })
    const b = await store.write({ scope: 'user', kind: 'preference', content: '偏好简体中文界面', importance: 0.6, confidence: 0.7 })
    await store.linkEdge(a.id, b.id, 'related')
    const data = await store.exportAll()
    const report = await writeMirror(mirrorRoot, data)
    expect(report.fileCount).toBe(2 + 2) // 2 memories + _index.md + _meta.json
    expect(report.rooms).toHaveLength(2)

    // fact room: should contain a's file
    const factDir = join(mirrorRoot, 'fact')
    const factFiles = await readdir(factDir)
    expect(factFiles).toHaveLength(1)
    const factContent = await readFile(join(factDir, factFiles[0]!), 'utf8')
    expect(factContent).toContain('id: ' + a.id)
    expect(factContent).toContain('kind: fact')
    expect(factContent).toContain('importance: 0.700')
    expect(factContent).toContain('部署端口是 4000')
    expect(factContent).toContain('Relations')
    expect(factContent).toContain(b.id.slice(0, 8))
    expect(factContent).toContain('related')

    // preference room: should contain b's file
    const prefDir = join(mirrorRoot, 'preference')
    const prefFiles = await readdir(prefDir)
    expect(prefFiles).toHaveLength(1)
    const prefContent = await readFile(join(prefDir, prefFiles[0]!), 'utf8')
    expect(prefContent).toContain('偏好简体中文界面')
    expect(prefContent).toContain(a.id.slice(0, 8)) // corridor entry
  })

  it('_index.md contains room overview + memory list + corridor summary', async () => {
    await store.write({ scope: 'user', kind: 'fact', content: '事实一', importance: 0.9 }) // intentionally non-English test data (CJK memory content)
    await store.write({ scope: 'user', kind: 'fact', content: '事实二', importance: 0.4 }) // intentionally non-English test data
    await store.write({ scope: 'user', kind: 'episode', content: '事件一', importance: 0.6 }) // intentionally non-English test data
    const report = await writeMirror(mirrorRoot, await store.exportAll())
    const index = await readFile(join(mirrorRoot, '_index.md'), 'utf8')
    expect(index).toContain('# Memory palace · Private palace')
    expect(index).toContain('## Rooms')
    expect(index).toContain('**Facts** · 2 memories')
    expect(index).toContain('**Episodes** · 1 memories')
    expect(index).toContain('## Memories')
    expect(index).toContain('## Relations')
    expect(report.exportedAt).toBeGreaterThan(0)
  })

  it('_meta.json contains room summaries and totals, reusable by the panel', async () => {
    await store.write({ scope: 'user', kind: 'fact', content: '活跃', importance: 0.5 }) // intentionally non-English test data
    const forgotten = await store.write({ scope: 'user', kind: 'fact', content: '已闭馆', importance: 0.5 }) // intentionally non-English test data
    await store.forget(forgotten.id)
    await writeMirror(mirrorRoot, await store.exportAll())
    const meta = JSON.parse(await readFile(join(mirrorRoot, '_meta.json'), 'utf8')) as {
      scope: string
      total: number
      rooms: Array<{ kind: string; memoryCount: number; active: number; archived: number; forgotten: number }>
    }
    expect(meta.scope).toBe('user')
    expect(meta.total).toBe(2)
    const fact = meta.rooms.find(room => room.kind === 'fact')!
    expect(fact.memoryCount).toBe(2)
    expect(fact.active).toBe(1)
    expect(fact.forgotten).toBe(1)
  })

  it('an empty palace still writes a mirror (_index.md + _meta.json + 0 rooms)', async () => {
    const report = await writeMirror(mirrorRoot, await store.exportAll())
    expect(report.fileCount).toBe(2)
    expect(report.rooms).toEqual([])
    const meta = JSON.parse(await readFile(join(mirrorRoot, '_meta.json'), 'utf8')) as { total: number }
    expect(meta.total).toBe(0)
  })

  it('mirror file name is `<id8>-<slug>-<idx>.md` with the first 8 id chars as a stable prefix', async () => {
    const r = await store.write({ scope: 'user', kind: 'skill', content: 'Rust ownership: ownership + the borrow checker', importance: 0.8 })
    await writeMirror(mirrorRoot, await store.exportAll())
    const skillDir = join(mirrorRoot, 'skill')
    const files = await readdir(skillDir)
    expect(files).toHaveLength(1)
    expect(files[0]!.startsWith(r.id.slice(0, 8))).toBe(true)
    expect(files[0]!.endsWith('-000.md')).toBe(true)
  })
})
