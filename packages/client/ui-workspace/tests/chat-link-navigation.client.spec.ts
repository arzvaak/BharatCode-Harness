import { expect, it, vi } from 'vitest'
import { installChatLinkNavigation } from '../src/client/chat-links.ts'
function fixture() {
  let notification!: () => void; let changed!: () => void
  let ready = false; let navigation = new AbortController()
  const open = vi.fn(); const unavailable = vi.fn()
  const takePending = vi.fn(async () => 'dsh://sessions/source')
  const stop = installChatLinkNavigation({ takePending, subscribe: (listener) => { notification = listener; return () => {} } }, {
    ready: () => ready, available: id => id === 'source', open, unavailable,
    navigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    subscribe: (listener) => { changed = listener; return () => {} },
  })
  return { open, unavailable, takePending, stop, notify: () => { notification() },
    ready: () => { ready = true; changed() }, cancel: () => { navigation.abort() } }
}
it('opens an existing chat only after profile metadata is ready', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.takePending).toHaveBeenCalled() })
  expect(f.open).not.toHaveBeenCalled(); f.ready()
  await vi.waitFor(() => { expect(f.open).toHaveBeenCalledWith('source') }); f.stop()
})
it('preserves a later manual selection and refuses late opens after disposal', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.takePending).toHaveBeenCalled() })
  f.cancel(); f.ready(); expect(f.open).not.toHaveBeenCalled(); f.stop()
})
it('shows an unavailable chat without creating a replacement', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.takePending).toHaveBeenCalled() }); f.ready()
  f.takePending.mockResolvedValueOnce('dsh://sessions/missing'); f.notify()
  await vi.waitFor(() => { expect(f.unavailable).toHaveBeenCalledOnce() }); f.stop()
})

it('does not open metadata that arrives after the client was disposed', async () => {
  const f = fixture(); await vi.waitFor(() => { expect(f.takePending).toHaveBeenCalled() })
  f.stop(); f.ready(); expect(f.open).not.toHaveBeenCalled()
})
it('coalesces a notification during IPC and opens only the latest queued link', async () => {
  let notify!: () => void
  let resolve!: (link: string) => void
  const open = vi.fn()
  const takePending = vi.fn()
    .mockImplementationOnce(async () => await new Promise<string>((done) => { resolve = done }))
    .mockResolvedValueOnce('dsh://sessions/latest')
  const stop = installChatLinkNavigation({ takePending, subscribe: (listener) => { notify = listener; return () => {} } }, {
    ready: () => true, available: () => true, open, unavailable: vi.fn(),
    navigation: () => new AbortController().signal, subscribe: () => () => {},
  })
  notify(); resolve('dsh://sessions/older')
  await vi.waitFor(() => { expect(open).toHaveBeenCalledExactlyOnceWith('latest') }); stop()
})
