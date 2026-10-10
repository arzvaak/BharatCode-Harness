import { describe, expect, it } from 'vitest'
import {
  FIRST_INTERVAL_DAYS, INITIAL_EASE, MIN_EASE, SECOND_INTERVAL_DAYS, initialSchedule, isDue, nextSchedule,
} from '../src/review/sm2.ts'
import { KIND_ROOMS, ROOM_CAPACITY, assignSlot, type RoomOccupancy } from '../src/palace/slots.ts'
import { PLACARD_LOW_THRESHOLD, placardImprovementHint, scorePlacard } from '../src/imagery/score.ts'
import type { ReviewSchedule } from '../src/types.ts'

const DAY = 86_400_000
const NOW = 1_700_000_000_000

/** Build a review schedule state (defaults to the SM-2 initial state). */
const state = (patch: Partial<ReviewSchedule> = {}): ReviewSchedule =>
  ({ nextReviewAt: null, easeFactor: INITIAL_EASE, intervalDays: 0, reps: 0, ...patch })

describe('SM-2 spaced repetition scheduling', () => {
  it('initial schedule: due tomorrow, ease 2.5, interval 0, reps 0', () => {
    const schedule = initialSchedule(NOW)
    expect(schedule.nextReviewAt).toBe(NOW + FIRST_INTERVAL_DAYS * DAY)
    expect(schedule.easeFactor).toBe(INITIAL_EASE)
    expect(schedule.intervalDays).toBe(0)
    expect(schedule.reps).toBe(0)
  })

  it('consecutive passes: interval advances 1 → 6 → round(prev × ease)', () => {
    const first = nextSchedule(5, state(), NOW)
    expect(first.intervalDays).toBe(FIRST_INTERVAL_DAYS)
    expect(first.reps).toBe(1)
    const second = nextSchedule(5, first, NOW)
    expect(second.intervalDays).toBe(SECOND_INTERVAL_DAYS)
    expect(second.reps).toBe(2)
    // From the third pass on, interval is previous interval × ease (ease gains +0.1 per 5-grade round).
    const third = nextSchedule(5, second, NOW)
    expect(third.intervalDays).toBe(Math.round(SECOND_INTERVAL_DAYS * second.easeFactor))
    expect(third.reps).toBe(3)
    expect(third.nextReviewAt).toBe(NOW + third.intervalDays * DAY)
  })

  it('failure (grade < 3) resets to due in 1 day, clears reps, and penalizes ease with a floor', () => {
    const mature = state({ intervalDays: 30, reps: 5, easeFactor: MIN_EASE })
    const reset = nextSchedule(1, mature, NOW)
    expect(reset.intervalDays).toBe(FIRST_INTERVAL_DAYS)
    expect(reset.reps).toBe(0)
    expect(reset.nextReviewAt).toBe(NOW + DAY)
    // ease is already at the floor: after the penalty it must not drop below MIN_EASE.
    expect(reset.easeFactor).toBe(MIN_EASE)
  })

  it('ease update formula: high grades raise, low grades lower, never below the floor', () => {
    // grade 5: +0.1; grade 3: -0.14; grade 0: -0.8.
    expect(nextSchedule(5, state({ easeFactor: 2.5 }), NOW).easeFactor).toBeCloseTo(2.6, 5)
    expect(nextSchedule(3, state({ easeFactor: 2.5 }), NOW).easeFactor).toBeCloseTo(2.36, 5)
    expect(nextSchedule(0, state({ easeFactor: 2.5 }), NOW).easeFactor).toBeCloseTo(1.7, 5)
    // Starting at 1.5 with a 0.8 penalty gives 0.7, lifted back to 1.3 by the floor.
    expect(nextSchedule(0, state({ easeFactor: 1.5 }), NOW).easeFactor).toBe(MIN_EASE)
    expect(nextSchedule(1, state({ easeFactor: 1.4 }), NOW).easeFactor).toBe(MIN_EASE)
  })

  it('due check: unscheduled is never due; scheduled is due once its time arrives', () => {
    expect(isDue(state({ nextReviewAt: null }), NOW)).toBe(false)
    expect(isDue(state({ nextReviewAt: NOW }), NOW)).toBe(true)
    expect(isDue(state({ nextReviewAt: NOW + 1 }), NOW)).toBe(false)
  })
})

describe('Slot assignment (method of loci)', () => {
  it('kind maps to a fixed room, index increments from 1', () => {
    const first = assignSlot('fact', {})
    expect(first).toEqual({ slot: { room: KIND_ROOMS.fact, index: 1 }, openedNewRoom: false })
    const occupancy: Record<string, RoomOccupancy> = { [KIND_ROOMS.fact]: { count: 3, maxIndex: 3 } }
    expect(assignSlot('fact', occupancy).slot).toEqual({ room: KIND_ROOMS.fact, index: 4 })
  })

  it('a full room (9) opens "<name>-2", and the new room starts at 1', () => {
    const full: Record<string, RoomOccupancy> = { [KIND_ROOMS.decision]: { count: ROOM_CAPACITY, maxIndex: ROOM_CAPACITY } }
    const next = assignSlot('decision', full)
    expect(next.slot).toEqual({ room: `${KIND_ROOMS.decision}-2`, index: 1 })
    expect(next.openedNewRoom).toBe(true)
    // Room 2 is also full: keep opening room 3.
    const bothFull: Record<string, RoomOccupancy> = {
      [KIND_ROOMS.decision]: { count: ROOM_CAPACITY, maxIndex: ROOM_CAPACITY },
      [`${KIND_ROOMS.decision}-2`]: { count: ROOM_CAPACITY, maxIndex: ROOM_CAPACITY },
    }
    expect(assignSlot('decision', bothFull).slot).toEqual({ room: `${KIND_ROOMS.decision}-3`, index: 1 })
  })

  it('empty slots are not reclaimed: index is maxIndex+1, not count+1', () => {
    // There were 5 slots, 2 of them freed by forgetting (count=3); the next one should still land on index 6.
    const occupancy: Record<string, RoomOccupancy> = { [KIND_ROOMS.episode]: { count: 3, maxIndex: 5 } }
    expect(assignSlot('episode', occupancy).slot).toEqual({ room: KIND_ROOMS.episode, index: 6 })
  })

  it('different kinds do not interfere; each lands in its own room', () => {
    const occupancy: Record<string, RoomOccupancy> = {
      [KIND_ROOMS.fact]: { count: 9, maxIndex: 9 },
      [KIND_ROOMS.skill]: { count: 2, maxIndex: 2 },
    }
    expect(assignSlot('fact', occupancy).slot).toEqual({ room: `${KIND_ROOMS.fact}-2`, index: 1 })
    expect(assignSlot('skill', occupancy).slot).toEqual({ room: KIND_ROOMS.skill, index: 3 })
  })
})

describe('Placard rule scoring (unique · differentiated · dated)', () => {
  const empty = { existingCaptions: [], roomCaptions: [] }

  // Note: placard fixtures below are intentionally non-English (CJK) test data.
  // The scoring heuristics under test (length bounds 4-30, date-anchor regex,
  // 6-character prefix-clash) are all CJK-character-based, so the content must
  // stay in Chinese to exercise those behaviors.

  it('all three principles met scores full: valid length + store-unique + date anchor + no same-room prefix clash', () => {
    expect(scorePlacard('2026-09 端口改为 4000', empty)).toBe(1)
  })

  it('duplicating an existing store placard loses the uniqueness points', () => {
    const context = { existingCaptions: ['2026-09 端口改为 4000'], roomCaptions: [] }
    expect(scorePlacard('2026-09 端口改为 4000', context)).toBe(0.6)
  })

  it('sharing the first 6 characters with a same-room neighbor loses the differentiation points', () => {
    const context = { existingCaptions: [], roomCaptions: ['部署端口是 4000 的第一版说明'] }
    // valid + unique (0.4) + prefix clash adds nothing + no date anchor = 0.4.
    expect(scorePlacard('部署端口是 5000 的第二版说明', context)).toBe(0.4)
  })

  it('an invalid length earns no "valid" points, but a date anchor still counts', () => {
    expect(scorePlacard('端口', empty)).toBe(0)
    expect(scorePlacard('长'.repeat(31), empty)).toBe(0)
    // Overlong (41 chars) but with a date anchor: only the date points remain.
    expect(scorePlacard(`2026-09-11 ${'长'.repeat(30)}`, empty)).toBe(0.3)
  })

  it('no placard scores 0; a low score gets a re-inscription suggestion', () => {
    expect(scorePlacard(null, empty)).toBe(0)
    expect(scorePlacard(undefined, empty)).toBe(0)
    // Intentionally non-English: matches the Chinese host string src/imagery/score.ts
    // currently emits from placardImprovementHint (the "placard non-compliant" lead).
    expect(placardImprovementHint(0.3)).toContain('Placard needs improvement')
    expect(placardImprovementHint(PLACARD_LOW_THRESHOLD)).toBeNull()
    expect(placardImprovementHint(1)).toBeNull()
  })
})
