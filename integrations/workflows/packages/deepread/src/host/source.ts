import type { CacheRecord, DeepreadInput, HostContext, PdfStats, RuntimeConfig, SourceResult, WebService } from './types.js'
import { errorMessage, isBinaryFileService, isRecord, isTextFileService } from './types.js'

// ---------- HTML → 文本 ----------
function decodeEntities(s: string): string {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', middot: '·', times: '×', divide: '÷', copy: '©', reg: '®', laquo: '«', raquo: '»', bull: '•', deg: '°', emsp: ' ', ensp: ' ' }
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (mm, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : mm
    }
    const v = named[e.toLowerCase() as keyof typeof named]
    return v !== undefined ? v : mm
  })
}

function balancedRegion(html: string, openEndIndex: number, tagName: string): { start: number; end: number } {
  const openRe = new RegExp('<' + tagName + '(\\s|>)', 'g')
  const closeRe = new RegExp('</' + tagName + '\\s*>', 'g')
  let depth = 1
  let pos = openEndIndex
  while (depth > 0) {
    openRe.lastIndex = pos
    closeRe.lastIndex = pos
    const om = openRe.exec(html)
    const cm = closeRe.exec(html)
    if (cm === null) return { start: openEndIndex, end: html.length }
    if (om !== null && om.index < cm.index) {
      depth++
      pos = om.index + om[0].length
    } else {
      depth--
      if (depth === 0) return { start: openEndIndex, end: cm.index }
      pos = cm.index + cm[0].length
    }
  }
  return { start: openEndIndex, end: html.length }
}

export function htmlToText(html: string): { title: string; text: string } {
  let title = ''
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (tm?.[1] !== undefined) title = decodeEntities(tm[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  const candidates = [
    /<div[^>]*id\s*=\s*["'](?:js_content|content_views|article-root|js_content_root|root)["'][^>]*>/i,
    /<div[^>]*class\s*=\s*["'][^"']*(?:rich_media_content|article-content|RichText|Post-RichTextContainer|markdown-body|article-body|entry-content|content)[^"']*["'][^>]*>/i,
    /<article(?:\s[^>]*)?>/i,
    /<main(?:\s[^>]*)?>/i,
  ]
  let content = ''
  for (const re of candidates) {
    const mm = re.exec(html)
    if (mm === null) continue
    const tag = mm[0].match(/^<([a-zA-Z0-9]+)/)?.[1]
    if (tag === undefined) continue
    const region = balancedRegion(html, mm.index + mm[0].length, tag)
    const piece = html.slice(region.start, region.end)
    const plain = piece.replace(/<[^>]+>/g, '')
    if (plain.length > 200) {
      content = piece
      break
    }
  }
  if (content === '') {
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
    content = body?.[1] ?? html
  }
  content = content
    .replace(/<(script|style|noscript|svg|iframe|form|nav|footer|aside|button|select|textarea)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|noscript|svg|iframe)[^>]*\/?>/gi, ' ')
    .replace(/<h[1-6][^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|ul|ol|figure|figcaption|header|footer|table|details)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(p|div|section|article|blockquote|pre|table)[^>]*>/gi, '\n')
    .replace(/<img[^>]*alt\s*=\s*["']([^"']*)["'][^>]*>/gi, '[Image: $1]')
    .replace(/<[^>]+>/g, ' ')
  content = decodeEntities(content)
  content = content
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text: content }
}


type ProgressCallback = (line: string) => void
export interface SourceOptions { onProgress?: ProgressCallback | null | undefined; statsOnly?: boolean }
interface SourceRuntimeDependencies {
  bytesToLatin1(bytes: Uint8Array): string
  ctx: HostContext
  extractPdfStats(latin1: string): PdfStats
  extractPdfText(latin1: string, onPage?: (info: { done: number; total: number }) => void): string
  readCacheEntry(url: string, ignoreTtl: boolean): Promise<CacheRecord | null>
  tune: RuntimeConfig
  web: WebService | undefined
  writeCacheEntry(url: string, text: string): Promise<void>
}

export function createSourceRuntime(deps: SourceRuntimeDependencies) {
  const { bytesToLatin1, ctx, extractPdfStats, extractPdfText, readCacheEntry, tune, web, writeCacheEntry } = deps
// 抓取并提取微信公众号正文：web 服务优先、全局 fetch 兜底、反爬验证页换 UA
// 重试一次、标题前置。任何失败以异常上抛，由 resolveSource 决定回退缓存还是透传。
async function fetchArticleText(url: string): Promise<string> {
  let result = null
  let webError = null
  if (web !== undefined) {
    try {
      result = await web.fetch({ url })
    } catch (err) {
      webError = err
    }
  }
  if (result === null || typeof result !== 'object' || typeof result.statusCode !== 'number') {
    // 回退：web 服务无可用 provider 时用 Node 全局 fetch 兜底
    try {
      const resp = await globalThis.fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
      })
      const bodyText = await resp.text()
      result = { statusCode: resp.status, body: { kind: 'html', content: bodyText } }
    } catch (err) {
      const reason = webError !== null ? errorMessage(webError) : errorMessage(err)
      throw new Error('Web fetch failed: ' + reason)
    }
  }
  if (result.statusCode < 200 || result.statusCode >= 300) throw new Error('The web server returned status ' + result.statusCode + ' and fetch failed')
  const body = result.body
  let contentText = ''
  let pageTitle = ''
  if (isRecord(body) && body.kind === 'text' && typeof body.content === 'string') {
    contentText = body.content
  } else if (isRecord(body) && body.kind === 'html' && typeof body.content === 'string') {
    const parsed = htmlToText(body.content)
    pageTitle = parsed.title
    contentText = parsed.text
  }
  if (contentText.trim() === '') throw new Error('The page has no readable content. The link may have expired, the article may be deleted, or login may be required. Use a stable URL or paste the text.')
  // 微信反爬验证页（环境异常/去验证）不是正文：换浏览器 UA 走全局 fetch 重试一次
  const looksAntiBot = /环境异常|完成验证|去验证/.test(contentText) && contentText.length < 4000
  if (looksAntiBot) {
    try {
      const resp = await globalThis.fetch(url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
      })
      const retried = htmlToText(await resp.text())
      if (retried.text.trim() !== '' && !/环境异常|完成验证|去验证/.test(retried.text)) {
        contentText = retried.text
        if (retried.title !== '') pageTitle = retried.title
      }
    } catch (err) { /* 保留原内容，交给后续模型处理 */ }
  }
  if (pageTitle !== '' && contentText.indexOf(pageTitle) === -1) contentText = pageTitle + '\n\n' + contentText
  return contentText
}

async function resolveSource(args: DeepreadInput, opts: SourceOptions = {}): Promise<SourceResult> {
  const opt = opts
  const onProgress = typeof opt.onProgress === 'function' ? opt.onProgress : null
  const url = typeof args.url === 'string' ? args.url.trim() : ''
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  const text = typeof args.text === 'string' ? args.text : ''
  if (url !== '') {
    const hostMatch = url.match(/^https?:\/\/([^\/?#]+)/i)
    const host = hostMatch?.[1]?.toLowerCase() ?? ''
    if (host !== 'mp.weixin.qq.com' && host !== 'weixin.qq.com' && !host.endsWith('.weixin.qq.com')) {
      throw new Error('URL reading supports only stable mp.weixin.qq.com articles. ' + (host === '' ? 'The URL is invalid.' : '「' + host + '] may require login or block requests. Paste its text or save a .txt/.md/.pdf file and pass path.'))
    }
    const refresh = args.refresh === true
    if (tune.cacheEnabled && !refresh) {
      const hit = await readCacheEntry(url, false)
      if (hit !== null) return { text: hit.text, source: url, sourceKind: 'url', cache: 'hit', fetchedAt: hit.fetchedAt }
    }
    let contentText = ''
    let fetchError: unknown = null
    try {
      contentText = await fetchArticleText(url)
    } catch (err) {
      fetchError = err
    }
    if (fetchError !== null) {
      if (tune.cacheEnabled) {
        const stale = await readCacheEntry(url, true)
        if (stale !== null) {
          const reason = errorMessage(fetchError)
          return { text: stale.text, source: url, sourceKind: 'url', cache: 'fallback', fetchedAt: stale.fetchedAt, note: 'Fetch failed (' + reason + '); using the cached source instead' }
        }
      }
      throw fetchError
    }
    const looksAntiBot = /环境异常|完成验证|去验证/.test(contentText) && contentText.length < 4000
    if (tune.cacheEnabled && !looksAntiBot) await writeCacheEntry(url, contentText)
    return { text: contentText, source: url, sourceKind: 'url', cache: tune.cacheEnabled ? 'miss' : 'disabled' }
  }
  if (path !== '') {
    const lower = path.toLowerCase()
    if (lower.endsWith('.pdf')) {
      if (!isBinaryFileService(ctx.fs)) throw new Error('The workspace file service is unavailable')
      const target = await ctx.fs.resolve(path)
      const bytes = await ctx.fs.readBytes(target, undefined, 30 * 1024 * 1024)
      const latin = bytesToLatin1(bytes)
      const t0 = Date.now()
      if (opt.statsOnly === true) {
        let pdfStats = null
        try {
          pdfStats = extractPdfStats(latin)
        } catch (error) {
          throw new Error('PDF parsing failed: ' + errorMessage(error))
        }
        return { text: '', source: path, sourceKind: 'pdf', pdfStats, extractMs: Date.now() - t0 }
      }
      let extracted = ''
      try {
        let lastPct = -1
        extracted = extractPdfText(latin, onProgress === null ? undefined : (info) => {
          if (info.done === 0) {
            onProgress('Parsing PDF (' + info.total + ' pages)')
            return
          }
          const total = Math.max(1, info.total)
          const pct = Math.round((info.done / total) * 100)
          if (info.done >= total || pct >= lastPct + 5) {
            lastPct = pct
            onProgress('Parsing PDF: ' + pct + '%（' + info.done + '/' + total + ' pages)')
          }
        })
      } catch (error) {
        throw new Error('PDF parsing failed: ' + errorMessage(error))
      }
      if (extracted.trim() === '') throw new Error('The PDF has no extractable text. Run OCR or convert it to text before reading.')
      return { text: extracted, source: path, sourceKind: 'pdf', extractMs: Date.now() - t0 }
    }
    if (/\.(txt|md|markdown|text|html|htm|csv|json|log)$/i.test(lower)) {
      if (!isTextFileService(ctx.fs)) throw new Error('The workspace file service is unavailable')
      const target = await ctx.fs.resolve(path)
      let content = await ctx.fs.readText(target)
      if (/\.(html|htm)$/i.test(lower)) content = htmlToText(content).text
      return { text: content, source: path, sourceKind: 'file' }
    }
    throw new Error('Unsupported file type: ' + path + ' (supported: .txt / .md / .markdown / .html / .pdf)')
  }
  if (text.trim() === '') throw new Error('No readable content was supplied: provide a supported URL, workspace path, or pasted text')
  return { text, source: 'Pasted text', sourceKind: 'text' }
}

// estimate 模式的轻量预解析：大 PDF（原始字节 > 2MB）走采样，其余全量；避免重复全量解析。
async function resolveForEstimate(args: DeepreadInput): Promise<SourceResult> {
  const path = typeof args.path === 'string' ? args.path.trim() : ''
  if (path !== '' && path.toLowerCase().endsWith('.pdf')) {
    if (!isBinaryFileService(ctx.fs)) throw new Error('The workspace file service is unavailable')
    const target = await ctx.fs.resolve(path)
    const bytes = await ctx.fs.readBytes(target, undefined, 30 * 1024 * 1024)
    if (bytes.length > 2 * 1024 * 1024) {
      return resolveSource(args, { statsOnly: true })
    }
  }
  return resolveSource(args)
}


  return { resolveForEstimate, resolveSource }
}
