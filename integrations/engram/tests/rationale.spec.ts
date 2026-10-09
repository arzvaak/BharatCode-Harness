import { describe, expect, it } from 'vitest'
import { buildSelectionRationale, wrapWithRationale } from '../src/selection-rationale.ts'
import { asMemoryId } from '../src/types.ts'
import type { MemoryRecord } from '../src/types.ts'

const NOW = Date.now()

/** Test MemoryRecord factory. */
function makeRecord(overrides: Partial<MemoryRecord> & { id?: string; content?: string } = {}): MemoryRecord {
  return {
    id: asMemoryId(overrides.id ?? '00000000-0000-0000-0000-000000000001'),
    scope: overrides.scope ?? 'user',
    kind: overrides.kind ?? 'fact',
    // Intentionally non-English test data: exercises content truncation only.
    content: overrides.content ?? '测试房间',
    importance: overrides.importance ?? 0.5,
    confidence: overrides.confidence ?? 0.5,
    status: overrides.status ?? 'active',
    // exactOptionalPropertyTypes: optional outcome is only written when present (Partial reads as undefined).
    ...(overrides.outcome !== undefined ? { outcome: overrides.outcome } : {}),
    createdAt: overrides.createdAt ?? NOW - 86_400_000,
    lastAccessedAt: overrides.lastAccessedAt ?? NOW - 30 * 86_400_000,
    accessCount: overrides.accessCount ?? 0,
    sourceSessionId: overrides.sourceSessionId ?? null,
    sourceRound: overrides.sourceRound ?? null,
    sourceSeq: overrides.sourceSeq ?? null,
  }
}

describe('injection rationale buildSelectionRationale', () => {
  it('empty records return empty string', () => {
    expect(buildSelectionRationale([])).toBe('')
  })

  it('a single record with no reasons is tagged "base selection"', () => {
    const r = buildSelectionRationale([makeRecord({})])
    expect(r).toContain('<engram_selection_rationale>')
    // Host string from src/selection-rationale.ts (reasonsLabel fallback).
    expect(r).toContain('Baseline selection')
    expect(r).toContain('测试房间')
  })

  it('recent: lastAccessedAt within 7 days', () => {
    const r = buildSelectionRationale([makeRecord({ lastAccessedAt: NOW - 2 * 86_400_000 })])
    // Host string from src/selection-rationale.ts (LABELS.recent).
    expect(r).toContain('Recently visited')
    expect(r).not.toContain('Baseline selection')
  })

  it('bright: importance × confidence ≥ 0.7', () => {
    const r = buildSelectionRationale([makeRecord({ importance: 0.9, confidence: 0.9 })])
    // Host string from src/selection-rationale.ts (LABELS.bright).
    expect(r).toContain('Bright landmark')
  })

  it('corridor-hit: accessCount ≥ 5', () => {
    const r = buildSelectionRationale([makeRecord({ accessCount: 10 })])
    // Host string from src/selection-rationale.ts (LABELS['corridor-hit']).
    expect(r).toContain('Frequent corridor visitor')
  })

  it('strong-evidence: outcome=success', () => {
    const r = buildSelectionRationale([makeRecord({ outcome: 'success' })])
    // Host string from src/selection-rationale.ts (LABELS['strong-evidence']).
    expect(r).toContain('Verified useful')
  })

  it('multiple reasons are joined with " / "', () => {
    const r = buildSelectionRationale([makeRecord({
      importance: 0.9, confidence: 0.9, accessCount: 10, outcome: 'success',
    })])
    // Host strings from src/selection-rationale.ts (LABELS, joined with ' / ').
    expect(r).toContain('Bright landmark / Frequent corridor visitor / Verified useful')
  })
})

describe('wrapWithRationale', () => {
  it('returns the profile text as-is when there are no records', () => {
    expect(wrapWithRationale('Profile text', [])).toBe('Profile text')
  })

  it('prepends the rationale block before the profile when records exist', () => {
    const out = wrapWithRationale('## User memory profile', [makeRecord({})])
    expect(out.startsWith('<engram_selection_rationale>')).toBe(true)
    expect(out).toContain('## User memory profile')
  })
})
