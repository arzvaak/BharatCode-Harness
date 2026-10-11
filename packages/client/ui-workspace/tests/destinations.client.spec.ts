import { expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkflowPresentationState, WorkflowView } from '../src/client/workflows/presentation.ts'
import { WorkflowDestinations } from '../src/client/workflows/destinations.ts'
function fixture() {
  let selected = 'chat-a' as SessionId
  const state: WorkflowPresentationState = { profiles: { 'chat-a': 'coding' } }
  let navigation = new AbortController()
  const contexts = new Map<string, string>()
  const live = new Set<SessionId>([selected])
  const create = vi.fn(async () => { const id = `session-${live.size}` as SessionId; live.add(id); return id })
  const remember = (session: SessionId, profile: WorkflowView, bookmark = true) => {
    state.owners ??= {}; state.destinations ??= {}
    state.owners[session] = profile; state.profiles[session] = profile; if (bookmark) state.destinations[JSON.stringify([contexts.get(session) ?? 'ungrouped', profile])] = session
  }
  const open = vi.fn((session: SessionId) => { selected = session; nav.observe() })
  const failed = vi.fn()
  const nav = new WorkflowDestinations({ selection: () => selected, snapshot: () => state, available: session => live.has(session), remember, create, open, context: session => contexts.get(session ?? '') ?? 'ungrouped', visible: () => true, navigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    pending: (profile) => { state.navigating = profile }, failed })
  return { nav, state, create, open, failed, live, remember, contexts,
    cancelNavigation: () => { navigation.abort() }, select: (id: SessionId) => { selected = id; nav.observe() } }
}
it('migrates legacy view-only choices to Chat and returns to independent remembered destinations', async () => {
  const f = fixture(); f.nav.observe()
  expect(f.state.profiles['chat-a']).toBe('chat')
  await f.nav.navigate('coding'); const coding = f.state.destinations!['["ungrouped","coding"]']
  expect(coding).not.toBe('chat-a')
  await f.nav.navigate('chat'); expect(f.open).toHaveBeenLastCalledWith('chat-a')
  await f.nav.navigate('coding'); expect(f.open).toHaveBeenLastCalledWith(coding)
  expect(f.create).toHaveBeenCalledTimes(1)
})
it('does not allow a slow destination creation to replace a later workflow', async () => {
  const f = fixture(); let finish!: (id: SessionId) => void
  f.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const slow = f.nav.navigate('coding'); await f.nav.navigate('research')
  const research = f.state.destinations!['["ungrouped","research"]']
  finish('slow-coding' as SessionId); await slow
  expect(f.open).toHaveBeenLastCalledWith(research)
  expect(f.state.destinations!['["ungrouped","coding"]']).toBe('slow-coding')
})
it('keeps explicit history navigation when a create request completes late', async () => {
  const f = fixture(); let finish!: (id: SessionId) => void
  f.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const slow = f.nav.navigate('coding'); f.select('chat-a' as SessionId)
  finish('late' as SessionId); await slow
  expect(f.open).not.toHaveBeenCalled()
})
it('replaces an archived remembered destination and reports failed creation without changing selection', async () => {
  const f = fixture(); f.state.destinations = { '["ungrouped","coding"]': 'gone' as SessionId }
  f.create.mockRejectedValueOnce(new Error('Host unavailable'))
  await f.nav.navigate('coding'); expect(f.failed).toHaveBeenCalledOnce(); expect(f.open).not.toHaveBeenCalled(); expect(f.state.navigating).toBeUndefined()
  await f.nav.navigate('coding'); expect(f.open).toHaveBeenCalledOnce()
})
it('deduplicates repeated clicks while a destination is being created', async () => {
  const f = fixture(); let finish!: (id: SessionId) => void
  f.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const a = f.nav.navigate('coding'); const b = f.nav.navigate('coding')
  finish('once' as SessionId); await Promise.all([a,b])
  expect(f.create).toHaveBeenCalledOnce(); expect(f.open).toHaveBeenCalledOnce()
})

it('retains a newer Coding history selection when an old create finishes', async () => {
  const f = fixture(); let finish!: (id: SessionId) => void
  f.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const slow = f.nav.navigate('coding')
  const existing = 'existing-coding' as SessionId; f.live.add(existing); f.remember(existing, 'coding'); f.select(existing)
  finish('stale' as SessionId); await slow
  expect(f.state.destinations!['["ungrouped","coding"]']).toBe(existing)
  expect(f.open).not.toHaveBeenCalled()
})
it('clears pending state and refuses late persisted writes after disposal', async () => {
  const f = fixture(); let finish!: (id: SessionId) => void
  f.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const slow = f.nav.navigate('coding'); f.nav.dispose()
  expect(f.state.navigating).toBeUndefined()
  finish('disposed' as SessionId); await slow
  expect(f.state.owners?.disposed).toBeUndefined(); expect(f.open).not.toHaveBeenCalled()
})

it('does not reveal a conversation after a later panel navigation', async () => {
  const f = fixture(); let finish!: (id: SessionId) => void
  f.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const slow = f.nav.navigate('coding'); f.cancelNavigation()
  expect(f.state.navigating).toBeUndefined()
  finish('pending' as SessionId); await slow
  expect(f.open).not.toHaveBeenCalled()
})
it('keeps workflow destinations within the selected project', async () => {
  const f = fixture(); const first='project-a-coding' as SessionId
  f.live.add(first); f.contexts.set(first,'project-a'); f.remember(first,'coding')
  f.contexts.set('chat-a','project-b')
  f.create.mockImplementationOnce(async()=>{const second='project-b-coding' as SessionId;f.live.add(second);f.contexts.set(second,'project-b');return second})
  await f.nav.navigate('coding')
  expect(f.open).toHaveBeenLastCalledWith('project-b-coding')
  expect(f.state.destinations!['["project-a","coding"]']).toBe(first)
})
