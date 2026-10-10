import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('BharatCode DeepSeek unavailable recovery', () => {
  it.each([
    ['https://bharatcode.ai/api/model/v1', 'deepseek-v4.1-flash', 'Model unavailable', 'SERVER'],
    ['https://bharatcode.ai/api/model/v1/', 'deepseek-v4.1-flash', 'service_unavailable', 'SERVER'],
    ['https://bharatcode.ai/api/model/v1', 'qwen-3.8-27b', 'Model unavailable', 'PI_AI_ERROR'],
    ['https://other.example/v1', 'deepseek-v4.1-flash', 'Model unavailable', 'PI_AI_ERROR'],
    ['https://bharatcode.ai.other.example/api/model/v1', 'deepseek-v4.1-flash', 'Model unavailable', 'PI_AI_ERROR'],
    ['https://bharatcode.ai/api/model/v1', 'deepseek-v4.1-flash', '400 invalid request: model unavailable', 'INVALID_REQUEST'],
    ['https://bharatcode.ai/api/model/v1', 'deepseek-v4.1-flash', '401 model unavailable', 'AUTH'],
  ])('classifies %s %s %s as %s', async (baseURL, model, message, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `data: ${JSON.stringify({ error: { message } })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    )))
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ custom: {
        api: 'openai-completions', baseURL,
        models: [{ id: model, contextWindow: 1_000_000, maxTokens: 32000 }],
      } }),
      resolveApiKey: async () => 'test-key', auth: memoryAuth(),
    })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({ provider: 'custom', model, messages: [] })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code } } })
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })
})
