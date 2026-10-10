import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { EngramError } from '../src/types.ts'
import { openEngramStore } from '../src/store/sqlite.ts'
import type { EngramStore } from '../src/store/interface.ts'
import { createEngramTools } from '../src/tools/create.ts'

/** Callable view over a tool: keeps only execute, with the exec parameter narrowed to a real ToolRunContext. */
type ExecutableTool = { execute: (args: unknown, exec: ToolRunContext) => Promise<unknown> }

let dir: string
let store: EngramStore
let tools: Map<string, ExecutableTool>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engram-profile-block-'))
  store = await openEngramStore(join(dir, 'user.db'))
  tools = new Map<string, ExecutableTool>(
    createEngramTools({
      openStore: async () => store,
      resolveProjectStore: async () => store,
      embedder: Promise.resolve(undefined),
      call: undefined,
      routeOverride: undefined,
      queryRewrite: false,
      exportDir: join(dir, 'exports'),
    }).map(tool => [tool.name, tool]),
  )
})
afterEach(async () => {
  await store.close()
})

/** Fake execution context for tests: execute does not read the agent field (profile_edit never touches the session), so only signal is provided. */
const fakeExec = {
  agent: { id: 'sess-1', session: { id: 'sess-1', snapshotEvents: () => [] } },
  signal: new AbortController().signal,
} as unknown as ToolRunContext

describe('profile_blocks storage layer', () => {
  it('first creation produces v1; subsequent edits increment the version', async () => {
    const first = await store.saveProfileBlock('user', undefined, '用户偏好简体中文', 'edit')
    expect(first.version).toBe(1)
    const second = await store.saveProfileBlock('user', first.version, '用户偏好简体中文；时区上海', 'edit')
    expect(second.version).toBe(2)
    const current = await store.getProfileBlock('user')
    expect(current?.content).toBe('用户偏好简体中文；时区上海')
    expect(current?.version).toBe(2)
  })

  it('optimistic lock: with a block already present, a missing expectedVersion or a version mismatch both VERSION_CONFLICT', async () => {
    const first = await store.saveProfileBlock('user', undefined, 'v1', 'edit')
    await expect(store.saveProfileBlock('user', undefined, '重创建', 'edit'))
      .rejects.toThrowError(EngramError)
    await expect(store.saveProfileBlock('user', first.version + 5, '过期编辑', 'edit'))
      .rejects.toThrowError(EngramError)
    // After a conflict the current state is not polluted.
    expect((await store.getProfileBlock('user'))?.content).toBe('v1')
    // With no block yet, providing expectedVersion also conflicts.
    await expect(store.saveProfileBlock('project', 1, '无中生有', 'edit')).rejects.toThrowError(EngramError)
  })

  it('empty content fails loudly', async () => {
    await expect(store.saveProfileBlock('user', undefined, '   ', 'edit')).rejects.toThrowError(EngramError)
  })

  it('version chain only grows, never rewritten: rollback appends a new version and history stays queryable', async () => {
    const v1 = await store.saveProfileBlock('user', undefined, '第一版', 'edit')
    const v2 = await store.saveProfileBlock('user', v1.version, '第二版', 'edit')
    // Roll back to v1's content: appended as v3 (source=rollback), history not rewritten.
    const restored = await store.saveProfileBlock('user', v2.version, v1.content, 'rollback')
    expect(restored.version).toBe(3)
    expect(restored.content).toBe('第一版')
    const versions = await store.listProfileBlockVersions('user', 10)
    expect(versions.map(version => version.version)).toEqual([3, 2, 1])
    expect(versions.map(version => version.source)).toEqual(['rollback', 'edit', 'edit'])
    // Await first, then read the field: `await promise()?.content` reads the property on the Promise before awaiting, always yielding undefined.
    const v1Row = await store.getProfileBlockVersion('user', 1)
    expect(v1Row?.content).toBe('第一版')
    expect(v1Row?.source).toBe('edit')
    expect(await store.getProfileBlockVersion('user', 99)).toBeUndefined()
  })

  it('scope isolation: user and project blocks are invisible to each other', async () => {
    await store.saveProfileBlock('user', undefined, '私人画像', 'edit')
    expect(await store.getProfileBlock('project')).toBeUndefined()
    expect(await store.listProfileBlockVersions('shared', 10)).toEqual([])
  })

  it('purge clears the profile table', async () => {
    await store.saveProfileBlock('user', undefined, '将被清除', 'edit')
    await store.purge()
    expect(await store.getProfileBlock('user')).toBeUndefined()
    expect(await store.listProfileBlockVersions('user', 10)).toEqual([])
  })

  it('a legacy db with schema_version downgraded to 6 auto-migrates the profile table on reopen, with old data intact', async () => {
    const path = join(dir, 'migrate.db')
    const legacy = await openEngramStore(path)
    await legacy.write({ scope: 'user', kind: 'fact', content: '旧库数据' })
    await legacy.close()
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(path)
    raw.prepare("UPDATE meta SET value = '6' WHERE key = 'schema_version'").run()
    raw.close()
    const migrated = await openEngramStore(path)
    try {
      expect(await migrated.topActive('user', 10)).toHaveLength(1)
      // After migration the profile table is usable (starting from v1).
      const block = await migrated.saveProfileBlock('user', undefined, '迁移后创建', 'edit')
      expect(block.version).toBe(1)
    } finally {
      await migrated.close()
    }
  })
})

describe('engram_profile_edit tool', () => {
  it('view empty state hints how to create', async () => {
    const result = await tools.get('engram_profile_edit')!.execute({ action: 'view' }, fakeExec) as { text: string }
    expect(result.text).toContain('The user store has no curated profile block yet')
  })

  it('edit creates v1 and audits op_log; a second edit goes through the optimistic lock', async () => {
    const created = await tools.get('engram_profile_edit')!.execute(
      { action: 'edit', content: '用户偏好简体中文' }, fakeExec) as { text: string }
    expect(created.text).toContain('v1')
    const updated = await tools.get('engram_profile_edit')!.execute(
      { action: 'edit', content: '用户偏好简体中文；拒绝 Emoji', expectedVersion: 1 }, fakeExec) as { text: string }
    expect(updated.text).toContain('v2')
    // The edit record lands in op_log: op=profile-edit, target_id=scope.
    const ops = await store.recentOps(5)
    const profileOps = ops.filter(op => op.op === 'profile-edit')
    expect(profileOps).toHaveLength(2)
    expect(profileOps[0]!.targetId).toBe('user')
    expect(JSON.parse(profileOps[0]!.detail ?? '{}')).toMatchObject({ action: 'edit', fromVersion: 1, toVersion: 2 })
    // The audit row for first creation has fromVersion null.
    expect(JSON.parse(profileOps[1]!.detail ?? '{}')).toMatchObject({ action: 'edit', fromVersion: null, toVersion: 1 })
  })

  it('edit version conflict errors loudly', async () => {
    await tools.get('engram_profile_edit')!.execute({ action: 'edit', content: 'v1' }, fakeExec)
    await expect(tools.get('engram_profile_edit')!.execute(
      { action: 'edit', content: '过期编辑', expectedVersion: 7 }, fakeExec)).rejects.toThrow(/conflict/)
  })

  it('rollback writes the content of a historical version as a new version and audits restoredFrom', async () => {
    await tools.get('engram_profile_edit')!.execute({ action: 'edit', content: '第一版' }, fakeExec)
    await tools.get('engram_profile_edit')!.execute({ action: 'edit', content: '第二版', expectedVersion: 1 }, fakeExec)
    const rolled = await tools.get('engram_profile_edit')!.execute(
      { action: 'rollback', toVersion: 1 }, fakeExec) as { text: string }
    expect(rolled.text).toContain('v1')
    expect(rolled.text).toContain('v3')
    expect((await store.getProfileBlock('user'))?.content).toBe('第一版')
    const ops = await store.recentOps(3)
    expect(JSON.parse(ops[0]!.detail ?? '{}')).toMatchObject({ action: 'rollback', fromVersion: 2, toVersion: 3, restoredFrom: 1 })
  })

  it('rollback errors when the target version is missing; edit without content errors', async () => {
    await expect(tools.get('engram_profile_edit')!.execute({ action: 'rollback', toVersion: 9 }, fakeExec))
      .rejects.toThrow(/does not exist/)
    await expect(tools.get('engram_profile_edit')!.execute({ action: 'edit' }, fakeExec))
      .rejects.toThrow(/content/)
  })
})
