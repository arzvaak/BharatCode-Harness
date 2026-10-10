import { describe, expect, it } from 'vitest'
import {
  buildAssessReminder, EvidenceBatches, INSUFFICIENT_HINT_THRESHOLD, MAX_BATCHES_PER_SESSION,
  MAX_EVIDENCE_REFS, MAX_MISSING_CHARS, assessEvidence, evidenceRefOf, isNextStrategy,
} from '../src/retrieve/evidence.ts'
import type { EvidenceBatch } from '../src/retrieve/evidence.ts'

/** Build a batch (the ref set is the evidence list from this search output). */
const batch = (...refs: string[]): EvidenceBatch => ({ batchId: 'batch-1', refs: new Set(refs), createdAt: 0 })

describe('evidenceRefOf', () => {
  it('uses "scope/room#slot" for slotted entries and "scope/#id-first-8-chars" for unslotted', () => {
    expect(evidenceRefOf('user', 'abcdefgh1234', { room: 'episode', index: 3 })).toBe('user/episode#3')
    expect(evidenceRefOf('project', 'abcdefgh1234', undefined)).toBe('project/#abcdefgh')
  })
})

describe('assessEvidence enforcement rules', () => {
  it('claims sufficient + valid evidence + answer → judged sufficient and not rewritten', () => {
    const verdict = assessEvidence(batch('user/fact#1', 'user/episode#2'), {
      sufficient: true,
      evidenceRefs: ['user/fact#1'],
      missing: '',
      nextStrategy: 'answer',
    })
    expect(verdict.sufficient).toBe(true)
    expect(verdict.evidenceRefs).toEqual(['user/fact#1'])
    expect(verdict.nextStrategy).toBe('answer')
    expect(verdict.forced).toBe(false)
  })

  it('claims sufficient but has no evidence → judged insufficient and strategy reverted to search', () => {
    const verdict = assessEvidence(batch('user/fact#1'), {
      sufficient: true,
      evidenceRefs: [],
      missing: 'Missing project conventions',
      nextStrategy: 'answer',
    })
    expect(verdict.sufficient).toBe(false)
    expect(verdict.nextStrategy).toBe('search_keyword')
    expect(verdict.forced).toBe(true)
  })

  it('some refs do not belong to this batch → recorded as rejected, valid evidence still usable', () => {
    const verdict = assessEvidence(batch('user/fact#1'), {
      sufficient: true,
      evidenceRefs: ['user/fact#1', 'user/fact#99'],
      missing: '',
      nextStrategy: 'answer',
    })
    expect(verdict.evidenceRefs).toEqual(['user/fact#1'])
    expect(verdict.rejectedRefs).toEqual(['user/fact#99'])
    expect(verdict.sufficient).toBe(true)
  })

  it('all refs do not belong to this batch → judged insufficient, strategy reverted to search', () => {
    const verdict = assessEvidence(batch('user/fact#1'), {
      sufficient: true,
      evidenceRefs: ['project/episode#9'],
      missing: '',
      nextStrategy: 'answer',
    })
    expect(verdict.sufficient).toBe(false)
    expect(verdict.evidenceRefs).toEqual([])
    expect(verdict.rejectedRefs).toEqual(['project/episode#9'])
    expect(verdict.nextStrategy).toBe('search_keyword')
  })

  it('claims insufficient but chose answer → rewritten to continue searching', () => {
    const verdict = assessEvidence(batch('user/fact#1'), {
      sufficient: false,
      evidenceRefs: ['user/fact#1'],
      missing: 'Missing timestamp',
      nextStrategy: 'answer',
    })
    expect(verdict.sufficient).toBe(false)
    expect(verdict.nextStrategy).toBe('search_keyword')
    expect(verdict.forced).toBe(true)
  })

  it('claims insufficient and gives a non-answer strategy → model strategy respected and not marked forced', () => {
    const verdict = assessEvidence(batch(), {
      sufficient: false,
      evidenceRefs: [],
      missing: 'Missing user deployment environment',
      nextStrategy: 'ask_user',
    })
    expect(verdict.nextStrategy).toBe('ask_user')
    expect(verdict.forced).toBe(false)
  })

  it('illegal strategy → falls back to search_keyword and marks forced', () => {
    const verdict = assessEvidence(batch(), {
      sufficient: false,
      evidenceRefs: [],
      missing: '',
      nextStrategy: 'do-something',
    })
    expect(verdict.nextStrategy).toBe('search_keyword')
    expect(verdict.requestedStrategy).toBe('do-something')
    expect(verdict.forced).toBe(true)
  })

  it('evidence exceeds cap: only the first 8 are kept, the rest go into droppedRefs', () => {
    const refs = Array.from({ length: MAX_EVIDENCE_REFS + 2 }, (_, index) => `user/fact#${String(index + 1)}`)
    const verdict = assessEvidence(batch(...refs), {
      sufficient: true,
      evidenceRefs: refs,
      missing: '',
      nextStrategy: 'answer',
    })
    expect(verdict.evidenceRefs).toHaveLength(MAX_EVIDENCE_REFS)
    expect(verdict.droppedRefs).toEqual([`user/fact#${String(MAX_EVIDENCE_REFS + 1)}`, `user/fact#${String(MAX_EVIDENCE_REFS + 2)}`])
  })

  it('over-long gap description is truncated and marked; duplicate and blank refs are deduplicated', () => {
    const verdict = assessEvidence(batch('user/fact#1'), {
      sufficient: true,
      evidenceRefs: ['user/fact#1', ' user/fact#1 ', ''],
      missing: 'a'.repeat(MAX_MISSING_CHARS + 10),
      nextStrategy: 'answer',
    })
    expect(verdict.evidenceRefs).toEqual(['user/fact#1'])
    expect(verdict.missingTruncated).toBe(true)
    expect(verdict.missing).toHaveLength(MAX_MISSING_CHARS + 1)
  })
})

describe('EvidenceBatches registry', () => {
  it('batch ids are monotonically increasing, isolated per session', () => {
    const registry = new EvidenceBatches()
    const first = registry.register('sess-a', ['user/fact#1'])
    const second = registry.register('sess-b', ['user/fact#2'])
    expect(first.batchId).toBe('batch-1')
    expect(second.batchId).toBe('batch-2')
    expect(registry.get('sess-a', 'batch-1')?.refs.has('user/fact#1')).toBe(true)
    expect(registry.get('sess-b', 'batch-1')).toBeUndefined()
  })

  it('evicts the oldest batch when per-session cap is exceeded', () => {
    const registry = new EvidenceBatches()
    for (let index = 0; index <= MAX_BATCHES_PER_SESSION; index += 1) {
      registry.register('sess-a', ['user/fact#1'])
    }
    expect(registry.get('sess-a', 'batch-1')).toBeUndefined()
    expect(registry.get('sess-a', `batch-${String(MAX_BATCHES_PER_SESSION + 1)}`)).toBeDefined()
  })

  it('clear releases all batches for a session', () => {
    const registry = new EvidenceBatches()
    registry.register('sess-a', ['user/fact#1'])
    registry.clear('sess-a')
    expect(registry.get('sess-a', 'batch-1')).toBeUndefined()
  })
})

describe('EvidenceBatches verdict registration and consecutive-insufficient counter', () => {
  /** Sufficient verdict (valid evidence + answer strategy, code does not force a rewrite). */
  const sufficientVerdict = (ref: string) => assessEvidence(batch(ref), {
    sufficient: true, evidenceRefs: [ref], missing: '', nextStrategy: 'answer',
  })
  /** Insufficient verdict (claims sufficient but has no evidence, forced back to search). */
  const insufficientVerdict = (ref: string) => assessEvidence(batch(ref), {
    sufficient: true, evidenceRefs: [], missing: 'gap', nextStrategy: 'answer',
  })

  it('recordVerdict registers a verdict; pendingBatches lists only unassessed batches (registration order)', () => {
    const registry = new EvidenceBatches()
    const first = registry.register('sess', ['user/fact#1'])
    const second = registry.register('sess', ['user/fact#2'])
    expect(registry.pendingBatches('sess').map(item => item.batchId)).toEqual(['batch-1', 'batch-2'])
    registry.recordVerdict('sess', first.batchId, sufficientVerdict('user/fact#1'))
    expect(registry.get('sess', first.batchId)?.verdict?.sufficient).toBe(true)
    expect(registry.pendingBatches('sess').map(item => item.batchId)).toEqual([second.batchId])
  })

  it('recordVerdict is a no-op for a nonexistent batch (session-isolated or already evicted)', () => {
    const registry = new EvidenceBatches()
    registry.register('sess-a', ['user/fact#1'])
    expect(() => registry.recordVerdict('sess-b', 'batch-1', sufficientVerdict('user/fact#1'))).not.toThrow()
    expect(registry.get('sess-b', 'batch-1')).toBeUndefined()
    expect(registry.insufficientStreak('sess-b')).toBe(0)
  })

  it('insufficientStreak accumulates on consecutive insufficient verdicts, resets on sufficient, unassessed batches do not affect the count', () => {
    const registry = new EvidenceBatches()
    registry.register('sess', ['user/fact#1'])
    expect(registry.insufficientStreak('sess')).toBe(0)
    registry.recordVerdict('sess', 'batch-1', insufficientVerdict('user/fact#1'))
    expect(registry.insufficientStreak('sess')).toBe(1)
    registry.register('sess', ['user/fact#2'])
    registry.recordVerdict('sess', 'batch-2', insufficientVerdict('user/fact#2'))
    expect(registry.insufficientStreak('sess')).toBe(2)
    registry.register('sess', ['user/fact#3'])
    registry.recordVerdict('sess', 'batch-3', sufficientVerdict('user/fact#3'))
    expect(registry.insufficientStreak('sess')).toBe(0)
  })

  it('clear resets both batches and the insufficient counter', () => {
    const registry = new EvidenceBatches()
    registry.register('sess', ['user/fact#1'])
    registry.recordVerdict('sess', 'batch-1', insufficientVerdict('user/fact#1'))
    registry.clear('sess')
    expect(registry.pendingBatches('sess')).toEqual([])
    expect(registry.insufficientStreak('sess')).toBe(0)
  })
})

describe('buildAssessReminder', () => {
  it('returns undefined when there are no pending batches (no reminder needed)', () => {
    expect(buildAssessReminder(0, 3)).toBeUndefined()
  })

  it('gives a base reminder when pending; appends a different-search-mode suggestion after the insufficient threshold is reached', () => {
    const base = buildAssessReminder(1, 0)
    expect(base).toContain('1 search batch(es)')
    expect(base).toContain('engram_assess')
    expect(base).not.toContain('insufficient')

    const escalated = buildAssessReminder(2, INSUFFICIENT_HINT_THRESHOLD)
    expect(escalated).toContain('2 search batch(es)')
    expect(escalated).toContain('try a different room')
  })
})

describe('isNextStrategy', () => {
  it('recognizes legal strategies, rejects unknown values', () => {
    expect(isNextStrategy('answer')).toBe(true)
    expect(isNextStrategy('search_room')).toBe(true)
    expect(isNextStrategy('answer ')).toBe(false)
  })
})
