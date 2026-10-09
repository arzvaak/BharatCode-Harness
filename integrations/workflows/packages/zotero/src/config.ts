import Schema from '@deepseek-ai/schemastery'

/** All tunables live here — no magic constants in the tool bodies. */
export interface Config {
  /** Zotero desktop HTTP host. */
  host: string
  /** Zotero local server port (the connector port; default 23119). */
  port: number
  /** Local API library ID; `0` is the current local user library. */
  libraryId: string
  /** HTTP request timeout in milliseconds. */
  timeoutMs: number
  /** Default page size for list tools. */
  defaultLimit: number
  /** Maximum page size per call. */
  maxLimit: number
  /** Abstract preview characters in search results (0 disables previews). */
  abstractPreviewChars: number
  /** Maximum collection/tag rows fetched across pages. */
  listCap: number
}

export const Config: Schema<Config> = Schema.object({
  host: Schema.string().default('127.0.0.1').description('Zotero desktop HTTP host'),
  port: Schema.number().min(1).max(65535).default(23119).description('Zotero local server port (default 23119)'),
  libraryId: Schema.string().default('0').description("Local API library ID; '0' is the current local user library"),
  timeoutMs: Schema.number().min(1000).max(120000).default(15000).description('Request timeout in milliseconds'),
  defaultLimit: Schema.number().min(1).max(100).default(25).description('Default list page size'),
  maxLimit: Schema.number().min(1).max(500).default(100).description('Maximum page size per call'),
  abstractPreviewChars: Schema.number().min(0).max(5000).default(300).description('Abstract preview length (0 disables previews)'),
  listCap: Schema.number().min(100).max(5000).default(1000).description('Maximum collection/tag rows'),
}).description('Zotero plugin settings')
