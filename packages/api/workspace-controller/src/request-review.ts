/** Offline reconstruction uses the same Session fold as the primary agent loop. */
import { Session, foldRequestHeader } from '@deepseek-ai/dsh-session'
import type { SessionId, SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
export function reconstructRequest(
  sessionId: SessionId,
  events: readonly SessionEvent[],
  turn: number,
  step: number,
): Omit<GenerateOptions, 'signal'> {
  const settlement = events.find(
    event =>
      (event.type === 'assistant/message' || event.type === 'assistant/attempt') &&
      event.data.turn === turn &&
      event.data.step === step,
  )
  if (settlement === undefined) throw new Error('Request reconstruction requires a settled logged request')
  const prefix = events.filter(event => event.seq < settlement.seq)
  const header = foldRequestHeader(prefix)
  if (header === undefined) throw new Error('Request header is missing')
  const session = Session.create(sessionId, structuredClone(prefix))
  return {
    ...header.config,
    messages: session.deriveMessages(),
    toolHistory: session.toolHistory(),
    ...(header.tools === undefined ? {} : { tools: header.tools }),
  }
}
export function diffRequests(before: Omit<GenerateOptions, 'signal'>, after: Omit<GenerateOptions, 'signal'>) {
  let sharedMessages = 0
  while (
    sharedMessages < Math.min(before.messages.length, after.messages.length) &&
    JSON.stringify(before.messages[sharedMessages]) === JSON.stringify(after.messages[sharedMessages])
  )
    ++sharedMessages
  const prior = new Map((before.tools ?? []).map(tool => [tool.name, JSON.stringify(tool)]))
  const next = new Map((after.tools ?? []).map(tool => [tool.name, JSON.stringify(tool)]))
  return {
    schemaBytes: {
      before: Buffer.byteLength(JSON.stringify(before.tools ?? [])),
      after: Buffer.byteLength(JSON.stringify(after.tools ?? [])),
    },
    requestBytes: { before: Buffer.byteLength(JSON.stringify(before)), after: Buffer.byteLength(JSON.stringify(after)) },
    sharedMessages,
    removedMessages: before.messages.slice(sharedMessages),
    addedMessages: after.messages.slice(sharedMessages),
    addedTools: [...next.keys()].filter(name => !prior.has(name)),
    removedTools: [...prior.keys()].filter(name => !next.has(name)),
    changedTools: [...next].filter(([name, value]) => prior.has(name) && prior.get(name) !== value).map(([name]) => name),
    configChanged:
      JSON.stringify({ ...before, messages: undefined, tools: undefined }) !==
      JSON.stringify({ ...after, messages: undefined, tools: undefined }),
    notice: 'Context comparison is descriptive. Replay differences show sensitivity, not causal proof.',
  }
}

/** Remove tool definitions without changing the request's declaration-series identity. */
export function replayWithoutTools(
  original: Omit<GenerateOptions, 'signal'>,
  names: readonly string[],
): Omit<GenerateOptions, 'signal'> {
  const removed = new Set(names)
  const { tools, toolHistory, ...rest } = original
  return {
    ...rest,
    ...(tools === undefined ? {} : { tools: tools.filter(tool => !removed.has(tool.name)) }),
    ...(toolHistory === undefined
      ? {}
      : {
        toolHistory: {
          tools: toolHistory.tools.filter(tool => !removed.has(tool.name)),
          updates: toolHistory.updates.map(update => ({
            ...update,
            additions: update.additions.filter(tool => !removed.has(tool.name)),
          })),
        },
      }),
  }
}
