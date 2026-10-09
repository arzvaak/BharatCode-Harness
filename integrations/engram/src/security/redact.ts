/**
 * Redact common credentials before ingestion: API keys, Bearer tokens, AWS and GitHub
 * credentials, PEM private keys, and secret assignments become [REDACTED:<kind>].
 * Retain categories for auditing; process stored content and auxiliary input, not original conversations.
 * @module @kenz1117/dsh-engram/security/redact
 */

/** Typed redaction marker identifies the credential category for auditing. */
function redacted(kind: string): string {
  return `[REDACTED:${kind}]`
}

/**
 * Remove recognized credentials from text.
 * @param text - Session text, model candidates, or explicitly saved memory contents.
 * @returns Redacted text, unchanged when no credential pattern matches.
 */
export function redactSecrets(text: string): string {
  return text
    // Entire multiline PEM private keys first, before assignment rules can truncate them.
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, redacted('private-key'))
    // Bearer authorization tokens; retain the Bearer label for readable context.
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, `Bearer ${redacted('bearer-token')}`)
    // sk-prefixed API keys, including project, coding-plan, Anthropic, and service-account variants.
    .replace(/\bsk-(?:proj-|cp-|ant-|svcacct-)?[A-Za-z0-9_-]{16,}/g, redacted('api-key'))
    // GitHub token prefixes: ghp_, gho_, ghu_, ghs_, and ghr_.
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, redacted('github-token'))
    // AWS access-key identifiers: AKIA followed by sixteen uppercase alphanumeric characters.
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, redacted('aws-access-key'))
    // Generic secret assignments after = or :, stopping at quotes or delimiters.
    .replace(
      /\b(password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|auth[_-]?token)\b\s*[=:]\s*("[^"\n]*"|'[^'\n]*'|[^'",;\s)\]}]+)/gi,
      (_match, key: string) => `${key}=${redacted('secret-value')}`,
    )
    // Localized password assignments with non-CJK values; avoid matching ordinary prose.
    .replace(
      /(密码|口令)[是为:：\s]{0,3}([A-Za-z0-9!@#$%^&*()_+=\[\]{}<>/?\\|`~.-]{4,})/g,
      (_match, key: string) => `${key}=${redacted('password')}`,
    )
    // Mainland mobile numbers: eleven digits beginning with 1[3-9], not embedded in longer numbers.
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, redacted('phone'))
    // Mainland identity numbers: region, plausible birth date, sequence, and check character.
    .replace(/\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g, redacted('id-number'))
}
