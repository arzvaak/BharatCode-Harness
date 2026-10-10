/** Official Qianwen CLI bridge (#146). Credentials remain owned by the CLI. */
import { bridgeCode, resolveNpmCli, runCliJson } from './cli-bridge.js'

export const QWEN_CLI_ARGS = Object.freeze(['usage', 'summary', '--format', 'json'])
const MESSAGES = {
  zh: {
    missing: 'Qianwen CLI not found. Install @qianwenai/qianwen-cli on the DSH host, run qianwen auth login, then restart DSH to refresh PATH.',
    auth: 'Qianwen CLI login is missing or expired. Run qianwen auth login as the same OS user running DSH.',
    failed: 'Qianwen CLI query failed. Check qianwen usage summary --format json and retry.',
    timeout: 'Qianwen CLI query timed out. Check the network and refresh.',
    invalid: 'Qianwen CLI returned invalid subscription quota data. Update the CLI and retry.',
    unavailable: 'Qianwen CLI returned no valid subscription quota (unsubscribed, inactive, or an upstream failure). Check the CLI or select local estimates.',
    expiry: 'CLI subscription expiry', addon: 'Add-on remaining',
  },
  en: {
    missing: 'Qianwen CLI not found. Install @qianwenai/qianwen-cli on the DSH host, run qianwen auth login, then restart DSH to refresh PATH.',
    auth: 'Qianwen CLI login is missing or expired. Run qianwen auth login as the same OS user running DSH.',
    failed: 'Qianwen CLI query failed. Check qianwen usage summary --format json and retry.',
    timeout: 'Qianwen CLI query timed out. Check the network and refresh.',
    invalid: 'Qianwen CLI returned invalid subscription quota data. Update the CLI and retry.',
    unavailable: 'Qianwen CLI returned no valid subscription quota (unsubscribed, inactive, or an upstream failure). Check the CLI or select local estimates.',
    expiry: 'CLI subscription expiry', addon: 'Add-on remaining',
  },
}
const message = (locale, code) => MESSAGES[locale === 'en' ? 'en' : 'zh'][code]
const fail = (locale, code) => Object.assign(new Error(message(locale, code)), { code, soft: code === 'unavailable' || code === 'missing' || code === 'auth' })
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function parseQwenSummary(payload, locale = 'zh') {
  const plan = record(payload) ? payload.token_plan : null
  if (!record(plan) || typeof plan.subscribed !== 'boolean') throw fail(locale, 'invalid')
  // The official CLI absorbs some upstream failures into subscribed=false.
  // Exhausted subscriptions also have subscribed=false in CLI 1.6.x, but their
  // explicit status and valid credit totals still provide a usable 100% reading.
  if ((!plan.subscribed && plan.status !== 'exhaust') || (plan.status !== undefined && !['valid', 'exhaust'].includes(plan.status))) throw fail(locale, 'unavailable')
  const total = plan.totalCredits, remaining = plan.remainingCredits
  if (!finite(total) || total <= 0 || !finite(remaining) || remaining > total) throw fail(locale, 'invalid')
  const used = total - remaining
  const fmt = value => value.toLocaleString('en-US', { maximumFractionDigits: 6 })
  const windows = {
    // Do not feed the ambiguous CLI period into monthly token estimates.
    quota: { percent: Math.round(used / total * 1000) / 10, resetsAt: '' },
    credits: { resetsAt: '', text: `${fmt(used)} / ${fmt(total)} Credits (CLI)` },
  }
  if (plan.addonRemaining !== undefined) {
    if (!finite(plan.addonRemaining)) throw fail(locale, 'invalid')
    windows.addon = { resetsAt: '', text: `${message(locale, 'addon')}: ${fmt(plan.addonRemaining)} Credits` }
  }
  // CLI 1.6.x maps resetDate from subscription EndTime, not the monthly reset.
  // Render it as text; never use it as a quota reset or a sampling boundary.
  if (typeof plan.resetDate === 'string' && plan.resetDate.length > 0) {
    const ms = Date.parse(plan.resetDate)
    if (!Number.isFinite(ms)) throw fail(locale, 'invalid')
    windows.expiry = { resetsAt: '', text: `${message(locale, 'expiry')}: ${new Date(ms).toISOString()}` }
  }
  return { windows }
}

/** Resolve PATH without a shell; Windows npm .cmd shims are never evaluated. */
export const resolveQwenCli = (options = {}) =>
  resolveNpmCli({ packageName: '@qianwenai/qianwen-cli', binName: 'qianwen', ...options })
export async function queryQwenCli(locale = 'zh', options = {}) {
  const command = await resolveQwenCli(options)
  if (!command) throw fail(locale, 'missing')
  const { env = process.env, signal, timeoutMs = 15000, maxBuffer = 1024 * 1024 } = options
  let payload
  try {
    payload = await runCliJson({ ...command, args: [...command.args, ...QWEN_CLI_ARGS], env, signal, timeoutMs, maxBuffer })
  } catch (error) {
    // Never expose child output, command paths or credential-bearing errors.
    throw fail(locale, bridgeCode(error, { authExitCode: 2 }))
  }
  return parseQwenSummary(payload, locale)
}
