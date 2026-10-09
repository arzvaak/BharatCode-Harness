/**
 * Freeze-request parser and security gate: parses the system-prompt-agreed
 * freeze format into a structured context snapshot (goal / progress / next),
 * redacts sensitive patterns to markers, rejects slash-prefixed DSH command
 * lines, and enforces the 8 KiB per-field byte limit.
 * Pure functions only: no session, network, or filesystem access.
 */

/** Hard per-field limit: 8 KiB measured in UTF-8 bytes. */
export const FREEZE_FIELD_BYTE_LIMIT = 8 * 1024

/** Marker replacing every sensitive match. */
export const REDACTED_MARKER = '[REDACTED]'

/** Structured context snapshot carried by a continuation card. */
export interface FreezeSnapshot {
  goal: string
  progress: string
  next: string
}

/** Non-fatal notices produced by the security gate. */
export type FreezeWarning = 'redacted'

export type FreezeResult =
  | { ok: true; snapshot: FreezeSnapshot; warnings: FreezeWarning[] }
  | { ok: false; error: { code: string; message: string } }

const BEGIN = '<<<FREEZE'
const END = '>>>FREEZE'

const SECTION_KEYS: ReadonlyMap<string, SectionKey> = new Map([
  ['目标:', 'goal'],
  ['进度:', 'progress'],
  ['下一步:', 'next'],
])

type SectionKey = 'goal' | 'progress' | 'next'

const SECTION_ORDER: readonly SectionKey[] = ['goal', 'progress', 'next']

const SECTION_NAMES: Record<SectionKey, string> = {
  goal: 'Goal',
  progress: 'Progress',
  next: 'Next step',
}

/**
 * Sensitive patterns, each matched globally over every field body:
 * PEM private key blocks (whole block collapses to one marker), Bearer
 * credentials, OpenAI sk-, `ghp_`-shaped provider tokens, GitLab glpat-,
 * Slack xox* tokens, and AWS access key ids.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._~+\/=:-]{8,}/gi,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /glpat-[A-Za-z0-9_-]{15,}/g,
  /xox[bpars]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
]

function fail(code: string, message: string): FreezeResult {
  return { ok: false, error: { code, message } }
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Redact sensitive patterns to the marker; reports whether any hit occurred. */
export function redactSensitive(text: string): { text: string; redacted: boolean } {
  let out = text
  let redacted = false
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(out)) {
      redacted = true
      out = out.replace(pattern, REDACTED_MARKER)
    }
    pattern.lastIndex = 0
  }
  return { text: out, redacted }
}

/**
 * True when any line of the text starts with "/" (a DSH command line).
 * Leading horizontal whitespace before the slash counts too: a frozen
 * body line like `  /kill` is still a command, not prose.
 */
export function hasSlashCommandLines(text: string): boolean {
  return text.split(/\r?\n/).some(line => /^[ \t]+\//.test(line) || line.startsWith('/'))
}

/**
 * Sanitize a structured freeze snapshot (the create/update action payload):
 * shape check, slash-command taint rejection, sensitive redaction, and the
 * per-field byte cap - the same gate parseFreezeRequest applies to
 * free-text freeze requests, exposed for the action data plane (issue #4).
 * @param value - the freeze object carried by an action or read back from disk.
 * @param extraKeys - keys allowed alongside goal/progress/next (e.g. the
 *   protocol redacted flag, the ledger frozenAt stamp) and preserved verbatim
 *   when present; their validation stays with the caller.
 */
export function sanitizeFreezeSnapshot(
  value: unknown,
  extraKeys: readonly string[] = [],
): { ok: true; snapshot: FreezeSnapshot; redacted: boolean; extras: Record<string, unknown> } | { ok: false; error: { code: string; message: string } } {
  const bad = (code: string, message: string) => ({ ok: false as const, error: { code, message } })
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bad('invalid-freeze', 'Freeze snapshot must be an object with string goal/progress/next fields')
  }
  const record = value as Record<string, unknown>
  const allowed = ['goal', 'progress', 'next', ...extraKeys]
  if (!Object.keys(record).every(key => allowed.includes(key))) {
    return bad('invalid-freeze', 'Freeze snapshot contains unknown fields')
  }
  for (const key of SECTION_ORDER) {
    if (typeof record[key] !== 'string') {
      return bad('invalid-freeze', 'Freeze snapshot field ' + SECTION_NAMES[key] + ' must be a string')
    }
  }
  for (const key of SECTION_ORDER) {
    if (hasSlashCommandLines(record[key] as string)) {
      return bad('dsh-command-line', 'Freeze text for ' + SECTION_NAMES[key] + ' contains a slash-prefixed command line; the entire request is rejected')
    }
  }
  let redacted = false
  const snapshot: Record<SectionKey, string> = { goal: '', progress: '', next: '' }
  for (const key of SECTION_ORDER) {
    const result = redactSensitive(record[key] as string)
    snapshot[key] = result.text
    redacted = redacted || result.redacted
  }
  for (const key of SECTION_ORDER) {
    if (utf8Bytes(snapshot[key]) > FREEZE_FIELD_BYTE_LIMIT) {
      return bad('field-too-large', 'Freeze snapshot field ' + SECTION_NAMES[key] + ' exceeds the 8 KiB limit')
    }
  }
  const extras: Record<string, unknown> = {}
  for (const key of extraKeys) if (key in record) extras[key] = record[key]
  return { ok: true, snapshot: { goal: snapshot.goal, progress: snapshot.progress, next: snapshot.next }, redacted, extras }
}

/**
 * Parse the freeze-request format: a <<<FREEZE ... >>>FREEZE block whose body
 * requires the exact protocol headers for goal, progress, and next step, each followed by body lines.
 * The gate applies before returning: slash-command taint rejects the whole
 * request, sensitive patterns are redacted to markers, and each field is
 * capped at FREEZE_FIELD_BYTE_LIMIT UTF-8 bytes.
 */
export function parseFreezeRequest(input: string): FreezeResult {
  const beginIndex = input.indexOf(BEGIN)
  if (beginIndex === -1) {
    return fail('missing-block', 'No freeze request block found (expected <<<FREEZE ... >>>FREEZE)')
  }
  const bodyStart = beginIndex + BEGIN.length
  const endIndex = input.indexOf(END, bodyStart)
  if (endIndex === -1) {
    return fail('unterminated-block', 'Freeze request block is not closed (missing >>>FREEZE)')
  }
  const block = input.slice(bodyStart, endIndex)

  const raw = new Map<SectionKey, string[]>()
  let current: SectionKey | undefined
  for (const line of block.split(/\r?\n/)) {
    const key = SECTION_KEYS.get(line)
    if (key !== undefined) {
      if (raw.has(key)) {
        return fail('duplicate-section', `Duplicate section header: ${SECTION_NAMES[key]}`)
      }
      raw.set(key, [])
      current = key
    } else if (current !== undefined) {
      raw.get(current)!.push(line)
    }
  }

  const snapshot: Record<SectionKey, string> = { goal: '', progress: '', next: '' }
  for (const key of SECTION_ORDER) {
    if (!raw.has(key)) {
      return fail('missing-section', `Freeze request is missing section: ${SECTION_NAMES[key]}`)
    }
    const lines = raw.get(key)!
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    snapshot[key] = lines.join('\n')
  }

  for (const key of SECTION_ORDER) {
    if (hasSlashCommandLines(snapshot[key])) {
      return fail('dsh-command-line', `Freeze text for ${SECTION_NAMES[key]} contains a slash-prefixed command line; the entire request is rejected`)
    }
  }

  let redacted = false
  for (const key of SECTION_ORDER) {
    const result = redactSensitive(snapshot[key])
    snapshot[key] = result.text
    redacted = redacted || result.redacted
  }

  for (const key of SECTION_ORDER) {
    if (utf8Bytes(snapshot[key]) > FREEZE_FIELD_BYTE_LIMIT) {
      return fail('field-too-large', `Freeze snapshot field ${SECTION_NAMES[key]} exceeds the 8 KiB limit`)
    }
  }

  return {
    ok: true,
    snapshot: { goal: snapshot.goal, progress: snapshot.progress, next: snapshot.next },
    warnings: redacted ? ['redacted'] : [],
  }
}
