import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { DocumentDrafts } from '../src/document-drafts.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})
async function open(pool: MemoryMediaPool) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(DocumentDrafts)
  return ctx
}
it('recovers complete unsaved text after restart and refuses stale autosave or stale draft deletion', async () => {
  const pool = new MemoryMediaPool()
  const first = await open(pool)
  const sessionId = 'coding-session' as SessionId
  const draft = await first.documentDrafts.save({
    sessionId,
    path: 'C:\\作品\\chapter.md',
    baseVersion: 'disk-v1',
    text: '# Chapter\r\nनमस्ते\n',
    expectedDraftRevision: null,
  })
  await first.fiber.dispose()
  const reopened = await open(pool)
  expect(reopened.documentDrafts.read(sessionId, draft.path)).toEqual(draft)
  const latest = await reopened.documentDrafts.save({
    ...draft,
    text: 'Edited draft',
    expectedDraftRevision: draft.revision,
  })
  await expect(
    reopened.documentDrafts.save({ ...draft, text: 'Older request', expectedDraftRevision: draft.revision }),
  ).rejects.toThrow('newer recovery draft')
  await expect(reopened.documentDrafts.clear(sessionId, draft.path, draft.revision)).rejects.toThrow(
    'newer recovery draft',
  )
  expect(reopened.documentDrafts.read(sessionId, draft.path)?.text).toBe('Edited draft')
  await reopened.documentDrafts.clear(sessionId, draft.path, latest.revision)
  expect(reopened.documentDrafts.read(sessionId, draft.path)).toBeUndefined()
})
