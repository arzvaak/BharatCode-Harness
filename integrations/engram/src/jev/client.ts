/**
 * Jev System One HTTP client asks multiple Noul yes/no judgments about a state in parallel.
 * Returns question identifiers mapped to probabilities using state/questions JSON at /v1/systemone.
 * This is not OpenAI-chat compatible, so it uses a dedicated client rather than ctx.llm.
 * Network, HTTP, and malformed-response failures propagate for per-decision rule fallback.
 * @module @kenz1117/dsh-engram/jev/client
 */

import type { ResolvedJevConfig } from '../config.ts'
import type { JudgeQuestion, JudgeAnswers, MemoryJudge } from '../write-disposition.ts'

/** Individual Jev answer; only the Noul probability field is consumed. */
interface JevAnswerBody {
  noul?: unknown
}

/**
 * Ask Noul questions through the Jev /v1/systemone endpoint.
 * @param config - Resolved Jev configuration; the caller checks enabled first.
 * @param state - State to judge, such as a comparison of two memory contents.
 * @param questions - Questions; an empty list returns immediately without a request.
 * @param signal - External cancellation combined with the configured timeout.
 * @returns Question identifiers mapped to probabilities from 0 to 1.
 * @throws On network or HTTP failure, missing answers, or invalid probabilities.
 */
export async function askNoul(
  config: ResolvedJevConfig,
  state: string,
  questions: readonly JudgeQuestion[],
  signal: AbortSignal = new AbortController().signal,
): Promise<JudgeAnswers> {
  if (questions.length === 0) return {}
  const response = await fetch(new URL('/v1/systemone', config.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      state,
      questions: Object.fromEntries(questions.map(question => [question.id, {
        type: 'noul',
        instructions: question.instructions,
      }])),
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
  })
  if (!response.ok) {
    throw new Error(`jev: HTTP ${response.status} from ${config.baseUrl}`)
  }
  const payload = (await response.json()) as { answers?: Record<string, JevAnswerBody> | null }
  if (payload.answers === undefined || payload.answers === null) {
    throw new Error('jev: response missing answers')
  }
  const result: Record<string, number> = {}
  for (const question of questions) {
    const noul = payload.answers[question.id]?.noul
    if (typeof noul !== 'number' || !Number.isFinite(noul) || noul < 0 || noul > 1) {
      throw new Error(`jev: answer "${question.id}" is not a noul probability`)
    }
    result[question.id] = noul
  }
  return result
}

/**
 * Build a judge that can be injected into ingestion and tool paths.
 * @param config - Resolved Jev configuration including the three thresholds.
 * @returns MemoryJudge; ask uses the configured timeout without external cancellation.
 */
export function createMemoryJudge(config: ResolvedJevConfig): MemoryJudge {
  return {
    deferMergeAbove: config.deferMergeAbove,
    deferAcceptBelow: config.deferAcceptBelow,
    contradictMinProbability: config.contradictMinProbability,
    ask: (state, questions) => askNoul(config, state, questions),
  }
}

/** Connection succeeds only when the endpoint returns a valid Noul probability; error explains failure. */
export interface JevConnectionTestResult {
  readonly ok: boolean
  readonly elapsedMs: number
  readonly probability: number | undefined
  readonly error: string | undefined
}

/**
 * Send a minimal ping question to validate the baseUrl, model, and apiKey combination.
 * Return failures in the error field rather than throwing, for direct panel display.
 * @param config - Effective configuration to test; enabled is ignored and connection values come from the caller.
 */
export async function testJevConnection(config: ResolvedJevConfig): Promise<JevConnectionTestResult> {
  const startedAt = Date.now()
  try {
    const answers = await askNoul(config, 'Connectivity test: this state exists.', [{
      id: 'ping',
      instructions: 'This is a connectivity test. Return any probability between 0 and 1.',
    }])
    return { ok: true, elapsedMs: Date.now() - startedAt, probability: answers['ping'], error: undefined }
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      probability: undefined,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
