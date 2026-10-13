import { expect, it, vi } from 'vitest'
import { installChatLinkNavigation } from '../src/client/chat-links.ts'
function fixture() {
  let notification!: () => void; let changed!: () => void
  let ready = false; let navigation = new AbortController()
  const open = vi.fn(); const unavailable = vi.fn()
  const peekPending = vi.fn(async () => 'dsh://sessions/source')
  const acknowledge = vi.fn(async () => {})
  const stop = installChatLinkNavigation({ peekPending, acknowledge,
    subscribe: (listener) => { notification = listener; return () => {} } }, {
    ready: () => ready, available: id => id === 'source', open, unavailable,
    navigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    subscribe: (listener) => { changed = listener; return () => {} },
  })
  return { open, unavailable, peekPending, acknowledge, stop, notify: () => { notification() },
    ready: () => { ready = true; changed() }, cancel: () => { navigation.abort() } }
}
it('opens an existing chat only after profile metadata is ready', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.peekPending).toHaveBeenCalled() })
  expect(f.open).not.toHaveBeenCalled(); f.ready()
  await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('source') }); f.stop()
})
it('preserves a later manual selection and refuses late opens after disposal', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.peekPending).toHaveBeenCalled() })
  f.cancel(); f.ready(); expect(f.open).not.toHaveBeenCalled(); f.stop()
})
it('shows an unavailable chat without creating a replacement', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.peekPending).toHaveBeenCalled() }); f.ready()
  f.peekPending.mockResolvedValueOnce('dsh://sessions/missing'); f.notify()
  await vi.waitFor(() => { expect(f.unavailable).toHaveBeenCalledOnce() }); f.stop()
})

it('does not open metadata that arrives after the client was disposed', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.peekPending).toHaveBeenCalled() })
  f.stop(); f.ready(); expect(f.open).not.toHaveBeenCalled()
})
it('coalesces a notification during IPC and opens only the latest queued link', async () => {
  let notify!: () => void
  let resolve!: (link: string) => void
  const open = vi.fn()
  const peekPending = vi.fn()
    .mockImplementationOnce(async () => await new Promise<string>((done) => { resolve = done }))
    .mockResolvedValueOnce('dsh://sessions/latest')
  const acknowledge = vi.fn(async () => {})
  const stop = installChatLinkNavigation({ peekPending, acknowledge, subscribe: (listener) => { notify = listener; return () => {} } }, {
    ready: () => true, available: () => true, open, unavailable: vi.fn(),
    navigation: () => new AbortController().signal, subscribe: () => () => {},
  })
  notify(); resolve('dsh://sessions/older')
  await vi.waitFor(() => { expect(open).toHaveBeenCalledExactlyOnceWith('latest') }); stop()
})

it('retains a native request for the replacement client when startup is disposed before metadata', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.peekPending).toHaveBeenCalled() })
  f.stop(); f.ready()
  expect(f.acknowledge).not.toHaveBeenCalled()
  expect(f.open).not.toHaveBeenCalled()
})
it('acknowledges an opened or explicitly canceled request', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.peekPending).toHaveBeenCalled() }); f.ready()
  await vi.waitFor(() => { expect(f.acknowledge).toHaveBeenCalledWith('dsh://sessions/source') }); f.stop()
  const canceled = fixture(); await vi.waitFor(() => { expect(canceled.peekPending).toHaveBeenCalled() })
  canceled.cancel(); canceled.ready()
  expect(canceled.acknowledge).toHaveBeenCalledWith('dsh://sessions/source'); canceled.stop()
})
