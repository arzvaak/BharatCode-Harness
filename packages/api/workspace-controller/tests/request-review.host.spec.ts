import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, createAssistantMessage, createDeveloperMessage } from '@deepseek-ai/dsh-llm'
import { reconstructRequest, diffRequests, replayWithoutTools } from '../src/request-review.ts'
const kept = { name: 'keep', description: '', parameters: {} }
const removed = { name: 'remove', description: '', parameters: {}, deferLoading: true as const }
it('reconstructs the dispatch prefix, including historical declarations but excluding the response', () => {
  const session = Session.create(SessionId('request-review'))
  session.append('turn/start', { turn: 1 })
  session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text: 'Inspect this source' }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'test', model: 'test' }, tools: [kept, removed] },
    reason: 'initial',
  })
  const expected = { messages: session.deriveMessages(), toolHistory: session.toolHistory() }
  session.append(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'test', model: 'test' },
        content: [{ type: 'text', text: 'A response' }],
      }),
      stream: [],
    },
    { surfaceOp: 'append' },
  )
  const request = reconstructRequest(session.id, session.snapshotEvents(), 1, 1)
  expect(request).toMatchObject(expected)
  expect(JSON.stringify(request.messages)).not.toContain('A response')
  const replay = replayWithoutTools(request, ['remove'])
  expect(replay.tools).toEqual([kept])
  expect(replay.toolHistory?.tools).toEqual([kept])
  expect(diffRequests(request, replay).removedTools).toEqual(['remove'])
  expect(diffRequests(request, replay).schemaBytes.after).toBeLessThan(diffRequests(request, replay).schemaBytes.before)
})
it('keeps historical update IDs and context while filtering removed additions', () => {
  const context = createDeveloperMessage({
    source: { kind: 'tool-registry' },
    content: [{ type: 'tool-addition', toolName: 'remove' }],
  })
  const original = {
    provider: 'test',
    model: 'test',
    messages: [context],
    tools: [kept, removed],
    toolHistory: { tools: [kept], updates: [{ messageId: context.id, additions: [removed] }] },
  }
  const replay = replayWithoutTools(original, ['remove'])
  expect(replay.messages).toEqual(original.messages)
  expect(replay.toolHistory?.updates).toEqual([{ messageId: context.id, additions: [] }])
  expect(original.toolHistory.updates[0]?.additions).toEqual([removed])
})
