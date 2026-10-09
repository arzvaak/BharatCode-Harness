import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('empty config falls back to ~/.dsh/engram and all defaults', () => {
    const resolved = resolveConfig({})
    expect(resolved.dbDir).toBe(join(homedir(), '.dsh', 'engram'))
    expect(resolved.injectProfile).toBe(true)
    expect(resolved.profileTopN).toBe(8)
    expect(resolved.modelCacheDir).toBe(join(homedir(), '.dsh', 'engram', 'models'))
    expect(resolved.ingest).toBe('off')
    expect(resolved.legacyMigration).toBe('eager')
    expect(resolved.routeOverride).toBeUndefined()
    expect(resolved.decayAfterDays).toBe(30)
    expect(resolved.decayImportanceBelow).toBe(0.3)
    expect(resolved.injectTokenBudget).toBe(1024)
    expect(resolved.rankRecencyWeight).toBe(0.2)
    expect(resolved.rankProofWeight).toBe(0.1)
    expect(resolved.queryRewrite).toBe(true)
    expect(resolved.injectItemBudgetStart).toBe(160)
    expect(resolved.injectItemBudgetDecay).toBe(0.9)
    expect(resolved.injectItemBudgetFloor).toBe(24)
    expect(resolved.assessReminder).toBe(true)
  })

  it('all explicit values are passed through', () => {
    const resolved = resolveConfig({
      dbDir: '/tmp/e', injectProfile: false, profileTopN: 3, modelCacheDir: '/tmp/m',
      hfEndpoint: 'https://hf-mirror.com', ingest: 'eager',
      provider: 'deepseek', model: 'deepseek-v4-flash',
      decayAfterDays: 7, decayImportanceBelow: 0.5,
      injectTokenBudget: 2048, rankRecencyWeight: 0, rankProofWeight: 1.5,
      queryRewrite: false,
      injectItemBudgetStart: 200, injectItemBudgetDecay: 0.8, injectItemBudgetFloor: 40,
      assessReminder: false,
    })
    expect(resolved.dbDir).toBe('/tmp/e')
    expect(resolved.injectProfile).toBe(false)
    expect(resolved.profileTopN).toBe(3)
    expect(resolved.modelCacheDir).toBe('/tmp/m')
    expect(resolved.hfEndpoint).toBe('https://hf-mirror.com')
    expect(resolved.ingest).toBe('eager')
    expect(resolved.routeOverride).toEqual({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    expect(resolved.decayAfterDays).toBe(7)
    expect(resolved.decayImportanceBelow).toBe(0.5)
    expect(resolved.injectTokenBudget).toBe(2048)
    expect(resolved.rankRecencyWeight).toBe(0)
    expect(resolved.rankProofWeight).toBe(1.5)
    expect(resolved.queryRewrite).toBe(false)
    expect(resolved.injectItemBudgetStart).toBe(200)
    expect(resolved.injectItemBudgetDecay).toBe(0.8)
    expect(resolved.injectItemBudgetFloor).toBe(40)
    expect(resolved.assessReminder).toBe(false)
  })

  it('unknown key fails loudly', () => {
    expect(() => resolveConfig({ nope: 1 } as never)).toThrow(/unknown config key/)
  })

  it('profileTopN out of range fails loudly', () => {
    expect(() => resolveConfig({ profileTopN: 0 })).toThrow(/profileTopN/)
    expect(() => resolveConfig({ profileTopN: 65 })).toThrow(/profileTopN/)
  })

  it('invalid ingest tier fails loudly', () => {
    expect(() => resolveConfig({ ingest: 'aggressive' as never })).toThrow(/ingest/)
  })

  it('providing only one of provider/model fails loudly', () => {
    expect(() => resolveConfig({ provider: 'deepseek' })).toThrow(/provider and model/)
    expect(() => resolveConfig({ model: 'v4' })).toThrow(/provider and model/)
  })

  it('decay params out of range fail loudly', () => {
    expect(() => resolveConfig({ decayAfterDays: 0 })).toThrow(/decayAfterDays/)
    expect(() => resolveConfig({ decayImportanceBelow: 2 })).toThrow(/decayImportanceBelow/)
  })

  it('injectTokenBudget out of range fails loudly', () => {
    expect(() => resolveConfig({ injectTokenBudget: 127 })).toThrow(/injectTokenBudget/)
    expect(() => resolveConfig({ injectTokenBudget: 8193 })).toThrow(/injectTokenBudget/)
    expect(() => resolveConfig({ injectTokenBudget: 1024.5 })).toThrow(/injectTokenBudget/)
  })

  it('ranking boost weights out of range fail loudly', () => {
    expect(() => resolveConfig({ rankRecencyWeight: -0.1 })).toThrow(/rankRecencyWeight/)
    expect(() => resolveConfig({ rankRecencyWeight: 2.1 })).toThrow(/rankRecencyWeight/)
    expect(() => resolveConfig({ rankProofWeight: 3 })).toThrow(/rankProofWeight/)
  })

  it('graduated decay budget params out of range fail loudly', () => {
    expect(() => resolveConfig({ injectItemBudgetStart: 39 })).toThrow(/injectItemBudgetStart/)
    expect(() => resolveConfig({ injectItemBudgetStart: 2001 })).toThrow(/injectItemBudgetStart/)
    expect(() => resolveConfig({ injectItemBudgetStart: 160.5 })).toThrow(/injectItemBudgetStart/)
    expect(() => resolveConfig({ injectItemBudgetDecay: 0.49 })).toThrow(/injectItemBudgetDecay/)
    expect(() => resolveConfig({ injectItemBudgetDecay: 1.01 })).toThrow(/injectItemBudgetDecay/)
    expect(() => resolveConfig({ injectItemBudgetFloor: 7 })).toThrow(/injectItemBudgetFloor/)
    expect(() => resolveConfig({ injectItemBudgetFloor: 201 })).toThrow(/injectItemBudgetFloor/)
  })

  it('floor above start fails loudly (truncation budget floor must not exceed the first-item budget)', () => {
    expect(() => resolveConfig({ injectItemBudgetStart: 100, injectItemBudgetFloor: 101 }))
      .toThrow(/injectItemBudgetFloor/)
  })

  it('non-boolean assessReminder fails loudly', () => {
    expect(() => resolveConfig({ assessReminder: 'yes' as never })).toThrow(/assessReminder/)
  })
})

describe('jev config', () => {
  it('disabled by default, endpoint/model/three thresholds fall to defaults', () => {
    const resolved = resolveConfig({}).jev
    expect(resolved.enabled).toBe(false)
    expect(resolved.apiKey).toBeUndefined()
    expect(resolved.baseUrl).toBe('https://api.typesafe.ai')
    expect(resolved.model).toBe('jev-latest')
    expect(resolved.timeoutMs).toBe(3000)
    expect(resolved.deferMergeAbove).toBe(0.85)
    expect(resolved.deferAcceptBelow).toBe(0.15)
    expect(resolved.contradictMinProbability).toBe(0.8)
  })

  it('explicit sub-config is fully passed through (apiKey may be absent when enabled=false)', () => {
    const resolved = resolveConfig({
      jev: { enabled: true, apiKey: 'k', baseUrl: 'https://j.example', model: 'jev-x', timeoutMs: 5000, deferMergeAbove: 0.9, deferAcceptBelow: 0.1, contradictMinProbability: 0.9 },
    }).jev
    expect(resolved.enabled).toBe(true)
    expect(resolved.apiKey).toBe('k')
    expect(resolved.baseUrl).toBe('https://j.example')
    expect(resolved.model).toBe('jev-x')
    expect(resolved.timeoutMs).toBe(5000)
    expect(resolved.deferMergeAbove).toBe(0.9)
    expect(resolved.deferAcceptBelow).toBe(0.1)
    expect(resolved.contradictMinProbability).toBe(0.9)
  })

  it('enabled=true with missing apiKey fails loudly', () => {
    expect(() => resolveConfig({ jev: { enabled: true } })).toThrow(/jev\.apiKey/)
    expect(() => resolveConfig({ jev: { enabled: true, apiKey: '' } })).toThrow(/jev\.apiKey/)
  })

  it('non-boolean enabled fails loudly', () => {
    expect(() => resolveConfig({ jev: { enabled: 'yes' as never } })).toThrow(/jev\.enabled/)
  })

  it('timeoutMs out of range or non-integer fails loudly', () => {
    expect(() => resolveConfig({ jev: { timeoutMs: 999 } })).toThrow(/jev\.timeoutMs/)
    expect(() => resolveConfig({ jev: { timeoutMs: 60001 } })).toThrow(/jev\.timeoutMs/)
    expect(() => resolveConfig({ jev: { timeoutMs: 2500.5 } })).toThrow(/jev\.timeoutMs/)
  })

  it('three thresholds out of range fail loudly', () => {
    expect(() => resolveConfig({ jev: { deferMergeAbove: 0.4 } })).toThrow(/deferMergeAbove/)
    expect(() => resolveConfig({ jev: { deferAcceptBelow: 0.6 } })).toThrow(/deferAcceptBelow/)
    expect(() => resolveConfig({ jev: { contradictMinProbability: 0.2 } })).toThrow(/contradictMinProbability/)
  })

  it('deferAcceptBelow >= deferMergeAbove crossover fails loudly', () => {
    // Each is individually legal (endpoints 0.5) but the combination is invalid: the accept threshold must not exceed the merge threshold.
    expect(() => resolveConfig({ jev: { deferAcceptBelow: 0.5, deferMergeAbove: 0.5 } })).toThrow(/less than/)
  })
})

describe('legacyMigration config', () => {
  it('accepts both policies', () => {
    expect(resolveConfig({ legacyMigration: 'eager' }).legacyMigration).toBe('eager')
    expect(resolveConfig({ legacyMigration: 'conservative' }).legacyMigration).toBe('conservative')
  })
  it.each(['typo', '', null, false, 1])('rejects invalid policy %s', (value) => {
    expect(() => resolveConfig({ legacyMigration: value as never })).toThrow(/legacyMigration/)
  })
})
