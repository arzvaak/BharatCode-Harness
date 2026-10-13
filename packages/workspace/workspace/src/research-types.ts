/** Portable Markdown library vocabulary. Indexing never admits content to a model. */
export interface ResearchLink {
  target: string
  label: string
  labelMarkdown?: string | undefined
  wiki: boolean
  embed: boolean
  start: number
  end: number
}
/** Authored Markdown metadata and extracted links. */
export interface ResearchMarkdown {
  title: string
  aliases: string[]
  tags: string[]
  headings: string[]
  links: ResearchLink[]
}
/** Indexed Markdown metadata with saved path, version and excerpt. */
export interface ResearchNote extends ResearchMarkdown {
  path: string
  version: string
  excerpt: string
}
/** Bounded library page with continuation and explicit issues. */
export interface ResearchList {
  notes: ResearchNote[]
  total: number
  cursor?: string | undefined
  issues: string[]
}
/** Explicit knowledge link resolution outcome. */
export type ResearchResolution =
  | { status: 'resolved'; path: string; heading?: string | undefined }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'external'; url: string }
  | { status: 'missing'; path: string }
  | { status: 'invalid' }
/** Saved note content, outgoing resolutions, backlinks and issues. */
export interface ResearchInspection {
  note: ResearchNote
  text: string
  outgoing: { link: ResearchLink; resolution: ResearchResolution }[]
  backlinks: { path: string; title: string; excerpt: string }[]
  issues: string[]
}
/** Portable vault ZIP and inclusion or omission receipts. */
export interface ResearchExport {
  filename: string
  base64: string
  files: string[]
  issues: string[]
}
/** Exact source passage with its portable citation locator. */
export interface ResearchCitation {
  id: string
  title: string
  url: string
  quote: string
  start: number
  end: number
}
