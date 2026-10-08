import { expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceDocuments, type DocumentAccess } from '../src/client/workflows/documents.ts'
import type { DocumentRecoveryDraft } from '@deepseek-ai/dsh-workspace/types'
const session = 'editor-session' as SessionId
function bench() {
  let disk = { absolutePath: '/project/章.md', version: 'v1', text: '# Chapter\r\n\r\nOriginal\r\n' }
  let draft: DocumentRecoveryDraft | undefined
  let count = 0
  const access: DocumentAccess = {
    read: vi.fn(async () => ({ ...disk })),
    readDraft: vi.fn(async () => draft),
    saveDraft: vi.fn(async (request) => {
      if (request.expectedDraftRevision !== (draft?.revision ?? null)) throw new Error('Newer recovery draft')
      draft = { sessionId: request.sessionId, path: request.path, baseVersion: request.baseVersion, text: request.text, revision: String(++count), updatedAt: 'now' }
      return draft
    }),
    clearDraft: vi.fn(async (_session, _path, revision) => {
      if (revision !== draft?.revision) throw new Error('Newer recovery draft')
      draft = undefined
    }),
    save: vi.fn(async (_session, _path, text, version) => {
      if (disk.version !== version) return { status: 'conflict', current: { ...disk } }
      disk = { ...disk, version: `v${++count + 1}`, text }
      return { status: 'saved', document: { ...disk } }
    }),
  }
  const controller = new WorkspaceDocuments(access)
  return { access, controller, disk: () => disk, external: (text: string) => { disk = { ...disk, version: 'external', text } }, draft: () => draft }
}
it('opens exact source without rewriting it, serializes Unicode recovery and restores after restart', async () => {
  const b = bench()
  await b.controller.open(session, '章.md')
  expect(b.access.save).not.toHaveBeenCalled()
  expect(b.access.saveDraft).not.toHaveBeenCalled()
  await Promise.all([b.controller.edit(session, '章.md', 'First'), b.controller.edit(session, '章.md', 'Latest 🦊')])
  expect(b.draft()?.text).toBe('Latest 🦊')
  const reopened = new WorkspaceDocuments(b.access)
  await reopened.open(session, '章.md')
  expect(reopened.state.getSnapshot().sessions[session]?.documents['章.md']?.text).toBe('Latest 🦊')
  await reopened.save(session, '章.md')
  expect(b.disk().text).toBe('Latest 🦊')
  expect(b.draft()).toBeUndefined()
})
it('preserves external changes until the user explicitly accepts the compared revision', async () => {
  const b = bench()
  await b.controller.open(session, '章.md')
  await b.controller.edit(session, '章.md', 'My edit')
  b.external('Agent edit')
  await b.controller.save(session, '章.md')
  expect(b.disk().text).toBe('Agent edit')
  expect(b.controller.state.getSnapshot().sessions[session]?.documents['章.md']?.conflict?.text).toBe('Agent edit')
  await b.controller.save(session, '章.md')
  expect(b.access.save).toHaveBeenCalledTimes(1)
  await b.controller.rebase(session, '章.md')
  await b.controller.save(session, '章.md')
  expect(b.disk().text).toBe('My edit')
})
it('marks a recovered draft as conflicting when disk changed during downtime', async () => {
  const b = bench()
  await b.controller.open(session, '章.md')
  await b.controller.edit(session, '章.md', 'Recovered')
  b.external('New disk')
  const reopened = new WorkspaceDocuments(b.access)
  await reopened.open(session, '章.md')
  await reopened.save(session, '章.md')
  expect(b.access.save).not.toHaveBeenCalled()
  expect(reopened.state.getSnapshot().sessions[session]?.documents['章.md']?.text).toBe('Recovered')
})
it('retains edits made during an in-flight disk save as a newer recovery copy', async () => {
  const b = bench()
  await b.controller.open(session, '章.md')
  await b.controller.edit(session, '章.md', 'Submitted')
  let finish!: () => void
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  const save = b.access.save
  b.access.save = async (...args) => { await waiting; return save(...args) }
  const operation = b.controller.save(session, '章.md')
  await vi.waitFor(() => expect(b.controller.state.getSnapshot().sessions[session]?.documents['章.md']?.busy).toBe(true))
  const editing = b.controller.edit(session, '章.md', 'Newer typing')
  finish()
  await Promise.all([operation, editing])
  expect(b.disk().text).toBe('Submitted')
  expect(b.draft()?.text).toBe('Newer typing')
})
it('keeps the last explicitly requested tab active when older file reads finish later', async () => {
  const b = bench()
  let first!: () => void
  const gate = new Promise<void>((resolve) => { first = resolve })
  b.access.read = async (_session, path) => {
    if (path === 'slow.md') await gate
    return { absolutePath: `/project/${path}`, version: 'v1', text: path }
  }
  const slow = b.controller.open(session, 'slow.md')
  await b.controller.open(session, 'new.md')
  first()
  await slow
  expect(b.controller.state.getSnapshot().sessions[session]?.active).toBe('new.md')
  expect(Object.keys(b.controller.state.getSnapshot().sessions[session]?.documents ?? {})).toHaveLength(2)
})

it('closes a dirty tab only after retaining its latest draft and recovers it on reopen', async () => {
  const b = bench()
  await b.controller.open(session, '章.md')
  const editing = b.controller.edit(session, '章.md', 'Keep on close')
  expect(await b.controller.close(session, '章.md')).toBe(true)
  await editing
  expect(b.controller.state.getSnapshot().sessions[session]?.documents['章.md']).toBeUndefined()
  expect(b.draft()?.text).toBe('Keep on close')
  expect(b.access.save).not.toHaveBeenCalled()
  await b.controller.open(session, '章.md')
  expect(b.controller.state.getSnapshot().sessions[session]?.documents['章.md']?.text).toBe('Keep on close')
})
it('keeps a dirty tab open when recovery persistence fails', async () => {
  const b = bench()
  await b.controller.open(session, '章.md')
  b.access.saveDraft = async () => { throw new Error('Recovery unavailable') }
  await b.controller.edit(session, '章.md', 'Do not lose')
  expect(await b.controller.close(session, '章.md')).toBe(false)
  expect(b.controller.state.getSnapshot().sessions[session]?.documents['章.md']?.text).toBe('Do not lose')
  expect(b.controller.state.getSnapshot().sessions[session]?.documents['章.md']?.error).toBe('Recovery unavailable')
})
