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
export interface ResearchMarkdown {
  title: string
  aliases: string[]
  tags: string[]
  headings: string[]
  links: ResearchLink[]
}
export interface ResearchNote extends ResearchMarkdown {
  path: string
  version: string
  excerpt: string
}
export interface ResearchList {
  notes: ResearchNote[]
  total: number
  cursor?: string | undefined
  issues: string[]
}
export type ResearchResolution =
  | { status: 'resolved'; path: string; heading?: string | undefined }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'external'; url: string }
  | { status: 'missing'; path: string }
  | { status: 'invalid' }
export interface ResearchInspection {
  note: ResearchNote
  text: string
  outgoing: { link: ResearchLink; resolution: ResearchResolution }[]
  backlinks: { path: string; title: string; excerpt: string }[]
  issues: string[]
}
export interface ResearchExport {
  filename: string
  base64: string
  files: string[]
  issues: string[]
}
export interface ResearchCitation {
  id: string
  title: string
  url: string
  quote: string
  start: number
  end: number
}
