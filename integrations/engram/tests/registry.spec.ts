import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findProjectPalace, listProjectPalaces, pathTitle } from '../src/project/registry.ts'
import { resolveProjectIdentity, workspaceProjectDbName } from '../src/project/identity.ts'

const ORIGIN_CONFIG = [
  '[core]',
  '\trepositoryformatversion = 0',
  '[remote "origin"]',
  '\turl = git@github.com:kenz1117/dsh-engram.git',
].join('\n')

/** Create a repo directory with an origin (directories sharing an origin map to the same project palace). */
async function makeRepo(originUrl: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'engram-reg-'))
  await mkdir(join(dir, '.git'), { recursive: true })
  await writeFile(join(dir, '.git', 'config'), `${ORIGIN_CONFIG.replace('git@github.com:kenz1117/dsh-engram.git', originUrl)}\n`)
  return dir
}

describe('pathTitle', () => {
  it('takes the last segment, accepts Win/POSIX separators, tolerates a trailing slash', () => {
    expect(pathTitle('G:\\GitWork\\dsh-engram')).toBe('dsh-engram')
    expect(pathTitle('/home/u/proj/')).toBe('proj')
    expect(pathTitle('C:\\')).toBe('C:')
  })
})

describe('listProjectPalaces', () => {
  it('orders registry workspaces first, session cwd next, process dir as fallback', async () => {
    const workspace = await makeRepo('git@github.com:a/b.git')
    const sessionOnly = await mkdtemp(join(tmpdir(), 'engram-reg-sess-'))
    const palaces = listProjectPalaces({
      workspaces: [{ id: 'ws-1', path: workspace, title: 'Alpha Project' }],
      sessionCwds: [sessionOnly],
      processCwd: 'C:\\Users\\Administrator',
    })
    expect(palaces.map(palace => palace.kind)).toEqual(['workspace', 'session', 'process'])
    expect(palaces[0]).toMatchObject({ title: 'Alpha Project', source: 'workspace', workspaceId: 'ws-1', path: workspace })
    expect(palaces[1]!.dbName).toBe(resolveProjectIdentity(sessionOnly).dbName)
    // Host-generated suffix, asserted verbatim from the current source output.
    expect(palaces[2]!.title).toContain('process directory')
  })

  it('distinct Workspace IDs isolate same-origin repos; cwd and process do not add duplicate entries', async () => {
    const workspace = await makeRepo('git@github.com:a/b.git')
    const twin = await makeRepo('https://github.com/a/b')
    const palaces = listProjectPalaces({
      workspaces: [
        { id: 'ws-1', path: workspace, title: 'Main Repo' },
        { id: 'ws-2', path: twin, title: 'Copy' },
      ],
      sessionCwds: [workspace, twin],
      processCwd: workspace,
    })
    expect(palaces).toHaveLength(2)
    expect(palaces[0]!.dbName).not.toBe(palaces[1]!.dbName)
    expect(palaces[0]).toMatchObject({ kind: 'workspace', title: 'Main Repo' })
  })

  it('empty title falls back to the path tail; empty paths are skipped', async () => {
    const workspace = await makeRepo('git@github.com:a/b.git')
    const palaces = listProjectPalaces({
      workspaces: [{ id: 'ws-1', path: workspace, title: '' }, { id: 'ws-2', path: '', title: 'Empty' }],
      sessionCwds: [],
      processCwd: 'C:\\tmp',
    })
    expect(palaces[0]!.title).toBe(pathTitle(workspace))
    expect(palaces[0]!.workspaceId).toBe('ws-1')
    expect(palaces.some(palace => palace.workspaceId === 'ws-2')).toBe(false)
  })
})

describe('findProjectPalace', () => {
  it('matches by dbName; an unknown dbName returns undefined (the route 404s on that)', async () => {
    const workspace = await makeRepo('git@github.com:a/b.git')
    const palaces = listProjectPalaces({
      workspaces: [{ id: 'ws-1', path: workspace, title: 'Alpha' }],
      sessionCwds: [],
      processCwd: 'C:\\Users\\Administrator',
    })
    const dbName = workspaceProjectDbName('ws-1')
    expect(findProjectPalace(palaces, { dbName })?.title).toBe('Alpha')
    expect(findProjectPalace(palaces, { dbName: 'project-000000000000000000000000.db' })).toBeUndefined()
  })

  it('an unknown cwd hit synthesizes a session entry on the fly; without a selector it falls back to the process entry', async () => {
    const workspace = await makeRepo('git@github.com:a/b.git')
    const stranger = await mkdtemp(join(tmpdir(), 'engram-reg-stranger-'))
    const palaces = listProjectPalaces({
      workspaces: [{ id: 'ws-1', path: workspace, title: 'Alpha' }],
      sessionCwds: [],
      processCwd: 'C:\\Users\\Administrator',
    })
    const byCwd = findProjectPalace(palaces, { cwd: stranger })
    expect(byCwd).toMatchObject({ kind: 'session', dbName: resolveProjectIdentity(stranger).dbName })
    expect(findProjectPalace(palaces, {})?.kind).toBe('process')
  })
})

it('workspace identity survives titles and directory moves and never uses IDs as paths', () => {
  const first = listProjectPalaces({ workspaces: [{ id: '../stable', path: '/old', title: 'Writing' }], sessionCwds: [], processCwd: '/old' })
  const moved = listProjectPalaces({ workspaces: [{ id: '../stable', path: '/new', title: 'Research' }], sessionCwds: [], processCwd: '/new' })
  expect(first[0]!.dbName).toBe(moved[0]!.dbName)
  expect(first[0]!.dbName).toMatch(/^project-[a-f0-9]{24}\.db$/)
  expect(findProjectPalace(moved, { cwd: '/new' })?.workspaceId).toBe('../stable')
})
