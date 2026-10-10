import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { parseQwenSummary, queryQwenCli, resolveQwenCli, QWEN_CLI_ARGS } from '../lib/qwen-cli.js'
import { applyConfigPatch, sanitizeConfig } from '../lib/store.js'
import { TYPERT } from '../lib/typert.host.js'
import { apply } from '../lib/index.js'

const plan = { subscribed: true, status: 'valid', totalCredits: 25000, remainingCredits: 18000, usedPct: 28, resetDate: '2026-10-01T00:00:00Z', addonRemaining: 1.25 }
const summary = { token_plan: plan, free_tier: [{ secret: 'PRIVATE_FREE_TIER' }], pay_as_you_go: { secret: 'PRIVATE_PAYG' } }
const windows = parseQwenSummary(summary, 'en').windows
assert.equal(windows.quota.percent, 28)
assert.equal(windows.quota.resetsAt, '')
assert.equal(windows.credits.text, '7,000 / 25,000 Credits (CLI)')
assert.match(windows.addon.text, /1.25 Credits/)
assert.match(windows.expiry.text, /subscription expiry/)
assert.equal(windows.expiry.resetsAt, '', 'subscription EndTime must not become a monthly reset')
assert.ok(!JSON.stringify(windows).includes('PRIVATE'))
for (const remaining of [25000, 0, 24999.5]) {
  const actual = parseQwenSummary({ token_plan: { ...plan, remainingCredits: remaining, usedPct: 99 } })
  assert.equal(actual.windows.quota.percent, Math.round((25000 - remaining) / 25000 * 1000) / 10)
}
assert.equal(parseQwenSummary({ token_plan: { ...plan, totalCredits: 100, remainingCredits: 99.5 } }).windows.quota.percent, 0.5)
assert.equal(parseQwenSummary({ token_plan: { ...plan, subscribed: false, status: 'exhaust', remainingCredits: 0 } }).windows.quota.percent, 100, 'explicit exhausted subscription remains visible')
for (const patch of [{ totalCredits: 0 }, { remainingCredits: -1 }, { remainingCredits: 25001 }, { totalCredits: Infinity }, { remainingCredits: '0' }, { remainingCredits: null }, { remainingCredits: true }, { addonRemaining: -1 }, { resetDate: 'invalid' }]) {
  assert.throws(() => parseQwenSummary({ token_plan: { ...plan, ...patch } }), { code: 'invalid' })
}
for (const value of [null, [], {}, { token_plan: [] }, { token_plan: { subscribed: 'true' } }]) assert.throws(() => parseQwenSummary(value), { code: 'invalid' })
for (const value of [{ subscribed: false }, { ...plan, status: 'invalid' }]) {
  assert.throws(() => parseQwenSummary({ token_plan: value }, 'en'), e => e.soft && e.message.includes('upstream failure'))
}
for (const value of [undefined, null, 'auto', 'CLI', true]) {
  assert.equal(sanitizeConfig({ codingPlans: { qwen: { quotaSource: value } } }).codingPlans.qwen.quotaSource, 'local')
}
assert.equal(applyConfigPatch(sanitizeConfig({}), { codingPlans: { qwen: { quotaSource: 'cli' } } }).config.codingPlans.qwen.quotaSource, 'cli')

// Execute a real child process with the npm Windows layout or a Unix executable.
// The fixture deliberately lives in a path containing shell metacharacters.
const root = mkdtempSync(join(tmpdir(), 'cm-qwen-'))
const bin = join(root, 'CLI 空格 & percent%')
const pkg = join(bin, 'node_modules', '@qianwenai', 'qianwen-cli')
const entry = join(pkg, 'dist', 'bin', 'qianwen.js')
const fixture = join(root, 'response.json'), calls = join(root, 'calls.jsonl')
const env = { ...process.env, PATH: bin }
for (const key of Object.keys(env)) if (key !== 'PATH' && key.toLowerCase() === 'path') delete env[key]
const options = { env }
const setResponse = value => writeFileSync(fixture, JSON.stringify({ payload: summary, ...value }))
const count = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0
const until = async predicate => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await delay(10) }
  throw new Error('fixture condition timed out')
}
const savedEnv = { PATH: process.env.PATH, DSH_HOME: process.env.DSH_HOME }
const cleanups = []
try {
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@qianwenai/qianwen-cli', type: 'module', bin: { qianwen: 'dist/bin/qianwen.js' } }))
  writeFileSync(join(bin, 'qianwen.cmd'), '@echo SHOULD_NOT_EXECUTE_THIS_SHIM\r\nexit /b 99\r\n')
  const program = `import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (config.wait) await new Promise(r => setTimeout(r, config.wait));
if (config.stderr) process.stderr.write(config.stderr);
if (config.exit) process.exit(config.exit);
process.stdout.write(config.raw ?? JSON.stringify(config.payload));
`
  writeFileSync(entry, program)
  const unixBin = join(bin, 'qianwen')
  // Unix extensionless launcher imports the ESM fixture so timeout tests work too.
  const { pathToFileURL } = await import('node:url')
  writeFileSync(unixBin, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(entry).href)});\n`)
  chmodSync(unixBin, 0o755)
  const command = await resolveQwenCli({ env, platform: 'win32' })
  assert.equal(command.file, process.execPath)
  assert.deepEqual(command.args, [entry])
  assert.equal(await resolveQwenCli({ env: { PATH: '.;' }, platform: 'win32' }), null)
  setResponse({})
  assert.equal((await queryQwenCli('en', options)).windows.quota.percent, 28)
  assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8').trim()), QWEN_CLI_ARGS)
  for (const [response, expected] of [
    [{ exit: 2, stderr: 'SECRET_AUTH_OUTPUT' }, 'auth'],
    [{ exit: 3, stderr: 'SECRET_NETWORK_OUTPUT' }, 'failed'],
    [{ raw: 'SECRET_INVALID_JSON' }, 'invalid'],
    [{ raw: 'x'.repeat(10000) }, 'invalid'],
  ]) {
    setResponse(response)
    await assert.rejects(queryQwenCli('en', { ...options, maxBuffer: 2048 }), e => e.code === expected && !JSON.stringify(e).includes('SECRET') && !e.message.includes('SECRET'))
  }
  setResponse({ wait: 1000 })
  await assert.rejects(queryQwenCli('en', { ...options, timeoutMs: 100 }), { code: 'timeout' })
  const controller = new AbortController()
  const cancellation = queryQwenCli('en', { ...options, signal: controller.signal })
  controller.abort()
  await assert.rejects(cancellation)

  process.env.PATH = bin
  process.env.DSH_HOME = join(root, 'dsh')
  const services = {}
  apply({ on: () => () => {}, inject() {}, get: () => undefined, logger: { info() {}, warn() {}, error() {} },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    provide: (name, service) => { services[name] = service },
  })
  const api = services.costMeter
  const codec = state => {
    const result = TYPERT.invocations.find(x => x.method === 'getState').result.schema.safeParse(JSON.parse(JSON.stringify(state)))
    assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.error.issues))
  }
  const start = count()
  let state = await api.updateConfig({ locale: 'en', codingPlans: { qwen: { enabled: true, display: 'both' } } })
  assert.equal(state.codingPlans.qwen.quotaSource, 'local')
  assert.match(state.codingPlans.qwen.windows.credits.text, /est/)
  assert.equal(count(), start, 'local mode never runs the CLI')
  setResponse({})
  await api.updateConfig({ codingPlans: { qwen: { quotaSource: 'cli' } } })
  let result = await api.refreshCodingPlan('qwen')
  assert.equal(result.ok, true)
  state = result.state
  codec(state)
  assert.equal(state.codingPlans.qwen.windows.quota.percent, 28)
  assert.equal(state.codingPlans.qwen.quotaSource, 'cli')
  assert.ok(!JSON.stringify(state).includes('PRIVATE'))
  const afterRefresh = count()
  await api.getState(); await api.getState()
  assert.equal(count(), afterRefresh, 'polls reuse the CLI result')
  assert.equal(state.planStats.providers.qwen, undefined, 'no estimates from an unknown CLI billing period')
  const readLedger = () => JSON.parse(readFileSync(join(process.env.DSH_HOME, 'storages', 'cost-meter', 'ledger.json'), 'utf8'))
  await until(() => existsSync(join(process.env.DSH_HOME, 'storages', 'cost-meter', 'ledger.json')) && readLedger().config.codingPlans.qwen.quotaSource === 'cli')
  const disk = readLedger()
  assert.equal(disk.config.codingPlans.qwen.quotaSource, 'cli')
  assert.deepEqual(disk.days, {}, 'CLI account totals never become ledger usage')
  assert.ok(!JSON.stringify(disk).includes('PRIVATE'))

  setResponse({ wait: 200 })
  const concurrentStart = count()
  await Promise.all([api.refreshCodingPlan('qwen'), api.refreshCodingPlan('qwen'), api.refreshCodingPlan('qwen')])
  assert.equal(count(), concurrentStart + 1, 'concurrent refreshes share one child')
  setResponse({ exit: 2, stderr: 'SECRET_CHILD_ERROR' })
  result = await api.refreshCodingPlan('qwen')
  assert.equal(result.ok, false)
  assert.deepEqual(result.state.codingPlans.qwen.windows, {})
  assert.match(result.message, /qianwen auth login/)
  const errorCount = count()
  await api.getState(); await api.getState()
  assert.equal(count(), errorCount, 'errors are cached instead of spawning every poll')

  setResponse({ wait: 1500, payload: { token_plan: { ...plan, remainingCredits: 0 } } })
  const beforeRace = count()
  const inFlight = api.refreshCodingPlan('qwen')
  await until(() => count() > beforeRace)
  state = await api.updateConfig({ codingPlans: { qwen: { quotaSource: 'local' } } })
  await inFlight
  state = await api.getState()
  assert.match(state.codingPlans.qwen.windows.credits.text, /est/)
  assert.equal(state.codingPlans.qwen.windows.quota, undefined, 'late CLI result cannot overwrite local mode')
  setResponse({})
  await api.updateConfig({ codingPlans: { qwen: { quotaSource: 'cli', enabled: false } } })
  const disabledCount = count()
  await api.getState(); await api.refreshCodingPlan('qwen')
  assert.equal(count(), disabledCount)
  await api.updateConfig({ codingPlans: { qwen: { enabled: true, display: 'off' } } })
  await api.getState()
  assert.equal(count(), disabledCount, 'hidden source never executes the CLI')
} finally {
  for (const cleanup of cleanups.reverse()) cleanup()
  for (const [name, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  rmSync(root, { recursive: true, force: true })
}
console.log('[ok] 千问 CLI：输出解析、真实子进程、脱敏、超时、缓存、并发、切源、账本与 codec 回归通过')
