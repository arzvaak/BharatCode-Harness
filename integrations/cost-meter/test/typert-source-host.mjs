// The npm alpha still uses schema. Issue #149 was reported from a source checkout,
// so exercise the actual loader, registry and both gateways from a pinned commit.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { TYPERT } from '../lib/typert.host.js'
import { CLIENT_CONTRIBUTION } from './typert-codecs.mjs'

assert.ok(process.env.DSH_TEST_SOURCE_ROOT, 'set DSH_TEST_SOURCE_ROOT to the upstream source checkout')
assert.ok(process.env.DSH_TEST_NODE_MODULES, 'set DSH_TEST_NODE_MODULES to an installed DSH dependency directory')
const source = resolve(process.env.DSH_TEST_SOURCE_ROOT)
const req = createRequire(join(resolve(process.env.DSH_TEST_NODE_MODULES), '__codec_test.cjs'))
const work = mkdtempSync(join(tmpdir(), 'cm-typert-source-'))
try {
  const entry = path => JSON.stringify(join(source, path))
  const outfile = join(work, 'host.mjs')
  await build({
    stdin: { contents: `
      export { Context, Service } from '@deepseek-ai/cordis';
      export { validateTypertManifest } from ${entry('packages/typert/loader/src/index.ts')};
      export { default as Registry } from ${entry('packages/typert/registry/src/service.ts')};
      export { default as Gateway } from ${entry('packages/api/gateway/src/index.ts')};
      export { apply as applyClient } from ${entry('packages/api/gateway/src/client/index.ts')};
    `, resolveDir: source, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'installed-host-dependencies', setup(build) {
      build.onResolve({ filter: /^(@|ws$|zod$)/ }, args => {
        if (args.path === '@deepseek-ai/dsh-typert-protocol') return { path: join(source, 'packages/typert/protocol/src/index.ts') }
        if (args.path === 'ws') return { path: pathToFileURL(join(dirname(req.resolve('ws/package.json')), 'wrapper.mjs')).href, external: true }
        return { path: pathToFileURL(req.resolve(args.path)).href, external: true }
      })
    } }],
  })
  const { Context, Service, Registry, Gateway, applyClient, validateTypertManifest } = await import(pathToFileURL(outfile).href)
  assert.ok(validateTypertManifest('dsh-cost-meter', TYPERT))
  const withoutFactory = codec => { const { create, ...old } = codec; return old }
  for (const descriptor of TYPERT.invocations) {
    for (const broken of [
      { ...descriptor, result: withoutFactory(descriptor.result) },
      ...descriptor.parameters.map((_, index) => ({ ...descriptor, parameters: descriptor.parameters.map((p, i) => i === index ? { ...p, codec: withoutFactory(p.codec) } : p) })),
    ]) {
      assert.throws(() => validateTypertManifest('dsh-cost-meter', { ...TYPERT, invocations: [broken] }), /no create\(\) factory/, 'negative control reproduces the reported startup failure')
    }
  }
  const host = new Context(), client = new Context()
  try {
    await host.plugin(Registry)
    await client.plugin(Registry)
    host.typert.register(TYPERT)
    const brokenClient = { ...CLIENT_CONTRIBUTION, descriptors: CLIENT_CONTRIBUTION.descriptors.map(d => ({ ...d, result: withoutFactory(d.result) })) }
    assert.throws(() => client.typert.remotes.register(brokenClient), /create/)

    // Business stubs record dispatch only. No model, quota or credential service is contacted.
    const calls = []
    class Meter extends Service {
      constructor(ctx) {
        super(ctx, 'costMeter')
        this.typertRemote = { service: this, serviceKey: 'costMeter', namespace: 'costMeter' }
        for (const d of TYPERT.invocations) this[d.method] = (...args) => {
          calls.push([d.method, ...args])
          return { ok: true, message: d.method }
        }
      }
    }
    await host.plugin(Meter)
    await host.plugin(Gateway, {})
    let transported = 0
    class Connection extends Service {
      constructor(ctx) {
        super(ctx, 'connection')
        this.rpc = {
          open: async function* () {},
          call: async (channel, endpoint, payload, signal) => {
            assert.equal(channel, '/api')
            transported++
            const [namespace, method] = endpoint.split('/')
            return { ok: true, value: await host.typertGateway.invoke({ namespace, method, args: payload.args, signal }) }
          },
        }
      }
      registerGenerationSource() { return () => {} }
      start() { return { stop() {} } }
    }
    await client.plugin(Connection)
    await client.plugin({ apply: applyClient })
    await client.remote.$mount(CLIENT_CONTRIBUTION)
    const remote = client.get('remote.costMeter')
    for (const [method, args] of [
      ['getState', []], ['updateConfig', [{ locale: 'en' }]],
      ['refreshCustomBalance', [undefined]], ['refreshCustomBalance', [0]],
      ['refreshGatewayQuota', [undefined]], ['refreshGatewayQuota', ['fixture-source']],
      ['refreshCodingPlan', ['qwen']], ['getTopSessions', [10, 'cost', 'desc']],
      ['setCredential', ['goQuota', 'test-only']], ['clearCredential', ['goQuota']],
    ]) {
      const result = await remote[method](...args)
      assert.equal(result.ok, true)
      assert.equal(result.value.message, method)
      assert.deepEqual(calls.at(-1), [method, ...args])
    }
    const before = transported
    for (const [method, args] of [
      ['updateConfig', [null]], ['refreshCustomBalance', [8]],
      ['refreshCodingPlan', [42]], ['setCredential', ['goQuota', 42]],
    ]) await assert.rejects(remote[method](...args), /client api:.*rejected/)
    assert.equal(transported, before, 'invalid client inputs never reach transport')
    for (const [method, args, code] of [
      ['updateConfig', { patch: null }, 'gateway/input-invalid'],
      ['refreshCustomBalance', { index: 8 }, 'gateway/input-invalid'],
      ['refreshCodingPlan', { provider: 42 }, 'gateway/input-invalid'],
      ['setCredential', { target: 'goQuota' }, 'gateway/arguments-invalid'],
    ]) await assert.rejects(host.typertGateway.invoke({ namespace: 'costMeter', method, args }), error => error.code === code)
    assert.equal(calls.length, before, 'invalid host inputs never reach business methods')
    console.log('[ok] 真实源码宿主 loader/registry + Client→Host RPC：旧清单复现失败，新清单挂载及参数校验通过')
  } finally {
    await client.fiber.dispose()
    await host.fiber.dispose()
  }
} finally {
  assert.equal(dirname(work), tmpdir())
  rmSync(work, { recursive: true, force: true })
}
