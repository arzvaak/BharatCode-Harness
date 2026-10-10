import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { parseAntigravityQuota } from '../lib/gateway-quota-adapters.js'
import { queryGatewayQuota, GATEWAY_MANAGEMENT_PATHS } from '../lib/gateway-quotas.js'
import { queryCustomBalance } from '../lib/custom-balance.js'
import { sanitizeConfig, applyConfigPatch } from '../lib/store.js'

const group = name => ({ displayName: name, buckets: [{ window: 'weekly', remainingFraction: 0.8 }] })
const payload = { groups: [group('Gemini Models'), group('Claude and GPT models'), group('Unknown models')] }
assert.equal(parseAntigravityQuota(payload).windows.length, 3)
assert.equal(parseAntigravityQuota(payload, { geminiOnly: true }).windows.length, 1)
assert.deepEqual(parseAntigravityQuota({ groups: [group('Claude and GPT models')] }, { geminiOnly: true }).windows, [])
for (const data of [{}, { groups: [] }, { groups: [{ displayName: 'Claude and GPT models', buckets: [{ remainingFraction: 9 }] }] }]) {
  assert.throws(() => parseAntigravityQuota(data, { geminiOnly: true }), { code: 'PROVIDER_PARSE_ERROR' })
}
assert.throws(() => parseAntigravityQuota({ groups: [group('Claude and GPT models'), { displayName: 'Gemini Models', buckets: [] }] }, { geminiOnly: true }), { code: 'PROVIDER_PARSE_ERROR' })
const ctx = { get: key => key === 'credentials' ? { resolve: async () => ({ value: 'TEST_MANAGEMENT', source: 'env' }) } : undefined }
const raw = { id: 'antigravity-test', type: 'cliproxyapi', enabled: true, label: 'AG', display: 'both', refreshMinutes: 15, baseURL: 'http://127.0.0.1:8317', includeProviders: ['antigravity'], allowedHosts: [], allowInsecureHttp: false, antigravityOnlyGemini: true }
const patched = applyConfigPatch(sanitizeConfig({}), { gatewayQuotas: { sources: [raw] } })
assert.deepEqual(patched.errors, [])
const config = patched.config
const source = sanitizeConfig(JSON.parse(JSON.stringify(config))).gatewayQuotas.sources[0]
assert.equal(source.antigravityOnlyGemini, true)
let groups = payload.groups
const fetchImpl = async (url, init) => {
  assert.equal(init.redirect, 'manual')
  if (new URL(url).pathname === GATEWAY_MANAGEMENT_PATHS.authFiles) {
    return new Response(JSON.stringify({ auth_files: [{ auth_index: 'ag-test', provider: 'antigravity', project_id: 'test-project' }] }))
  }
  assert.equal(new URL(url).pathname, GATEWAY_MANAGEMENT_PATHS.apiCall)
  return new Response(JSON.stringify({ status_code: 200, body: JSON.stringify({ groups }) }))
}
let result = await queryGatewayQuota(ctx, source, { fetchImpl })
assert.equal(result.status, 'ok')
assert.equal(result.accounts[0].windows.length, 1)
groups = [group('Claude and GPT models')]
result = await queryGatewayQuota(ctx, source, { fetchImpl })
assert.equal(result.status, 'ok', 'intentional filtering to zero windows is not an upstream failure')
assert.deepEqual(result.accounts[0].windows, [])
result = await queryGatewayQuota(ctx, { ...source, antigravityOnlyGemini: false }, { fetchImpl })
assert.equal(result.accounts[0].windows.length, 1)

// Real local HTTP: credentials stay on the configured host and redirects stop.
let requests = 0
const server = createServer((req, res) => {
  requests++
  if (req.url === '/redirect') { res.writeHead(302, { Location: '/secret-target' }); res.end(); return }
  assert.equal(req.url, '/quota')
  assert.equal(req.headers.authorization, 'Bearer TEST_LOCAL_KEY')
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ credits: { total: 0.125, cap: 2, spent: 1.875 } }))
})
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const host = `127.0.0.1:${server.address().port}`
  const entry = { enabled: true, label: 'Credits', unit: 'CREDITS', allowedHosts: [host], request: { url: `http://${host}/quota`, headers: { Authorization: 'Bearer {{LOCAL_TEST_KEY}}' } }, extract: { remaining: 'credits.total', maxBudget: 'credits.cap', spend: 'credits.spent' } }
  const credentials = { get: () => ({ resolve: async () => ({ value: 'TEST_LOCAL_KEY' }) }) }
  const balance = await queryCustomBalance(credentials, { customBalance: entry })
  assert.equal(balance.remaining, 0.125)
  assert.equal(balance.maxBudget, 2)
  assert.equal(balance.unit, 'CREDITS')
  await assert.rejects(queryCustomBalance(credentials, { customBalance: { ...entry, request: { ...entry.request, url: `http://${host}/redirect` } } }), /redirect/)
  assert.equal(requests, 2, 'redirect target is never contacted')
  for (const host of ['localhost.example.com', '127.0.0.1.example.com', '[::ffff:c000:201]', '192.168.1.2']) {
    await assert.rejects(queryCustomBalance(credentials, { customBalance: { ...entry, request: { ...entry.request, url: `http://${host}/quota` } } }), /must use https/)
  }
  assert.equal(requests, 2)
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)) }
console.log('[ok] PR #145/#147：过滤空组、配置与查询链路、真实本机 HTTP、小数积分与重定向边界通过')
