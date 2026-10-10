/**
 * `autoImport` routes: the endpoint's `GET /models` answer is stored into the
 * profile when the route's credential appears, and a failed probe never
 * disturbs the stored list.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'

const servers: Server[] = []
const homes: string[] = []
const contexts: Array<Awaited<ReturnType<typeof boot>>> = []

afterEach(async () => {
  while (contexts.length > 0) {
    const ctx = contexts.pop()
    try { await ctx?.fiber.dispose() } catch { /* disposal races are not this suite's subject */ }
  }
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

interface ListingServer { url: string; paths: string[]; headers: IncomingMessage['headers'][] }

/** A stand-in gateway answering scripted `GET /models` replies in order. */
async function listingServer(replies: Array<{ status?: number; body?: string; delayMs?: number }>): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    paths.push(_request.url ?? '')
    headers.push(_request.headers)
    const reply = replies[Math.min(paths.length - 1, replies.length - 1)] ?? { status: 200, body: '{}' }
    const body = reply.body ?? '{}'
    response.writeHead(reply.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    if (reply.delayMs) setTimeout(() => { response.end(body) }, reply.delayMs)
    else response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

/** Boot a minimal profile whose bundle mounts the gateway route under test. */
async function harness(baseURL: string): Promise<{ ctx: Awaited<ReturnType<typeof boot>>; entryId: string }> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-pi-autoimport-')))
  homes.push(home)
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: config-editor',
    '      name: cordis:editor',
    '    - id: settings',
    '      name: cordis:settings',
    '    - id: runtime',
    '      name: cordis:runtime',
    '    - id: credentials',
    '      name: cordis:credentials',
    `      config: { path: '${join(home, '.credentials.yaml')}', watch: false }`,
    '    - id: llm-pi-ai',
    '      name: cordis:pi',
    '      config:',
    '        providers:',
    '          gateway:',
    '            displayName: Gateway',
    '            apiKeyEnv: GW_IMPORT_KEY',
    '            api: openai-completions',
    `            baseURL: ${JSON.stringify(baseURL)}`,
    '            autoImport: true',
    '            models:',
    '              - id: seed-model',
    '                name: Seed Model',
    '                contextWindow: 4096',
    '                maxTokens: 1024',
    "                reasoningEfforts: { 'off': none, high: high }",
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (root) => {
    root.provide('profileContext', profile)
    Object.assign(root.loader.builtins, {
      editor: ConfigEditor,
      settings: Settings,
      runtime: LlmRuntime,
      credentials: LocalCredentialProvider,
      pi: LlmPiAi,
    })
  })
  contexts.push(ctx)
  return { ctx, entryId: 'llm-pi-ai' }
}

/** The live raw configuration of the pi-ai row. */
function gatewayConfig(ctx: Awaited<ReturnType<typeof boot>>): Record<string, unknown> {
  const entry = ctx.configEditor.entries().find(row => row.options.id === 'llm-pi-ai')
  if (entry === undefined) throw new Error('llm-pi-ai entry missing')
  return entry.options.config as Record<string, unknown>
}

function models(ctx: Awaited<ReturnType<typeof boot>>): Array<Record<string, unknown>> {
  const providers = gatewayConfig(ctx).providers as Record<string, Record<string, unknown>>
  return (providers.gateway?.models ?? []) as Array<Record<string, unknown>>
}

describe('endpoint-owned model membership', () => {
  it('imports the listing when the credential appears, preserving declared capabilities', async () => {
    const server = await listingServer([{ body: JSON.stringify({
      data: [{ id: 'seed-model', name: 'Seed Model (live)' }, { id: 'alpha-new' }],
    }) }])
    const { ctx } = await harness(server.url)

    // Boot probes only reach for a credential; with none stored the endpoint
    // is never touched and the seed stays as shipped.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(server.paths).toEqual([])
    expect(models(ctx).map(model => model.id)).toEqual(['seed-model'])

    await ctx.get('credentials')!.set(credentialRef('GW_IMPORT_KEY'), 'sk-test-live')

    await vi.waitFor(() => {
      expect(models(ctx).map(model => model.id)).toEqual(['seed-model', 'alpha-new'])
    }, { timeout: 10_000 })
    // Bearer auth from the stored credential proves the probe read it.
    expect(server.headers[0]?.authorization).toBe('Bearer sk-test-live')
    const seed = models(ctx)[0]
    if (seed === undefined) throw new Error('seed model missing from the shipped list')
    // The listing renamed the model and does not speak effort maps: membership
    // and disclosed names come from the endpoint, capabilities from config.
    expect(seed.name).toBe('Seed Model (live)')
    expect(seed.reasoningEfforts).toEqual({ 'off': 'none', high: 'high' })
    expect(seed.contextWindow).toBe(4096)
    expect(seed.maxTokens).toBe(1024)
  })

  it('keeps the stored list when the endpoint fails', async () => {
    const server = await listingServer([{ status: 500, body: 'upstream exploded' }])
    const { ctx } = await harness(server.url)
    const seedBefore = models(ctx)

    await ctx.get('credentials')!.set(credentialRef('GW_IMPORT_KEY'), 'sk-test-live')
    await vi.waitFor(() => { expect(server.paths.length).toBeGreaterThanOrEqual(1) }, { timeout: 10_000 })
    // Let the failure settle, then prove nothing was written over the seed.
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(models(ctx)).toEqual(seedBefore)
  })

  it('does not rewrite an unchanged listing (a no-op probe must not dirty the profile)', async () => {
    const server = await listingServer([{ body: JSON.stringify({ data: [{ id: 'seed-model', name: 'Seed Model' }] }) }])
    const { ctx } = await harness(server.url)
    const patchBefore = readFileSync(ctx.configEditor.documentPath, 'utf8')

    await ctx.get('credentials')!.set(credentialRef('GW_IMPORT_KEY'), 'sk-test-live')
    await vi.waitFor(() => { expect(server.paths.length).toBeGreaterThanOrEqual(1) }, { timeout: 10_000 })
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(models(ctx).map(model => model.id)).toEqual(['seed-model'])
    expect(readFileSync(ctx.configEditor.documentPath, 'utf8')).toBe(patchBefore)
  })

  it('adopts explicit advertised levels through max while retaining model compatibility', async () => {
    const server = await listingServer([{ body: JSON.stringify({ data: [{
      id: 'seed-model', supported_reasoning_levels: ['off', 'low', 'medium', 'high', 'max'],
      context_window: 12000, metadata: { input: ['text', 'image'] },
    }] }) }])
    const { ctx } = await harness(server.url)
    await ctx.get('credentials')!.set(credentialRef('GW_IMPORT_KEY'), 'sk-test-live')
    await vi.waitFor(() => {
      expect(models(ctx)[0]?.reasoningEfforts).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high', max: 'max' })
    })
    expect(models(ctx)[0]?.contextWindow).toBe(12000)
    expect(models(ctx)[0]?.input).toEqual(['text', 'image'])
    const resolved = await ctx.llm.resolveModelInfo('gateway', 'seed-model')
    expect(resolved?.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'low', 'medium', 'high', 'max'])
  })

  it('removes stale reasoning when the endpoint explicitly disables it', async () => {
    const server = await listingServer([{ body: JSON.stringify({ data: [{ id: 'seed-model', metadata: { reasoning: false } }] }) }])
    const { ctx } = await harness(server.url)
    await ctx.get('credentials')!.set(credentialRef('GW_IMPORT_KEY'), 'sk-test-live')
    await vi.waitFor(() => { expect(models(ctx)[0]?.reasoningEfforts).toBe(false) })
    expect((await ctx.llm.resolveModelInfo('gateway', 'seed-model'))?.reasoning).toBeUndefined()
  })

  it('refreshes on startup with an existing credential without probing on unrelated edits', async () => {
    vi.stubEnv('GW_IMPORT_KEY', 'sk-existing-key')
    const server = await listingServer([{ body: JSON.stringify({ data: [{ id: 'seed-model', supported_reasoning_levels: ['high', 'max'] }] }) }])
    const { ctx } = await harness(server.url)
    await vi.waitFor(() => { expect(models(ctx)[0]?.reasoningEfforts).toEqual({ high: 'high', max: 'max' }) })
    await ctx.settings.update('llm-pi-ai', { providers: { gateway: { displayName: 'Renamed' } } })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(server.paths).toEqual(['/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer sk-existing-key')
  })


  it('discards a stale catalog after credential rotation and refreshes with the new key', async () => {
    const server = await listingServer([
      { delayMs: 200, body: JSON.stringify({ data: [{ id: 'stale-account-model' }] }) },
      { body: JSON.stringify({ data: [{ id: 'seed-model', reasoningEfforts: { high: 'high', max: 'max' } }] }) },
    ])
    const { ctx } = await harness(server.url)
    await ctx.get('credentials')!.set(credentialRef('GW_IMPORT_KEY'), 'sk-old-key')
    await vi.waitFor(() => { expect(server.paths).toHaveLength(1) })
    await ctx.get('credentials')!.set(credentialRef('GW_IMPORT_KEY'), 'sk-new-key')
    await vi.waitFor(() => { expect(models(ctx)[0]?.reasoningEfforts).toEqual({ high: 'high', max: 'max' }) })
    expect(models(ctx).map(model => model.id)).toEqual(['seed-model'])
    expect(server.headers.map(headers => headers.authorization)).toEqual(['Bearer sk-old-key', 'Bearer sk-new-key'])
  })

})
