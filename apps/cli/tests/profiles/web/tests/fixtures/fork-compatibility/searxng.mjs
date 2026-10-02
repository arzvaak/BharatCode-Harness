/**
 * SearXNG-backed `web_search` provider.
 *
 * Registers into the shared web seam (`ctx.web`) without owning it, so the
 * model-facing `web_search` tool keeps its schema, formatting, batching and
 * citation rules — only the data source changes: a local SearXNG instance
 * instead of a keyed cloud search API. No API key, no per-query cost, no
 * outbound query data leaving the machine (the engines still fetch their own
 * results, of course).
 *
 * SearXNG's JSON API (`GET /search?format=json`) returns already-merged engine
 * results in one shape: `results[].{url,title,content,publishedDate,engines}`.
 * That maps onto the seam's portable `WebSearchSource` almost one-to-one.
 *
 * Dependencies stay minimal on purpose: this bundle is `link:`-installed, so
 * bare specifiers resolve through the workspace `node_modules`; `@deepseek-ai/
 * dsh-web` has no usable published build, so the provider throws a local
 * error class carrying the same `code` shape instead of importing `WebError`.
 *
 * @module @local/dsh-web-search-searxng
 */

import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Stable id this provider registers under; also the pinned `searchProvider`. */
export const PROVIDER_ID = 'searxng'

/** The local podman instance started for this machine (port 8888). */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8888'

/** Attribution header sent on every request. */
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * Provider failure with a machine-routable `code`, mirroring the seam's
 * `WebError` taxonomy: `WEB_PROVIDER_ERROR` for transport/HTTP/shape failures,
 * `WEB_ABORTED` for cancellation.
 */
export class SearxngError extends Error {
  /**
   * @param message - human-readable failure description.
   * @param code - machine-routable error code.
   * @param options - standard `Error` options (`cause`).
   */
  constructor(message, code, options = {}) {
    super(message, options)
    this.name = 'SearxngError'
    this.code = code
  }
}

/** Plugin config; every field is optional, the defaults target the local instance. */
export const Config = z.object({
  /** Instance base URL; `GET /search` is the operation. */
  baseURL: z.string().default(DEFAULT_BASE_URL),
  /** `language` search preference passed to SearXNG. */
  language: z.string().default('en'),
  /** 0 off, 1 moderate, 2 strict. */
  safesearch: z.number().min(0).max(2).default(0),
  /** `categories` filter; `general` is the broad web set. */
  categories: z.string().default('general'),
  /** Per-request timeout in milliseconds (the tool's own timeout still applies). */
  timeoutMs: z.number().min(1000).default(25000),
})

/**
 * True when `value` parses as an absolute http(s) URL.
 * @param value - candidate base URL.
 * @returns whether it is usable as a request base.
 */
function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Map one SearXNG result to a portable source.
 * @param result - one entry of the JSON API's `results[]`.
 * @returns the normalized source, or `undefined` when it carries no URL.
 */
function mapResult(result) {
  if (typeof result.url !== 'string' || result.url.length === 0) return undefined
  const snippet = typeof result.content === 'string' ? result.content.trim() : ''
  const title = typeof result.title === 'string' ? result.title.trim() : ''
  const published = typeof result.publishedDate === 'string' ? result.publishedDate : ''
  return {
    url: result.url,
    ...title.length > 0 ? { title } : {},
    ...snippet.length > 0 ? { snippet } : {},
    ...published.length > 0 ? { publishedAt: published } : {},
  }
}

/**
 * Map a SearXNG JSON response to a normalized search result.
 *
 * Duplicate URLs (the same page hit by several engines) are collapsed on first
 * occurrence, `answers[]` — SearXNG's computed short answers — become the
 * optional provider `content`, and the request-layer cap keeps the payload
 * proportional to what the seam will return anyway.
 *
 * @param payload - parsed `/search?format=json` body.
 * @param maxResults - per-request source bound, when the caller supplied one.
 * @returns the normalized result; `truncated: false` because the seam owns the
 *   final cap.
 */
export function mapResponse(payload, maxResults) {
  const seen = new Set()
  const sources = []
  for (const entry of Array.isArray(payload.results) ? payload.results : []) {
    const source = mapResult(entry)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
    if (maxResults !== undefined && sources.length >= maxResults) break
  }
  const answers = Array.isArray(payload.answers) ? payload.answers.filter(a => typeof a === 'string' && a.trim()) : []
  return {
    ...answers.length > 0 ? { content: answers.join(' ') } : {},
    sources,
    truncated: false,
  }
}

/** The SearXNG-backed search provider. */
export class SearxngSearchProvider {
  /** Registry key for this provider. */
  id = PROVIDER_ID

  /**
   * @param options - resolved plugin config (the plugin's `apply` fills defaults).
   */
  constructor(options) {
    this.options = options
  }

  /**
   * Local usability check; never makes network calls (the seam's contract).
   * @returns whether the provider is configured well enough to try.
   */
  available() {
    return isHttpUrl(this.options.baseURL)
      && Number.isFinite(this.options.timeoutMs) && this.options.timeoutMs > 0
  }

  /**
   * Run one search against the local instance.
   * @param request - the query and optional source bound.
   * @param signal - cancellation signal from the tool execution.
   * @returns the normalized result.
   */
  async search(request, signal) {
    const endpoint = new URL('/search', this.options.baseURL)
    endpoint.searchParams.set('q', request.query)
    endpoint.searchParams.set('format', 'json')
    if (this.options.language.length > 0) endpoint.searchParams.set('language', this.options.language)
    if (this.options.categories.length > 0) endpoint.searchParams.set('categories', this.options.categories)
    endpoint.searchParams.set('safesearch', String(this.options.safesearch))

    // Per-request timeout joined with the caller's signal: cancellation stays
    // authoritative, the local timeout only bounds a hung engine.
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const effective = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout

    let response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        signal: effective,
      })
    } catch (error) {
      if (isAbortError(error)) {
        throw new SearxngError(`SearXNG search aborted: ${String(error)}`, 'WEB_ABORTED', { cause: error })
      }
      throw new SearxngError(
        `SearXNG search request failed (is the dsh-searxng container running? try "podman start dsh-searxng"): ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    if (!response.ok) {
      throw new SearxngError(`SearXNG error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    }

    let payload
    try {
      payload = await response.json()
    } catch (error) {
      if (isAbortError(error)) {
        throw new SearxngError(`SearXNG search aborted: ${String(error)}`, 'WEB_ABORTED', { cause: error })
      }
      throw new SearxngError('SearXNG returned a non-JSON body (is "json" in search.formats?)', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    return mapResponse(payload, request.maxResults)
  }
}

/**
 * Register the SearXNG search provider with `ctx.web`.
 * @param ctx - plugin context owning the web seam.
 * @param config - validated config; schema defaults cover a direct invocation
 *   without a patch row.
 */
export function apply(ctx, config) {
  const cfg = config ?? Config({})
  ctx.web.registerSearchProvider(new SearxngSearchProvider({
    baseURL: cfg.baseURL,
    language: cfg.language,
    safesearch: cfg.safesearch,
    categories: cfg.categories,
    timeoutMs: cfg.timeoutMs,
  }))
}

/** @param error - caught fetch rejection. @returns whether it is a cancellation. */
function isAbortError(error) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'DOMException')
}
