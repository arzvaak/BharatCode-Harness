/** Built Web profile and sanitized desktop settings; no live provider credentials. */
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FiberState } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import type { TestContext } from 'vitest'
import { withDefaultWeb, webGet } from './default-web-process.ts'
import type { RuntimeRoster } from './runtime-roster.ts'

const fixtures = fileURLToPath(new URL('./fixtures/fork-compatibility/', import.meta.url))
const required = ['@local/max-tokens-continue', '@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-agent-preset-registry']
function assertActive(roster: RuntimeRoster) {
  for (const name of required) expect(roster.entries.find(entry => entry.name === name), name).toMatchObject({ state: FiberState.ACTIVE })
  expect(roster.entries.find(entry => entry.name.endsWith('/searxng.mjs'))).toMatchObject({ state: FiberState.ACTIVE })
}
async function inspect(test: TestContext, negative: 'none' | 'disabled-plugin' | 'wrong-provider' = 'none') {
  const queries: string[] = []
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://127.0.0.1')
    queries.push(url.searchParams.get('q') ?? '')
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ results: [{ url: 'https://example.org/compatibility', title: 'Compatibility fixture', content: 'local search result' }] }))
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const close = () => new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close((error) => { if (error) reject(error); else resolve() })
  })
  test.onTestFinished(async () => { if (server.listening) await close() })
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Search fixture has no assigned port')
    const patches = [join(fixtures, 'desktop.patch.yml')]
    await withDefaultWeb(test, async ({ url, request }) => {
      const roster = await request('roster')
      if (negative === 'disabled-plugin') { expect(() => { assertActive(roster) }).toThrow(); return }
      assertActive(roster)
      const auth = await webGet(url, test.signal)
      const cookie = auth.headers['set-cookie']?.[0]?.split(';', 1)[0]
      expect(cookie).toBeDefined()
      const result = await webGet(new URL('/compatibility-observer', url), test.signal, { cookie: cookie! })
      if (negative === 'wrong-provider') {
        expect(result.status).toBe(500)
        expect(result.text).toContain('not registered')
        expect(queries).toEqual([])
        return
      }
      expect(result.status, result.text).toBe(200)
      const observed: unknown = JSON.parse(result.text)
      expect(observed).toMatchObject({
        model: { provider: 'bharatcode', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' },
        preset: 'cordis',
        search: { sources: [{ url: 'https://example.org/compatibility', title: 'Compatibility fixture', snippet: 'local search result' }] },
      })
      expect(observed).toHaveProperty('presets', expect.arrayContaining(['standard', 'cordis']))
      expect(queries).toEqual(['fork compatibility'])
      expect(result.text).toContain('1000000')
      expect(result.text).toContain('32000')
    }, { patches, prepare: async (root) => {
      // The accepted out-of-tree adapter fixture resolves dependencies through this workspace.
      const provider = join(fixtures, 'searxng.mjs')
      const patch = join(root, 'compatibility.patch.yml')
      const entries: object[] = [{ insert: [
        { id: 'compatibility-search', name: pathToFileURL(provider).href, config: { baseURL: `http://127.0.0.1:${address.port}` } },
        { id: 'compatibility-observer', name: pathToFileURL(join(fixtures, 'observer.mjs')).href },
      ] }]
      if (negative === 'disabled-plugin') entries.push({ id: 'max-tokens-continue', disabled: true })
      if (negative === 'wrong-provider') entries.push({ id: 'web', config: { searchProvider: 'missing-search-provider', fetchProvider: 'http' } })
      await writeFile(patch, JSON.stringify(entries) + '\n')
      patches.push(patch)
      // A fresh home has no machine-specific user/profile settings to conceal an override failure.
      expect(await readFile(join(fixtures, 'desktop.patch.yml'), 'utf8')).not.toContain('bharatcode.ai')
    } })
  } finally { if (server.listening) await close() }
}
it('activates required plugins, preserves model/preset settings and routes search through SearXNG', test => inspect(test))
it('rejects an inactive required plugin in the actual running profile', test => inspect(test, 'disabled-plugin'))
it('rejects the wrong selected provider instead of silently using another search backend', test => inspect(test, 'wrong-provider'))
