import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../../../llm/llm-pi-ai/src/config.ts'
import { memoryAuth } from '../../../llm/llm-pi-ai/tests/auth-double.ts'
import { closeMockServers, mockServer } from '../../../llm/llm-pi-ai/tests/mock-server.ts'
import * as Continue from '../../../bundle/max-tokens-continue/src/index.ts'

afterEach(closeMockServers)

function textEvents(text: string, finish: 'length' | 'stop'): string[] {
  return [
    JSON.stringify({ choices: [{ delta: { content: text }, index: 0, finish_reason: null }] }),
    JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: finish }], usage: { prompt_tokens: 30, completion_tokens: 32 } }),
    '[DONE]',
  ]
}

describe('provider output continuation', () => {
  it.each(['text', 'incomplete-tool'] as const)('resends full history after %s cuts and stops only after a complete response', async (kind) => {
    const raw = '{"text":"formula: r_B = product_i'
    const first = kind === 'text' ? textEvents('The formula starts: ', 'length') : [
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_cut', type: 'function', function: { name: 'echo', arguments: raw } }] }, index: 0, finish_reason: null }] }),
      '{"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":30,"completion_tokens":32}}',
      '[DONE]',
    ]
    const server = await mockServer([{ events: first }, { events: textEvents('r_B = sqrt(r*d). ', 'length') }, { events: textEvents('Complete.', 'stop') }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { personaPrefix: 'Teach accurately.' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Continue)
    const profiles = resolveProfiles({ bharatcode: { api: 'openai-completions', baseURL: server.url, models: [{ id: 'deepseek-v4.1-flash', contextWindow: 1000000, maxTokens: 32 }] } })
    ctx.llm.registerAdapter(['bharatcode'], new PiAiAdapter({ profiles: () => profiles, resolveApiKey: () => Promise.resolve('test-key'), auth: memoryAuth() }))
    let executed = 0
    ctx.tools.register(defineContentToolFixture({ name: 'echo', description: 'echo', parameters: { text: { type: 'string' } }, execute: async () => { executed += 1; return [{ type: 'text', text: 'done' }] } }))
    const agent = await ctx.agentLoop.create(SessionId(`provider-continue-${kind}`), { provider: 'bharatcode', model: 'deepseek-v4.1-flash' })
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Teach GMR with complete formulas.' }], source: { kind: 'user' } }))
    await idle
    expect(executed).toBe(0)
    expect(server.requests).toHaveLength(3)
    const second = JSON.stringify(server.requests[1])
    const third = JSON.stringify(server.requests[2])
    expect(second).toContain('Teach GMR with complete formulas.')
    expect(second).toContain(kind === 'text' ? 'The formula starts: ' : JSON.stringify(raw).slice(1, -1))
    expect(third).toContain('r_B = sqrt(r*d). ')
    expect(third).toContain('Teach GMR with complete formulas.')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data.reason)).toEqual([{ kind: 'completed' }])
    const notices = agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'max-tokens-continue')
    expect(notices).toHaveLength(2)
  })
})
