/** Browser-safe Markdown parsing, navigation and portable citation preparation. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { load, JSON_SCHEMA } from 'js-yaml'
import type { RootContent } from 'mdast'
import type { ResearchMarkdown, ResearchLink, ResearchResolution, ResearchCitation } from './research-types.ts'

function plain(node: RootContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  return 'children' in node ? node.children.map(child => plain(child as RootContent)).join('') : ''
}
function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []).filter(
    (v): v is string => typeof v === 'string',
  )
}
/** Parse metadata and links while retaining exact source offsets. */
export function parseResearchMarkdown(text: string): ResearchMarkdown {
  const front = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  let metadata: Record<string, unknown> = {}
  if (front !== null) {
    try {
      const loaded: unknown = load(front[1] ?? '', { schema: JSON_SCHEMA })
      if (loaded !== null && typeof loaded === 'object' && !Array.isArray(loaded))
        metadata = loaded as Record<string, unknown>
    } catch {
      /* Malformed metadata stays authored text. */
    }
  }
  const offset = front?.[0].length ?? 0
  const root = fromMarkdown(text.slice(offset), { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const definitions = new Map<string, string>()
  const headings: string[] = []
  const links: ResearchLink[] = []
  const visit = (
    nodes: readonly RootContent[], fn: (node: RootContent, insideLink: boolean) => void, insideLink = false,
  ): void => {
    for (const node of nodes) {
      fn(node, insideLink)
      if ('children' in node) visit(node.children as RootContent[], fn,
        insideLink || node.type === 'link' || node.type === 'linkReference')
    }
  }
  visit(root.children, (node) => {
    if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node.url)
  })
  visit(root.children, (node, insideLink) => {
    const start = (node.position?.start.offset ?? 0) + offset
    const end = (node.position?.end.offset ?? 0) + offset
    if (node.type === 'heading') headings.push(plain(node))
    if (
      node.type === 'link' ||
      node.type === 'image' ||
      node.type === 'linkReference' ||
      node.type === 'imageReference'
    ) {
      const target = 'url' in node ? node.url : definitions.get(node.identifier.toLowerCase())
      const labelEnd = 'children' in node ? node.children.at(-1)?.position?.end.offset : undefined
      if (target !== undefined)
        links.push({
          target,
          label: plain(node) || ('alt' in node ? (node.alt ?? target) : target),
          labelMarkdown: labelEnd === undefined ? undefined : text.slice(start + 1, offset + labelEnd),
          wiki: false,
          embed: node.type.startsWith('image'),
          start,
          end,
        })
    }
    if (node.type === 'text' && !insideLink) {
      // Search the authored text, since mdast's decoded value can have different offsets.
      const authored = text.slice(start, end)
      const pattern = /(!?)\[\[([^\]\n]+)\]\]/g
      for (const match of authored.matchAll(pattern)) {
        // An escaped bracket is literal Markdown.
        if (match.index > 0 && /(?:^|[^\\])(?:\\\\)*\\$/.test(authored.slice(0, match.index))) continue
        const [target = '', label] = (match[2] ?? '').split('|')
        links.push({
          target,
          label: label ?? target,
          wiki: true,
          embed: match[1] === '!',
          start: start + match.index,
          end: start + match.index + match[0].length,
        })
      }
    }
  })
  return {
    title: typeof metadata.title === 'string' ? metadata.title : (headings[0] ?? ''),
    aliases: strings(metadata.aliases ?? metadata.alias),
    tags: strings(metadata.tags),
    headings,
    links: links.sort((a, b) => a.start - b.start),
  }
}
/** Normalize a vault-relative path without permitting escape or OS-specific absolute paths. */
export function researchPath(value: string): string | undefined {
  if (!value || /^[\\/]|^[a-zA-Z]:|\0/.test(value)) return undefined
  const parts: string[] = []
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!parts.length) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return parts.length ? parts.join('/') : undefined
}
/** Resolve only unique note targets; ambiguous names require a user choice. */
export function resolveResearchLink(
  notes: readonly (ResearchMarkdown & { path: string })[],
  from: string,
  link: Pick<ResearchLink, 'target' | 'wiki'>,
): ResearchResolution {
  let target = link.target
  if (/^https?:\/\//i.test(target)) return { status: 'external', url: target }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(target)) return { status: 'invalid' }
  const index = target.indexOf('#')
  let heading = index < 0 ? undefined : target.slice(index + 1)
  target = index < 0 ? target : target.slice(0, index)
  if (!link.wiki) {
    try {
      target = decodeURIComponent(target)
      if (heading !== undefined) heading = decodeURIComponent(heading)
    } catch {
      return { status: 'invalid' }
    }
  }
  if (/^[\\/]/.test(target)) return { status: 'invalid' }
  if (heading?.startsWith('^')) return { status: 'invalid' }
  if (!target && heading !== undefined) return { status: 'resolved', path: from, heading }
  const directory = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
  const path = researchPath(link.wiki ? target : directory + target)
  if (path === undefined) return { status: 'invalid' }
  const paths = [path, ...(/\.(md|markdown)$/i.test(path) ? [] : [path + '.md', path + '.markdown'])]
  const exact = notes.filter(note => paths.includes(note.path))
  if (link.wiki && !target.includes('/')) {
    const matches = notes.filter((note) => {
      const basename = (note.path.split('/').at(-1) ?? '').replace(/\.(md|markdown)$/i, '')
      return basename === target.replace(/\.(md|markdown)$/i, '')
    })
    const aliases = matches.length ? matches : notes.filter(note => note.aliases.includes(target))
    const candidate = aliases[0]
    if (aliases.length === 1 && candidate !== undefined) return { status: 'resolved', path: candidate.path, heading }
    if (aliases.length > 1) return { status: 'ambiguous', candidates: aliases.map(note => note.path) }
  }
  const candidate = exact[0]
  if (exact.length === 1 && candidate !== undefined) return { status: 'resolved', path: candidate.path, heading }
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact.map(note => note.path) }
  return { status: 'missing', path }
}
/** Convert wikilinks for the native reader without modifying stored Markdown. */
export function researchReadingText(text: string): string {
  let result = text
  for (const link of parseResearchMarkdown(text)
    .links.filter(link => link.wiki || (!link.embed && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(link.target)))
    .reverse()) {
    const label = link.wiki ? link.label.replace(/[\[\]\\]/g, '\\$&') : link.labelMarkdown ?? link.label
    const image = link.embed && /\.(png|jpe?g|gif|webp|svg)$/i.test(link.target)
    const replacement = `${image ? '!' : ''}[${label}](research-${link.wiki ? 'wiki' : 'file'}/${encodeURIComponent(link.target)})`
    result = result.slice(0, link.start) + replacement + result.slice(link.end)
  }
  const front = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(result)
  result = front === null ? result : result.slice(front[0].length)
  const root = fromMarkdown(result, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const comments: { start: number; end: number }[] = []
  const visit = (nodes: readonly RootContent[]): void => {
    for (const node of nodes) {
      if (node.type === 'html') {
        for (const marker of node.value.matchAll(/<!-- research-citation:[\w-]+:\d+:\d+ -->/g)) {
          const start = (node.position?.start.offset ?? 0) + marker.index
          comments.push({ start, end: start + marker[0].length })
        }
      }
      if ('children' in node) visit(node.children as RootContent[])
    }
  }
  visit(root.children)
  for (const comment of comments.reverse()) result = result.slice(0, comment.start) + result.slice(comment.end)
  return result
}
/** Insert a normal Markdown footnote and a recoverable immutable evidence locator. */
export function prepareResearchCitation(text: string, citation: ResearchCitation): string {
  if (
    !/^[\w-]+$/.test(citation.id) ||
    !Number.isSafeInteger(citation.start) ||
    !Number.isSafeInteger(citation.end) ||
    citation.start < 0 ||
    citation.end <= citation.start
  )
    throw new Error('Invalid citation locator')
  let number = 1
  while (text.includes(`[^source-${number}]`)) ++number
  const label = `source-${number}`
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const title = citation.title.replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]/g, ' ')
  const quote = citation.quote.replace(/\r?\n/g, `${newline}    `)
  const url = encodeURI(citation.url).replace(/[()]/g, value => (value === '(' ? '%28' : '%29'))
  const root = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const definitions = root.children.filter(node => node.type === 'footnoteDefinition')
  const offset = definitions[0]?.position?.start.offset ?? text.length
  const body = text.slice(0, offset).trimEnd()
  const existing = text.slice(offset).trimEnd()
  const prefix = `${body}[^${label}]${newline}${newline}${existing ? existing + newline + newline : ''}`
  return `${prefix}[^${label}]: [${title}](${url})${newline}    ${quote}${newline}    <!-- research-citation:${citation.id}:${citation.start}:${citation.end} -->${newline}`
}

/** Recover citation locators only from real HTML comments inside Markdown footnotes. */
export function researchCitationMarkers(
  text: string,
): { id: string; start: number; end: number; quotedText: string }[] {
  const root = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const result: { id: string; start: number; end: number; quotedText: string }[] = []
  const visit = (nodes: readonly RootContent[], footnote?: string): void => {
    for (const node of nodes) {
      const body =
        node.type === 'footnoteDefinition'
          ? text.slice(node.position?.start.offset, node.position?.end.offset)
          : footnote
      if (node.type === 'html' && body !== undefined)
        for (const marker of node.value.matchAll(/<!-- research-citation:([\w-]+):(\d+):(\d+) -->/g)) {
          const quotedText = body
            .split(/\r?\n/)
            .slice(1)
            .filter(line => !/^\s*<!-- research-citation:[\w-]+:\d+:\d+ -->\s*$/.test(line))
            .map(line => line.replace(/^ {4}/, ''))
            .join('\n')
          result.push({ id: marker[1] ?? '', start: Number(marker[2]), end: Number(marker[3]), quotedText })
        }
      if ('children' in node) visit(node.children as RootContent[], body)
    }
  }
  visit(root.children)
  return result
}
/** Portable relative link from a note to a vault-root resource. */
export function researchRelativeLink(from: string, to: string): string {
  const base = from.split('/').slice(0, -1)
  const target = to.split('/')
  while (base.length && target.length && base[0] === target[0]) {
    base.shift()
    target.shift()
  }
  return [...base.map(() => '..'), ...target].join('/')
}
