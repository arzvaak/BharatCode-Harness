/**
 * Minimal SuperMemo 2 spaced-repetition scheduler.
 * Passing grades (at least 3) advance intervals through 1, 6, then rounded previous interval times ease.
 * Failure resets the interval to one day and consecutive passes to zero; ease is bounded below by 1.3. Pure and side-effect free.
 * @module @kenz1117/dsh-engram/review/sm2
 */

import type { ReviewGrade, ReviewSchedule } from '../types.ts'

/** Standard SM-2 minimum ease prevents excessively frequent reviews. */
export const MIN_EASE = 1.3
/** Standard initial SM-2 ease factor. */
export const INITIAL_EASE = 2.5
/** Interval after the first passing review, in days. */
export const FIRST_INTERVAL_DAYS = 1
/** Interval after the second passing review, in days. */
export const SECOND_INTERVAL_DAYS = 6
const DAY_MS = 86_400_000

/** Initial schedule: due tomorrow, with initial ease and zero interval and repetitions. */
export function initialSchedule(now: number): ReviewSchedule {
  return { nextReviewAt: now + FIRST_INTERVAL_DAYS * DAY_MS, easeFactor: INITIAL_EASE, intervalDays: 0, reps: 0 }
}

/**
 * Advance the schedule according to recall quality.
 * @param grade - Recall quality from 0 to 5: forgotten, incorrect, barely recalled, hesitant, or perfect.
 * @param state - Current scheduling state.
 * @param now - Review timestamp in epoch milliseconds.
 * @returns New scheduling state without mutating the input.
 */
export function nextSchedule(grade: ReviewGrade, state: ReviewSchedule, now: number): ReviewSchedule {
  if (grade < 3) {
    // Failure: retry tomorrow, apply the standard SM-2 ease penalty, and reset repetitions.
    const ease = Math.max(MIN_EASE, state.easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
    return {
      nextReviewAt: now + FIRST_INTERVAL_DAYS * DAY_MS,
      easeFactor: Math.round(ease * 100) / 100,
      intervalDays: FIRST_INTERVAL_DAYS,
      reps: 0,
    }
  }
  const reps = state.reps + 1
  const intervalDays = reps === 1
    ? FIRST_INTERVAL_DAYS
    : reps === 2
      ? SECOND_INTERVAL_DAYS
      : Math.max(1, Math.round(state.intervalDays * state.easeFactor))
  const ease = Math.max(MIN_EASE, state.easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
  return {
    nextReviewAt: now + intervalDays * DAY_MS,
    easeFactor: Math.round(ease * 100) / 100,
    intervalDays,
    reps,
  }
}

/** A scheduled review is due when nextReviewAt is not later than now. */
export function isDue(schedule: ReviewSchedule, now: number): boolean {
  return schedule.nextReviewAt !== null && schedule.nextReviewAt <= now
}
