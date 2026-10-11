import { afterEach, describe, expect, it } from 'vitest'
import type { AssistantMessageEvent, Model } from '@earendil-works/pi-ai'
import { stream as streamCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { stream as streamResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { toStreamChunks } from '../src/stream.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

afterEach(closeMockServers)

/** A write call whose arguments arrive in many small deltas. */
const args = { file_path: 'notes.md', content: 'x'.repeat(2048) }
const argsJson = JSON.stringify(args)
const fragments = argsJson.match(/.{1,7}/gs) ?? []

function model<A extends 'openai-completions' | 'openai-responses'>(api: A, baseUrl: string): Model<A> {
  return {
    id: 'm', name: 'm', api, provider: 'test', baseUrl, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024,
  }
}

/** The arguments each `toolcall_delta` partial carries, and the finalized arguments. */
async function collect(events: AsyncIterable<AssistantMessageEvent>): Promise<{ partials: unknown[]; final: unknown }> {
  const partials: unknown[] = []
  let final: unknown
  for await (const event of events) {
    if (event.type === 'toolcall_delta' && event.delta.length > 0) {
      const block = event.partial.content[event.contentIndex]
      partials.push(block?.type === 'toolCall' ? block.arguments : undefined)
    } else if (event.type === 'toolcall_end') {
      final = event.toolCall.arguments
    } else if (event.type === 'error') {
      throw new Error(event.error.errorMessage)
    }
  }
  return { partials, final }
}

const context = normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 0 }] })

describe('streamed tool-call arguments (patched pi-ai)', () => {
  it('still repairs complete malformed JSON without losing the supplied text', async () => {
    const raw = '{"depth":"book","text":"complete formula: r_B = sqrt(r*d)",}'
    const server = await mockServer([{ events: [
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_repair', type: 'function', function: { name: 'deepread', arguments: raw } }] }, index: 0, finish_reason: null }] }),
      '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}',
      '[DONE]',
    ] }])
    const assembler = new BlockAssembler()
    const events = streamCompletions(model('openai-completions', server.url), context, { apiKey: 'test-key' })
    for await (const chunk of toStreamChunks(events)) assembler.push(chunk)
    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(assembler.blocks()).toEqual([{ type: 'tool-call', id: 'call_repair', name: 'deepread', arguments: JSON.stringify({ depth: 'book', text: 'complete formula: r_B = sqrt(r*d)' }) }])
  })

  it.each(['tool_calls', 'length'])('retains unfinished arguments when the provider finishes with %s', async (finishReason) => {
    const raw = '{"depth":"book","text":"GMR derivation ends at \\n formula: r_B = product_i'
    const server = await mockServer([{ events: [
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_cut', type: 'function', function: { name: 'deepread', arguments: raw } }] }, index: 0, finish_reason: null }] }),
      JSON.stringify({
        choices: [{ delta: {}, index: 0, finish_reason: finishReason }],
        usage: { prompt_tokens: 30, completion_tokens: 32 },
      }),
      '[DONE]',
    ] }])
    const events = streamCompletions(model('openai-completions', server.url), context, { apiKey: 'test-key' })
    const assembler = new BlockAssembler()
    for await (const chunk of toStreamChunks(events)) assembler.push(chunk)
    expect(assembler.finish).toEqual({ kind: 'max-tokens' })
    const blocks = assembler.blocks()
    expect(blocks.some(block => block.type === 'tool-call')).toBe(false)
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining(raw) as string }])
    expect(assembler.replayState).toBeUndefined()
  })

  it('retains even complete arguments when the output cap prevents tool dispatch', async () => {
    const raw = JSON.stringify({ text: 'Full context to reissue when the cap is reached.' })
    const server = await mockServer([{ events: [
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_cap', type: 'function', function: { name: 'echo', arguments: raw } }] }, index: 0, finish_reason: null }] }),
      '{"choices":[{"delta":{},"index":0,"finish_reason":"length"}]}',
      '[DONE]',
    ] }])
    const assembler = new BlockAssembler()
    const events = streamCompletions(model('openai-completions', server.url), context, { apiKey: 'test-key' })
    for await (const chunk of toStreamChunks(events)) assembler.push(chunk)
    expect(assembler.finish).toEqual({ kind: 'max-tokens' })
    expect(assembler.blocks()).toEqual([{ type: 'text', text: expect.stringContaining(raw) as string }])
  })

  it('openai-completions parses arguments once, at the end of the call', async () => {
    const server = await mockServer([{ events: [
      JSON.stringify({ choices: [{
        delta: {
          role: 'assistant',
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write', arguments: '' } }],
        },
        index: 0, finish_reason: null,
      }] }),
      ...fragments.map(fragment => JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fragment } }] }, index: 0, finish_reason: null }],
      })),
      '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
      '[DONE]',
    ] }])
    const events = streamCompletions(model('openai-completions', server.url), context, { apiKey: 'test-key' })
    const { partials, final } = await collect(events)
    expect(partials).toHaveLength(fragments.length)
    expect(partials.every(partial => JSON.stringify(partial) === '{}')).toBe(true)
    expect(final).toEqual(args)
  })

  it('openai-responses parses arguments once, at the end of the call', async () => {
    const item = { type: 'function_call', call_id: 'call_1', id: 'fc_1', name: 'write' }
    const server = await mockServer([{ events: [
      '{"type":"response.created","response":{"id":"resp_1"}}',
      JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } }),
      ...fragments.map(fragment => JSON.stringify({ type: 'response.function_call_arguments.delta', output_index: 0, delta: fragment })),
      JSON.stringify({ type: 'response.function_call_arguments.done', output_index: 0, arguments: argsJson }),
      JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: { ...item, arguments: argsJson } }),
      JSON.stringify({ type: 'response.completed', response: {
        id: 'resp_1', status: 'completed', output: [], usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
      } }),
    ] }])
    const events = streamResponses(model('openai-responses', server.url), context, { apiKey: 'test-key' })
    const { partials, final } = await collect(events)
    expect(partials).toHaveLength(fragments.length)
    expect(partials.every(partial => JSON.stringify(partial) === '{}')).toBe(true)
    expect(final).toEqual(args)
  })
})
