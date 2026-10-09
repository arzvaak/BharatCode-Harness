// Current BC derives preference forms from Config; config.spec.ts covers defaults,
// validation and volatile fields. The retired SettingsProvider API is not bundled.
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installSettings, SETTINGS_NAMESPACE } from '../../src/host/settings'

test('without a settings service the legacy adapter is inert', () => {
  const ctx = new Context()
  assert.equal(SETTINGS_NAMESPACE, 'dsh-context')
  assert.doesNotThrow(() => installSettings(ctx))
  assert.equal(ctx.get('settings'), undefined)
})

test('current Config-form service is retained without invoking retired registration', async () => {
  const ctx = new Context()
  const forms = { describe: () => [] }
  ctx.provide('settings', forms)
  installSettings(ctx)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(ctx.get('settings'), forms)
})

// Compatibility fixture only; current BC uses Config forms tested in config.spec.ts.
test('the legacy adapter registers its real schema when that face exists', async () => {
  const ctx = new Context()
  let namespace: unknown, schema: unknown
  ctx.provide('settings', { register(ns: unknown, value: unknown) { namespace = ns; schema = value } })
  installSettings(ctx)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(namespace, SETTINGS_NAMESPACE)
  assert.equal(typeof schema, 'function')
})
