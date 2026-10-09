/**
 * Auxiliary LLM client wraps ctx.llm.stream and BlockAssembler, resolving routes from session logs.
 * Model-visible input must be logged: callers append complete auxiliary requests to the session.
 * @module @kenz1117/dsh-engram/llm/client
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { EngramError } from '../types.ts'

/** Model route for an auxiliary call. */
export interface LlmRoute {
  readonly provider: string
  readonly model: string
}

/** Minimal narrowed session-event shape consumed by ingestion and distillation. */
export interface SessionEventLike {
  readonly type: string
  readonly data: unknown
  readonly time?: number
  readonly seq?: number
}

/** Resolve the latest request/header route from header.config. */
export function routeFromEvents(events: readonly SessionEventLike[]): LlmRoute | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event?.type !== 'request/header') continue
    const config = (event.data as { header?: { config?: { provider?: unknown; model?: unknown } } } | null)?.header?.config
    if (typeof config?.provider === 'string' && typeof config?.model === 'string' && config.provider !== '' && config.model !== '') {
      return { provider: config.provider, model: config.model }
    }
  }
  return undefined
}

/** Extract a JSON array after removing an optional Markdown fence; invalid input returns undefined. */
export function parseJsonArray(text: string): unknown[] | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Convert terminal reasons to errors, matching session-title-llm semantics. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('dsh-engram: auxiliary output reached the maxTokens limit')
    case 'tool-calls':
      return new Error('dsh-engram: auxiliary call unexpectedly requested tools')
    default:
      return new Error(`dsh-engram: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/**
 * Collect streamed text from an auxiliary LLM call.
 * @param ctx - Context providing the llm service.
 * @param params.route - Model route from logged requests or explicit configuration.
 * @param params.system - System instructions.
 * @param params.userText - User-side JSON-framed input.
 * @param params.sessionId - Owning session identifier, converted to the branded type internally.
 * @param params.maxTokens - Output token limit.
 * @param params.purpose - Purpose marker cast at runtime because third-party registration is unavailable;
 *   token-meter attribution uses sessionId, provider, and model.
 * @param params.signal - Cancellation signal.
 * @returns Complete model text output.
 */
export async function streamText(
  ctx: Context,
  params: {
    route: LlmRoute
    system: string
    userText: string
    sessionId: string
    maxTokens: number
    purpose: string
    signal: AbortSignal
  },
): Promise<string> {
  // Use the same factory as injection: v4 producer-owned source kind, without the retired plugin field.
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: params.userText }],
    source: { kind: 'plugin:dsh-engram' },
  })]
  const options: GenerateOptions = {
    provider: params.route.provider,
    model: params.route.model,
    messages,
    system: params.system,
    maxTokens: params.maxTokens,
    sessionId: params.sessionId as never as NonNullable<GenerateOptions['sessionId']>,
    purpose: params.purpose as NonNullable<GenerateOptions['purpose']>,
    signal: params.signal,
  }
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    assembler.push(chunk)
  }
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  const text = assembler.blocks()
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  if (text.trim() === '') throw new EngramError('LLM_EMPTY_OUTPUT', 'Auxiliary call returned empty output')
  return text
}
