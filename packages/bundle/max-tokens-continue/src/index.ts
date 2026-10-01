/**
 * Max-Tokens Auto-Continue.
 *
 * When a model step is cut off by the provider's output-token cap, the harness
 * ends the turn with a `max-tokens` reason and shows a truncation notice. This
 * plugin watches the agent's stream frames for that finish and, at the turn's
 * stopping boundary, steers a short continuation prompt back into the same
 * turn — the harness's own forced-continuation pattern, the one exercised by
 * `loop.spec.ts` — so the model resumes from the partial text and reasoning
 * that the session log already preserves verbatim.
 *
 * Append-only by design: history is never rewritten, so the provider's prefix
 * cache stays warm across continuations and the durable session log remains
 * the single source of truth. Truncated tool calls are dropped by the shared
 * assembler before they reach history, so the continuation prompt tells the
 * model to re-issue them whole.
 *
 * @module @local/max-tokens-continue
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FinishReason } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Continuation steer for a turn cut off by the provider output-token cap,
     * steered back into the same turn by the `max-tokens-continue` bundle.
     * Readers preserve the message without the producer; only presentation
     * reads the kind to badge the row as a notice.
     * @persistenceAttribution
     */
    'max-tokens-continue': { readonly kind: 'max-tokens-continue'; readonly form: 'notice' }
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'max-tokens-continue'

/** Default continuation prompt; overridable per profile through Config.prompt. */
const DEFAULT_PROMPT =
  'Your previous response was cut off by the output-token limit. Continue exactly where you stopped. '
  + 'Do not restart, restate, or summarize anything you already produced, and do not comment on this '
  + 'interruption. If you were issuing a tool call when cut off, re-issue the complete tool call now. '
  + 'If your previous response was already complete, reply with one short sentence confirming that.'

/** Auto-continuation policy mounted by the bundle's patch row. */
export interface Config {
  /** Master switch; false registers no listeners at all. */
  enabled: boolean
  /** Hard bound on continuation steers per turn (guard against provider loops). */
  maxContinuations: number
  /** Skip steering when the cut-off step streamed no content at all. */
  requireProgress: boolean
  /** The continuation message steered into the turn. */
  prompt: string
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  maxContinuations: z.number().min(1).max(64).default(9),
  requireProgress: z.boolean().default(true),
  prompt: z.string().min(1).default(DEFAULT_PROMPT),
})

/**
 * Register stream tracking and the turn-stopping continuation hook.
 * @param ctx - plugin context owning both listeners.
 * @param config - validated Config; the loader applies schema defaults before
 *   activation, and `Config({})` covers direct invocation without a patch row.
 * @returns a cleanup disposing both listeners.
 */
export function apply(ctx: Context, config?: Config): () => void {
  // The loader validates through the schema (applying defaults) before every
  // activation; the undefined fallback covers direct invocation without a row.
  const cfg = config ?? Config(undefined)
  if (!cfg.enabled) return () => {}

  /**
   * Per-agent stream state; WeakMap so disposed agents collect naturally.
   * finish: last observed finish kind of the current attempt (undefined until one arrives).
   * chars: content characters streamed in the current attempt (no-progress guard).
   * countTurn/count: continuation budget for one turn, keyed by turn number.
   */
  const state = new WeakMap<Agent, StreamState>()

  function stateOf(agent: Agent): StreamState {
    let entry = state.get(agent)
    if (entry === undefined) {
      entry = { finish: undefined, chars: 0, countTurn: 0, count: 0 }
      state.set(agent, entry)
    }
    return entry
  }

  const disposeStream = ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const entry = stateOf(agent)
    if (frame.type === 'start') {
      // A fresh attempt invalidates the previous finish and restarts progress
      // accounting (a request retry creates a new attempt with its own start).
      entry.finish = undefined
      entry.chars = 0
      return
    }
    if (frame.type !== 'chunk') return
    const chunk = frame.chunk
    switch (chunk.type) {
      case 'finish':
        entry.finish = chunk.reason.kind
        return
      case 'text-delta':
      case 'reasoning-delta':
        entry.chars += chunk.text.length
        return
      case 'tool-call-delta':
        entry.chars += chunk.argumentsDelta.length
        return
      default:
        return
    }
  })

  const disposeStopping = ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    if (signal.aborted) return
    const entry = state.get(agent)
    // Only a step that actually observed a max-tokens finish may continue, and
    // only once per finish: steering clears the marker until the next attempt.
    if (entry === undefined || entry.finish !== 'max-tokens') return
    if (cfg.requireProgress && entry.chars === 0) return
    if (entry.countTurn !== turn) {
      entry.countTurn = turn
      entry.count = 0
    }
    if (entry.count >= cfg.maxContinuations) return
    entry.count += 1
    entry.finish = undefined
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: cfg.prompt }],
      source: { kind: 'max-tokens-continue', form: 'notice' },
    }))
  })

  return () => {
    disposeStream()
    disposeStopping()
  }
}

/** Per-agent stream state for one live attempt. */
interface StreamState {
  /** Last observed finish kind of the current attempt; undefined until one arrives. */
  finish: FinishReason['kind'] | undefined
  /** Content characters streamed in the current attempt (no-progress guard). */
  chars: number
  /** Turn number the continuation budget belongs to. */
  countTurn: number
  /** Continuations already steered for `countTurn`. */
  count: number
}
