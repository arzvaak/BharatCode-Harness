// #226: Host has a saved settings preference, while the active browser locale is optional.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supportedLocale, hostLocaleOf, localeOf } from '../lib/locale.js'
import { apply } from '../lib/index.js'
import { stateSchema } from '../lib/typert.host.js'

for (const [input, expected] of [['zh', 'zh'], ['ZH-CN', 'zh'], ['en_US', 'en'], ['en-GB', 'en'], ['fr', null], ['auto', null], [null, null], [42, null]]) assert.equal(supportedLocale(input), expected)
assert.equal(hostLocaleOf(null), null)
assert.equal(hostLocaleOf({ get: () => { throw Error('unsupported service') } }), null)
let preference = 'zh', active
const ctx = { get: name => name === 'locale' ? active : name === 'settings' ? {
  describe: options => { assert.deepEqual(options, { redactSecrets: true }); return [{ ns: 'other', value: { preference: 'en' } }, { ns: 'locale', value: { preference } }] },
} : undefined }
assert.equal(localeOf({ locale: 'auto' }, ctx), 'zh')
assert.equal(localeOf({ locale: 'en' }, ctx), 'en')
preference = 'en'
assert.equal(localeOf({ locale: 'zh' }, ctx), 'zh')
assert.equal(localeOf({ locale: 'auto' }, ctx), 'en')
active = { getSnapshot: () => ({ active: 'zh-CN' }) }
assert.equal(hostLocaleOf(ctx), 'zh')
active = { getSnapshot: () => ({ active: 'fr' }) }
assert.equal(hostLocaleOf(ctx), 'en', 'unsupported optional face falls through to saved supported preference')
active = undefined; preference = undefined
assert.equal(hostLocaleOf(ctx), null)
assert.equal(localeOf({ locale: 'auto' }, ctx), 'zh', 'unobservable browser/native preference retains the Host compatibility fallback')

const work = mkdtempSync(join(tmpdir(), 'cm-host-locale-'))
const names = ['DSH_HOME', 'DEEPSEEK_API_KEY', 'DSH_DEEPSEEK_API_KEY', 'DEEPSEEK_BALANCE_API_KEY', 'OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY', 'GO_API_KEY']
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]))
const originalFetch = globalThis.fetch
const effects = [], events = new Map()
let service
try {
  for (const name of names) delete process.env[name]
  process.env.DSH_HOME = work
  const file = join(work, 'storages', 'cost-meter', 'ledger.json')
  mkdirSync(join(work, 'storages', 'cost-meter'), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, days: {}, config: { locale: 'auto', goQuota: { enabled: true }, balance: { display: 'off' } } }))
  globalThis.fetch = async () => { throw Error('locale regression must not access the network') }
  preference = 'zh'
  apply({ ...ctx,
    provide: (name, value) => { if (name === 'costMeter') service = value },
    on: (name, fn) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); return () => events.get(name)?.delete(fn) },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') effects.push(cleanup) }, inject() {},
  })
  const emit = name => { for (const fn of events.get(name) ?? []) fn('locale') }
  let state = await service.getState()
  assert.equal(state.meta.locale, 'zh')
  assert.equal(state.config.locale, 'auto')
  assert.match(state.goQuota.message, /未找到/)
  stateSchema.parse(JSON.parse(JSON.stringify(state)))
  assert.match((await service.refreshBalance()).message, /关闭/)
  // No explicit refresh: a language event must invalidate the soft cached missing-key message.
  preference = 'en'; emit('settings/document-updated')
  state = await service.getState()
  assert.equal(state.meta.locale, 'en')
  assert.match(state.goQuota.message, /key/i)
  assert.doesNotMatch(state.goQuota.message, /未找到/)
  assert.match((await service.refreshBalance()).message, /off/i)
  state = await service.updateConfig({ locale: 'zh' })
  assert.match(state.goQuota.message, /未找到/)
  assert.equal(state.config.locale, 'zh')
  assert.equal(state.meta.locale, 'en', 'shared preference remains independent of explicit plugin override')
  await assert.rejects(service.updateConfig({ locale: 'en', decimals: -1 }), /rejected/i)
  await assert.rejects(service.updateConfig({ locale: 'zh', decimals: -1 }), /配置/)
  await service.updateConfig({ locale: 'auto' })
  // Hosts lacking events still recompute language at the next RPC; no new side-channel/persistence.
  preference = 'zh'
  state = await service.getState()
  assert.match(state.goQuota.message, /未找到/)
  preference = undefined
  state = await service.getState()
  assert.equal(Object.hasOwn(state.meta, 'locale'), false, 'missing preference is omitted, not fabricated')
  stateSchema.parse(JSON.parse(JSON.stringify(state)))
  for (const dispose of effects.splice(0).reverse()) dispose()
  assert.equal(JSON.parse(readFileSync(file)).config.locale, 'auto', 'resolved locale never replaces persisted auto')
  console.log('[ok] #226 Host locale preferences, live cached errors, explicit overrides, optional codec metadata and cleanup')
} finally {
  for (const dispose of effects.splice(0).reverse()) dispose()
  globalThis.fetch = originalFetch
  for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]
  rmSync(work, { recursive: true, force: true })
}
