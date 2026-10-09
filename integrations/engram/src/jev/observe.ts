/**
 * Process-local ring buffer records judge.ask sites, verdicts, probabilities, latency, and
 * failures for the recent-verdict panel. Retain at most 50 observations until restart,
 * without disk persistence or additional secret and memory-content retention.
 * @module @kenz1117/dsh-engram/jev/observe
 */

/**
 * Verdict describes the actual effect of an ask call on the write path.
 * merge/accept change disposition; defer retains deferral when thresholds are not crossed.
 * confirm/reject describe contradiction confirmation; fallback uses rules after missing or failed answers.
 */
export type JevVerdict =
  | 'merge'
  | 'accept'
  | 'defer'
  | 'confirm'
  | 'reject'
  | 'fallback'

/** Observation of one judge.ask call. */
export interface JevObservation {
  /** Observation timestamp in epoch milliseconds. */
  readonly at: number
  /** Site: band for ambiguous-write adjudication, contradiction before adding an edge. */
  readonly site: 'band' | 'contradiction'
  /** Question identifier, such as same_memory or contradicts. */
  readonly question: string
  /** Whether Jev supplied a usable answer; otherwise the verdict is fallback. */
  readonly answered: boolean
  /** Noul probability from 0 to 1; present when answered. */
  readonly probability: number | undefined
  /** Request duration in milliseconds. */
  readonly elapsedMs: number
  /** Failure explanation; undefined when answered. */
  readonly error: string | undefined
  /** Resulting verdict. */
  readonly verdict: JevVerdict
}

/** Capacity supports inspection of an ingestion batch while bounding memory usage. */
const CAPACITY = 50

const buffer: JevObservation[] = []

/** Append an observation, dropping the oldest when capacity is exceeded. */
export function recordJevObservation(observation: JevObservation): void {
  buffer.push(observation)
  if (buffer.length > CAPACITY) buffer.shift()
}

/** Return a copy in chronological order, newest last; caller edits cannot affect the buffer. */
export function listJevObservations(): readonly JevObservation[] {
  return [...buffer]
}

/** Clear for test isolation; production has no clearing entry point and follows process lifetime. */
export function clearJevObservations(): void {
  buffer.length = 0
}
