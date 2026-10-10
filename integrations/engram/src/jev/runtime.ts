







import { readFileSync, writeFileSync } from 'node:fs'
import type { ResolvedJevConfig } from '../config.ts'
import type { MemoryJudge } from '../write-disposition.ts'
import { createMemoryJudge } from './client.ts'


export interface JevOverride {
  
  readonly enabled?: boolean
  
  readonly apiKey?: string
  
  readonly baseUrl?: string
  
  readonly model?: string
  
  readonly timeoutMs?: number
}


export interface JevConfigView {
  readonly enabled: boolean
  
  readonly apiKeySet: boolean
  
  readonly apiKeyMask: string | null
  readonly baseUrl: string
  readonly model: string
  readonly timeoutMs: number
  readonly deferMergeAbove: number
  readonly deferAcceptBelow: number
  readonly contradictMinProbability: number
}


export function jevOverridePath(dbDir: string): string {
  return `${dbDir}/jev-config.json`
}


export function loadJevOverride(dbDir: string): JevOverride {
  let raw: string
  try {
    raw = readFileSync(jevOverridePath(dbDir), 'utf8')
  } catch {

    return {}
  }
  try {
    return collectOverride(JSON.parse(raw) as unknown)
  } catch {

    return {}
  }
}


function collectOverride(value: unknown): JevOverride {
  if (value === null || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  return {
    ...(typeof raw['enabled'] === 'boolean' ? { enabled: raw['enabled'] } : {}),
    ...(typeof raw['apiKey'] === 'string' ? { apiKey: raw['apiKey'] } : {}),
    ...(typeof raw['baseUrl'] === 'string' ? { baseUrl: raw['baseUrl'] } : {}),
    ...(typeof raw['model'] === 'string' ? { model: raw['model'] } : {}),
    ...(typeof raw['timeoutMs'] === 'number' && Number.isInteger(raw['timeoutMs'])
      ? { timeoutMs: raw['timeoutMs'] }
      : {}),
  }
}


export function saveJevOverride(dbDir: string, override: JevOverride): void {
  writeFileSync(jevOverridePath(dbDir), `${JSON.stringify(override, null, 2)}\n`, { mode: 0o600 })
}








export function parseJevPatch(current: JevOverride, patch: Readonly<Record<string, unknown>>): JevOverride | string {
  const merged: {
    enabled?: boolean
    apiKey?: string
    baseUrl?: string
    model?: string
    timeoutMs?: number
  } = { ...current }
  if (patch['enabled'] !== undefined) {
    if (typeof patch['enabled'] !== 'boolean') return "invalid: jev.enabled must be a boolean"
    merged.enabled = patch['enabled']
  }
  if (patch['apiKey'] !== undefined) {
    if (typeof patch['apiKey'] !== 'string') return "invalid: jev.apiKey must be a string"

    const trimmed = patch['apiKey'].trim()
    if (trimmed === '') delete merged.apiKey
    else merged.apiKey = trimmed
  }
  if (patch['baseUrl'] !== undefined) {
    if (typeof patch['baseUrl'] !== 'string') return "invalid: jev.baseUrl must be a string"
    const value = patch['baseUrl'].trim()
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return "invalid: jev.baseUrl must be an http(s) URL"
    } catch {
      return "invalid: jev.baseUrl must be an http(s) URL"
    }
    merged.baseUrl = value
  }
  if (patch['model'] !== undefined) {
    if (typeof patch['model'] !== 'string' || patch['model'].trim() === '') return "invalid: jev.model cannot be empty"
    merged.model = patch['model'].trim()
  }
  if (patch['timeoutMs'] !== undefined) {
    const value = patch['timeoutMs']
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 60000) {
      return "invalid: jev.timeoutMs must be an integer in 1000-60000 ms"
    }
    merged.timeoutMs = value
  }
  return merged
}





export function effectiveJevConfig(base: ResolvedJevConfig, override: JevOverride): ResolvedJevConfig {
  const apiKey = override.apiKey ?? base.apiKey
  const enabled = (override.enabled ?? base.enabled) && apiKey !== undefined && apiKey !== ''
  return {
    enabled,
    apiKey: enabled ? apiKey : undefined,
    baseUrl: override.baseUrl ?? base.baseUrl,
    model: override.model ?? base.model,
    timeoutMs: override.timeoutMs ?? base.timeoutMs,
    deferMergeAbove: base.deferMergeAbove,
    deferAcceptBelow: base.deferAcceptBelow,
    contradictMinProbability: base.contradictMinProbability,
  }
}


export function maskApiKey(key: string): string {
  return key.length > 8 ? `****${key.slice(-4)}` : '******'
}


export function jevConfigView(base: ResolvedJevConfig, override: JevOverride): JevConfigView {
  const config = effectiveJevConfig(base, override)
  return {
    enabled: config.enabled,
    apiKeySet: config.apiKey !== undefined && config.apiKey !== '',
    apiKeyMask: config.apiKey === undefined || config.apiKey === '' ? null : maskApiKey(config.apiKey),
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    deferMergeAbove: config.deferMergeAbove,
    deferAcceptBelow: config.deferAcceptBelow,
    contradictMinProbability: config.contradictMinProbability,
  }
}






export function resolveJevField(base: ResolvedJevConfig, dbDir: string): { judge: MemoryJudge } | Record<string, never> {
  const config = effectiveJevConfig(base, loadJevOverride(dbDir))
  if (!config.enabled || config.apiKey === undefined || config.apiKey === '') return {}
  return { judge: createMemoryJudge(config) }
}
