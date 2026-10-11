// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
const bridges = vi.hoisted(
  () => [] as { oncalltool?: (args: { name: string; arguments: object }) => Promise<unknown>; close: () => Promise<void> }[],
)
vi.mock('@modelcontextprotocol/ext-apps/app-bridge', () => ({
  AppBridge: class {
    constructor() {
      bridges.push(this)
    }
    addEventListener() {}
    async connect() {}
    async close() {}
    async sendToolInput() {}
  },
  PostMessageTransport: class { constructor(readonly receiver: object, readonly sender: object) {} },
}))
import { AppFrame } from '../src/client/workflows/AppFrame.tsx'
afterEach(() => {
  cleanup()
  bridges.length = 0
})
it('rejects old frame requests after an app switch instead of calling the new host identity', async () => {
  const oldCall = vi.fn(async () => JSON.stringify({ content: [] }))
  const newCall = vi.fn(async () => JSON.stringify({ content: [] }))
  const error = vi.fn()
  const app = {
    server: 'a',
    tool: 'host',
    title: 'A',
    resourceUri: 'ui://a',
    generation: 'test-generation',
    allowedTools: ['shared'],
  }
  const view = render(<AppFrame resource={{ app, html: '' }} argumentsJson="{}" call={oldCall} error={error} />)
  const prior = bridges[0]!
  view.rerender(
    <AppFrame resource={{ app: { ...app, server: 'b' }, html: '' }} argumentsJson="{}" call={newCall} error={error} />,
  )
  await expect(prior.oncalltool?.({ name: 'shared', arguments: {} })).rejects.toThrow('not allowed')
  expect(oldCall).not.toHaveBeenCalled()
  expect(newCall).not.toHaveBeenCalled()
  await bridges[1]!.oncalltool?.({ name: 'shared', arguments: {} })
  expect(newCall).toHaveBeenCalledOnce()
  expect(oldCall).not.toHaveBeenCalled()
})
