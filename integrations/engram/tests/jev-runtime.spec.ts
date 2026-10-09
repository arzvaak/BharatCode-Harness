import { statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedJevConfig } from '../src/config.ts'
import {
  effectiveJevConfig,
  jevConfigView,
  jevOverridePath,
  loadJevOverride,
  maskApiKey,
  parseJevPatch,
  resolveJevField,
  saveJevOverride,
} from '../src/jev/runtime.ts'

/** Yml baseline fixture: with an empty panel override it passes through as-is; the three thresholds always come from the baseline. */
const baseConfig: ResolvedJevConfig = {
  enabled: true,
  apiKey: 'yml-key-1234567890',
  baseUrl: 'https://api.typesafe.ai',
  model: 'jev-1',
  timeoutMs: 3000,
  deferMergeAbove: 0.85,
  deferAcceptBelow: 0.15,
  contradictMinProbability: 0.8,
}

describe('loadJevOverride', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engram-jev-runtime-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('missing override file: empty override, falls back to yml', () => {
    expect(loadJevOverride(dir)).toEqual({})
  })

  it('corrupt JSON: self-heals as empty override, does not throw', async () => {
    await writeFile(jevOverridePath(dir), '{ not json', 'utf8')
    expect(loadJevOverride(dir)).toEqual({})
  })

  it('valid JSON but not an object (number/string/null): treated as empty override', async () => {
    await writeFile(jevOverridePath(dir), '42', 'utf8')
    expect(loadJevOverride(dir)).toEqual({})
    await writeFile(jevOverridePath(dir), '"text"', 'utf8')
    expect(loadJevOverride(dir)).toEqual({})
    await writeFile(jevOverridePath(dir), 'null', 'utf8')
    expect(loadJevOverride(dir)).toEqual({})
  })

  it('drops wrongly-typed fields and unknown fields, keeps valid fields', async () => {
    await writeFile(
      jevOverridePath(dir),
      JSON.stringify({
        enabled: 'yes',
        apiKey: 123,
        baseUrl: 'https://panel.test',
        model: 'panel-model',
        timeoutMs: 1.5,
        unknown: 'ignored',
      }),
      'utf8',
    )
    expect(loadJevOverride(dir)).toEqual({ baseUrl: 'https://panel.test', model: 'panel-model' })
  })
})

describe('saveJevOverride', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engram-jev-runtime-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads back the same object after saving, file mode 0600', () => {
    const override = { enabled: false, apiKey: 'panel-key', baseUrl: 'https://panel.test' }
    saveJevOverride(dir, override)
    expect(loadJevOverride(dir)).toEqual(override)
    // mode & 0o777: masks the file-type bits and compares only the permission bits.
    expect(statSync(jevOverridePath(dir)).mode & 0o777).toBe(0o600)
  })
})

describe('parseJevPatch', () => {
  /** Merge-base fixture: verifies absent fields are kept and empty strings are cleared. */
  const current = { enabled: true, apiKey: 'old-key', baseUrl: 'https://old.test', model: 'old-model', timeoutMs: 3000 }

  it('empty patch: returns a shallow copy of current with all fields kept', () => {
    expect(parseJevPatch(current, {})).toEqual(current)
  })

  it('enabled not a boolean: reject the whole patch', () => {
    expect(parseJevPatch(current, { enabled: 'yes' })).toBe('invalid: jev.enabled must be a boolean')
  })

  it('apiKey not a string: reject the whole patch', () => {
    expect(parseJevPatch(current, { apiKey: 123 })).toBe('invalid: jev.apiKey must be a string')
  })

  it('apiKey empty string or whitespace only: clears the panel override, falls back to yml', () => {
    expect(parseJevPatch(current, { apiKey: '' })).toEqual({ ...current, apiKey: undefined })
    expect(parseJevPatch(current, { apiKey: '   ' })).toEqual({ ...current, apiKey: undefined })
  })

  it('apiKey non-empty: kept after trimming surrounding whitespace', () => {
    expect(parseJevPatch(current, { apiKey: '  new-key  ' })).toEqual({ ...current, apiKey: 'new-key' })
  })

  it('baseUrl invalid (not a URL or not http(s) protocol): reject the whole patch', () => {
    expect(parseJevPatch(current, { baseUrl: 'not-a-url' })).toBe('invalid: jev.baseUrl must be an http(s) URL')
    expect(parseJevPatch(current, { baseUrl: 'ftp://panel.test' })).toBe('invalid: jev.baseUrl must be an http(s) URL')
  })

  it('baseUrl valid http(s): kept after trimming surrounding whitespace', () => {
    expect(parseJevPatch(current, { baseUrl: ' http://panel.test ' })).toEqual({ ...current, baseUrl: 'http://panel.test' })
  })

  it('model blank or non-string: reject the whole patch; valid value trimmed', () => {
    expect(parseJevPatch(current, { model: '   ' })).toBe('invalid: jev.model cannot be empty')
    expect(parseJevPatch(current, { model: 42 })).toBe('invalid: jev.model cannot be empty')
    expect(parseJevPatch(current, { model: ' m ' })).toEqual({ ...current, model: 'm' })
  })

  it('timeoutMs non-integer or out of range: reject the whole patch; boundaries 1000/60000 pass', () => {
    expect(parseJevPatch(current, { timeoutMs: 999 })).toBe('invalid: jev.timeoutMs must be an integer in 1000-60000 ms')
    expect(parseJevPatch(current, { timeoutMs: 60001 })).toBe('invalid: jev.timeoutMs must be an integer in 1000-60000 ms')
    expect(parseJevPatch(current, { timeoutMs: 1.5 })).toBe('invalid: jev.timeoutMs must be an integer in 1000-60000 ms')
    expect(parseJevPatch(current, { timeoutMs: '3000' })).toBe('invalid: jev.timeoutMs must be an integer in 1000-60000 ms')
    expect(parseJevPatch(current, { timeoutMs: 1000 })).toEqual({ ...current, timeoutMs: 1000 })
    expect(parseJevPatch(current, { timeoutMs: 60000 })).toEqual({ ...current, timeoutMs: 60000 })
  })

  it('any invalid field rejects the whole patch: valid fields are not persisted either', () => {
    const result = parseJevPatch(current, { model: 'good', timeoutMs: 1 })
    expect(result).toBe('invalid: jev.timeoutMs must be an integer in 1000-60000 ms')
  })
})

describe('effectiveJevConfig', () => {
  it('empty override: passes the baseline through as-is', () => {
    expect(effectiveJevConfig(baseConfig, {})).toEqual(baseConfig)
  })

  it('panel field-level overrides apply; the three thresholds always come from the baseline', () => {
    const merged = effectiveJevConfig(baseConfig, {
      enabled: true,
      apiKey: 'panel-key',
      baseUrl: 'https://panel.test',
      model: 'panel-model',
      timeoutMs: 5000,
    })
    expect(merged.baseUrl).toBe('https://panel.test')
    expect(merged.model).toBe('panel-model')
    expect(merged.timeoutMs).toBe(5000)
    expect(merged.apiKey).toBe('panel-key')
    expect(merged.deferMergeAbove).toBe(0.85)
    expect(merged.deferAcceptBelow).toBe(0.15)
    expect(merged.contradictMinProbability).toBe(0.8)
  })

  it('enabled=true but no key anywhere: forced down to enabled=false', () => {
    const merged = effectiveJevConfig({ ...baseConfig, apiKey: undefined }, { enabled: true })
    expect(merged.enabled).toBe(false)
    expect(merged.apiKey).toBeUndefined()
  })

  it('panel disables the switch: disabled even though yml has a key, and the key is not exposed', () => {
    const merged = effectiveJevConfig(baseConfig, { enabled: false })
    expect(merged.enabled).toBe(false)
    expect(merged.apiKey).toBeUndefined()
  })
})

describe('maskApiKey', () => {
  it('length > 8: shows the last 4 characters', () => {
    expect(maskApiKey('abcd1234efgh')).toBe('****efgh')
  })

  it('length <= 8: fully masked', () => {
    expect(maskApiKey('abcd1234')).toBe('******')
    expect(maskApiKey('k')).toBe('******')
  })
})

describe('jevConfigView', () => {
  it('key configured: apiKeySet is true, mask comes from the merged key', () => {
    const view = jevConfigView(baseConfig, {})
    expect(view.enabled).toBe(true)
    expect(view.apiKeySet).toBe(true)
    expect(view.apiKeyMask).toBe('****7890')
    expect(view.baseUrl).toBe('https://api.typesafe.ai')
    expect(view.model).toBe('jev-1')
    expect(view.timeoutMs).toBe(3000)
    expect(view.deferMergeAbove).toBe(0.85)
    expect(view.deferAcceptBelow).toBe(0.15)
    expect(view.contradictMinProbability).toBe(0.8)
  })

  it('no key, degraded: apiKeySet is false, mask is null', () => {
    const view = jevConfigView({ ...baseConfig, apiKey: undefined }, {})
    expect(view.enabled).toBe(false)
    expect(view.apiKeySet).toBe(false)
    expect(view.apiKeyMask).toBeNull()
  })
})

describe('resolveJevField', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'engram-jev-runtime-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('yml enabled with a key, no override file: assembles the judge', () => {
    const field = resolveJevField(baseConfig, dir)
    expect(typeof field.judge?.ask).toBe('function')
  })

  it('yml disabled: empty object, no judge assembled', () => {
    expect(resolveJevField({ ...baseConfig, enabled: false }, dir)).toEqual({})
  })

  it('panel override disables the switch: re-reads the override file immediately, judge disappears', async () => {
    expect(typeof resolveJevField(baseConfig, dir).judge?.ask).toBe('function')
    saveJevOverride(dir, { enabled: false })
    expect(resolveJevField(baseConfig, dir)).toEqual({})
  })

  it('panel override adds a key: assembles the judge even when yml has no key', async () => {
    saveJevOverride(dir, { enabled: true, apiKey: 'panel-key' })
    const field = resolveJevField({ ...baseConfig, apiKey: undefined }, dir)
    expect(typeof field.judge?.ask).toBe('function')
  })
})
