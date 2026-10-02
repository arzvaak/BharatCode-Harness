/** Real agent-loop checks for the fork's mounted continuation plugin. */
import { expect, it } from 'vitest'
import type { TestContext } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as continuation from '../../packages/bundle/max-tokens-continue/src/index.ts'
import { MockAdapter, maxTokensResponse, textResponse } from '../../packages/core/agent-loop/tests/mock-adapter.ts'

async function harness(test: TestContext, adapter: MockAdapter, config: Partial<continuation.Config> = {}) {
  const ctx = new Context()
  test.onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(continuation, {
    enabled: config.enabled ?? true,
    maxContinuations: config.maxContinuations ?? 9,
    requireProgress: config.requireProgress ?? true,
    prompt: config.prompt ?? 'Continue exactly where you stopped.',
  })
  const agent = await ctx.agentLoop.create(SessionId('compatibility-continuation'), { provider: 'mock', model: 'mock' })
  return { ctx, agent }
}
function send(ctx: Context, agent: Agent): Promise<void> {
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue this work' }], source: { kind: 'user' } }))
  return idle
}
function steers(agent: Agent) {
  return agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'max-tokens-continue')
}
it('recovers a truncated turn through the mounted plugin and preserves original text', async (test) => {
  const adapter = new MockAdapter([maxTokensResponse('partial'), textResponse('finished')])
  const { ctx, agent } = await harness(test, adapter)
  await send(ctx, agent)
  expect(adapter.requests).toHaveLength(2)
  expect(steers(agent)).toHaveLength(1)
  expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'completed' } } })
  expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('partial')
})
it('bounds continuations per turn and resets the budget for the next turn', async (test) => {
  const adapter = new MockAdapter(Array.from({ length: 6 }, () => maxTokensResponse('progress')))
  const { ctx, agent } = await harness(test, adapter, { maxContinuations: 2 })
  await send(ctx, agent)
  expect(adapter.requests).toHaveLength(3)
  expect(steers(agent)).toHaveLength(2)
  expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'max-tokens' } } })
  await send(ctx, agent)
  expect(adapter.requests).toHaveLength(6)
  expect(steers(agent)).toHaveLength(4)
})
it('does not continue a truncated step without progress', async (test) => {
  const adapter = new MockAdapter([maxTokensResponse('')])
  const { ctx, agent } = await harness(test, adapter)
  await send(ctx, agent)
  expect(adapter.requests).toHaveLength(1)
  expect(steers(agent)).toHaveLength(0)
})
it('does not continue normal completion or disabled policy', async (test) => {
  const adapter = new MockAdapter([textResponse('done'), maxTokensResponse('partial')])
  const { ctx, agent } = await harness(test, adapter, { enabled: false })
  await send(ctx, agent)
  await send(ctx, agent)
  expect(adapter.requests).toHaveLength(2)
  expect(steers(agent)).toHaveLength(0)
})
it('respects cancellation before a truncated stream can trigger continuation', async (test) => {
  const adapter = new MockAdapter([maxTokensResponse('partial')])
  const { ctx, agent } = await harness(test, adapter)
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (frame.type === 'chunk' && frame.chunk.type === 'finish') agent.cancel({ kind: 'user' })
  })
  await send(ctx, agent)
  expect(adapter.requests).toHaveLength(1)
  expect(steers(agent)).toHaveLength(0)
  expect(agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')).toMatchObject({ data: { reason: { kind: 'aborted' } } })
})
