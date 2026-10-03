/** Explicit release smoke: missing credentials fail; deterministic replay is reported separately. */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Validate credentialed-smoke inputs before any network request. */
export function providerInputs(env) {
  if (!env.BHARATCODE_API_KEY?.trim()) throw new Error('Live-provider verification blocked: BHARATCODE_API_KEY is required; no test was run or skipped as successful')
  const base = new URL(env.BHARATCODE_BASE_URL || 'https://bharatcode.ai/api/model/v1/')
  if (base.protocol !== 'https:') throw new Error('Live-provider endpoint must use HTTPS')
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return { url: new URL('chat/completions', base), key: env.BHARATCODE_API_KEY, model: env.BHARATCODE_MODEL || 'deepseek-v4.1-flash' }
}

/** Require one real model response with an exact marker; never print response bodies or credentials. */
export async function verifyLiveProvider(env = process.env) {
  const input = providerInputs(env)
  const response = await fetch(input.url, { method: 'POST', signal: AbortSignal.timeout(180_000), redirect: 'error',
    headers: { authorization: `Bearer ${input.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: input.model, messages: [{ role: 'user', content: 'Reply with exactly BHC_COMPAT_READY.' }],
      max_tokens: 2048, reasoning_effort: 'low', stream: false }),
  })
  if (!response.ok) throw new Error(`Live-provider inference failed: HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.choices?.[0]?.message?.content?.trim() !== 'BHC_COMPAT_READY') throw new Error('Live-provider inference did not return the required marker')
  console.log('Live-provider smoke: credentialed inference returned the required marker.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await verifyLiveProvider()
