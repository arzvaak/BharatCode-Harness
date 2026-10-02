/** Inspect effective built-profile settings without evaluating dump-config JavaScript tags. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'

const schema = yaml.DEFAULT_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ expression: value }) }))

/** Parse a composed tree; executable expressions remain data. */
export function parseComposition(text) {
  const rows = yaml.load(text, { schema })
  assert.ok(Array.isArray(rows) && rows.length > 0, 'Composed profile must have rows')
  return rows
}

/** Assert explicit fork settings; omitted/renamed rows and disabled plugins fail. */
export function assertComposition(rows, customized = false, continuation = true) {
  const row = id => {
    const matches = rows.filter(entry => entry.id === id)
    assert.equal(matches.length, 1, `Expected one ${id} row`)
    assert.notEqual(matches[0].disabled, true, `${id} is disabled`)
    return matches[0]
  }
  if (continuation) {
    const plugin = row('max-tokens-continue')
    assert.equal(plugin.name, '@local/max-tokens-continue')
    for (const [key, value] of Object.entries({ enabled: true, maxContinuations: 9, requireProgress: true })) {
      assert.equal(plugin.config?.[key], value, `max-tokens-continue ${key}`)
    }
  }
  row('llm')
  row('session')
  if (!customized) return
  assert.deepEqual(row('agent-default-model').config, { provider: 'bharatcode', model: 'deepseek-v4.1-flash', reasoningEffort: 'max' })
  assert.equal(row('web').config.searchProvider, 'searxng', 'web searchProvider')
  assert.equal(row('web').config.fetchProvider, 'http', 'web fetchProvider')
  assert.equal(row('agent-preset-registry').config.selectedDefault, 'cordis', 'preset selectedDefault')
  const model = row('llm-pi-ai').config.providers.bharatcode.models.find(model => model.id === 'deepseek-v4.1-flash')
  assert.equal(model?.contextWindow, 1000000, 'model contextWindow')
  assert.equal(model?.maxTokens, 32000, 'model maxTokens')
}

/** Dump fresh profiles and a sanitized desktop overlay using the built CLI under private Harness homes. */
function dump(root, args, env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 60_000 })
  assert.equal(result.signal, null, 'Profile dump exceeded deadline')
  assert.equal(result.status, 0, result.stderr || String(result.error ?? 'Profile dump failed'))
  assert.equal(result.stderr, '', 'Loader diagnostics must be empty')
  return result.stdout
}

export function verifyProfiles(root = process.cwd()) {
  const temporary = mkdtempSync(join(tmpdir(), 'bharat-profile-composition-'))
  try {
    for (const profile of ['web', 'headless', 'sdk', 'sdk-minimal', 'acp']) {
      const args = [join(root, 'apps/cli/lib/bin.js'), '--profile', 'ci', '--from-default-profile', profile, '--dump-config']
      const env = { ...process.env, DSH_HOME: join(temporary, profile), DSH_PROFILE: '', DSH_DESKTOP_WEB_PORT: '', DSH_WEB_SEARCH_PROVIDER: '', DSH_WEB_FETCH_PROVIDER: '' }
      const output = dump(root, args, env)
      assertComposition(parseComposition(output), false, profile === 'web')
      if (profile === 'web') {
        assert.ok(output.indexOf('# == @deepseek-ai/dsh-base') < output.indexOf('# == @deepseek-ai/dsh-web-app'), 'base bundle must precede web bundle')
        const custom = dump(root, [...args, '--patch', join(root, 'apps/cli/tests/profiles/web/tests/fixtures/fork-compatibility/desktop.patch.yml')], { ...env, DSH_HOME: join(temporary, 'desktop-customized') })
        assertComposition(parseComposition(custom), true)
      }
      console.log(`composition: ${profile} effective settings checked`)
    }
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) verifyProfiles()
