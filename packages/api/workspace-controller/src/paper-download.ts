/** Retain original complete paper PDFs and captured text without generated helper scripts. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-web'
import type { ArtifactRevisionId, WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { constants } from 'node:fs'
import { mkdir, open, realpath, lstat, link, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import { extractDocument, type DocumentExtractionReceipt } from './document-extract.ts'

/** Publication identity and optional page/OCR policy for retaining its original PDF. */
export interface PaperDownloadInput {
  url?: string | undefined
  arxivId?: string | undefined
  title?: string | undefined
  extract: boolean
  firstPage: number
  maxPages: number
  ocr: boolean
  ocrLanguage: string
}

/** Original PDF retention receipt, with either extracted evidence or explicit incomplete coverage. */
export type PaperDownloadReceipt = {
  url: string
  path: string
  sha256: string
  bytes: number
  downloaded: boolean
} & ({
  extracted: false
  coverage: string
  issues?: string[]
} | {
  extracted: true
  sourceId: ArtifactRevisionId
  revision: string
  method: string
  segments: number
  omissions: string[]
  ocrPages: DocumentExtractionReceipt['ocrPages']
  coverage: string
})

/** Per-publication successes and failures from a deduplicated bulk PDF request. */
export interface PaperDownloadBatchReceipt {
  receipts: (PaperDownloadReceipt | { identity: string; downloaded: false; error: string })[]
  complete: boolean
}

/** Save an immutable content-addressed original; existing files must match its digest. */
async function savePdf(root: string, bytes: Uint8Array, sha256: string): Promise<string> {
  const canonicalRoot = await realpath(root)
  const directory = join(canonicalRoot, 'sources', 'papers')
  for (const directoryPath of [join(canonicalRoot, 'sources'), directory]) {
    await mkdir(directoryPath, { recursive: true })
    const info = await lstat(directoryPath)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Paper storage directory must not be a symlink')
  }
  const canonical = await realpath(directory)
  const path = relative(canonicalRoot, canonical)
  if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new Error('Paper directory is outside the project')
  const target = join(directory, `${sha256}.pdf`)
  const temporary = join(directory, `.paper-${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    // Publish only a completely written file, without replacing an existing original.
    await link(temporary, target)
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error
    const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await existing.stat()
      if (!stat.isFile() || stat.size !== bytes.byteLength) throw new Error('Existing paper path does not match the download')
      const actual = createHash('sha256').update(await existing.readFile()).digest('hex')
      if (actual !== sha256) throw new Error('Existing paper digest does not match the download')
    } finally { await existing.close() }
  } finally { await handle?.close(); await rm(temporary, { force: true }) }
  if (await realpath(directory) !== canonical) throw new Error('Paper directory changed during download')
  return relative(canonicalRoot, target)
}

/**
 * Download PDF originals from an arXiv identity or public PDF URL, optionally extracting full text.
 * @param ctx - Host context providing the web provider, workspace and source storage.
 * @param projectId - Project that will own the retained content-addressed original.
 * @param input - Publication identity and extraction/OCR settings.
 * @param signal - Cancellation signal shared by retrieval and extraction.
 * @returns The original PDF receipt and successful or incomplete extraction coverage.
 */
export async function downloadPaper(ctx: Context, projectId: WorkspaceId,
  input: PaperDownloadInput, signal: AbortSignal): Promise<PaperDownloadReceipt> {
  const project = ctx.workspaceRegistry.get(projectId)
  if (project === undefined) throw new Error('Unknown project')
  if ((input.url === undefined) === (input.arxivId === undefined)) throw new Error('Supply exactly one of url or arxivId')
  if (input.arxivId !== undefined && !/^(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?$/iu.test(input.arxivId))
    throw new Error('Invalid arXiv paper identity')
  const url = input.url ?? `https://arxiv.org/pdf/${input.arxivId}`
  const web = ctx.get('web')
  if (web === undefined) throw new Error('Paper downloads need a configured web provider')
  const result = await web.fetchDocument({ url }, signal)
  signal.throwIfAborted()
  if (result.statusCode !== 200 || result.contentRange !== undefined || result.bytes.byteLength > 32 * 1024 * 1024
    || !new TextDecoder('ascii').decode(result.bytes.subarray(0, 1024)).includes('%PDF-'))
    throw new Error('Provider did not return a complete supported PDF')
  const sha256 = createHash('sha256').update(result.bytes).digest('hex')
  const path = await savePdf(project.path, result.bytes, sha256)
  const retained = { url: result.url, path, sha256, bytes: result.bytes.byteLength, downloaded: true }
  if (!input.extract) return { ...retained, extracted: false, coverage: 'Original PDF retained; text extraction was not requested' }
  try {
    const receipt = await extractDocument(ctx, projectId, path, signal, input.firstPage, input.maxPages,
      { ocr: input.ocr, ocrLanguage: input.ocrLanguage, sourceUrl: result.url,
        title: input.title ?? (input.arxivId === undefined ? result.url : `arXiv full paper ${input.arxivId}`) })
    return { ...retained, extracted: true, sourceId: receipt.id, revision: receipt.revision,
      method: receipt.method, segments: receipt.segments, omissions: receipt.omissions,
      ocrPages: receipt.ocrPages, coverage: 'Original PDF and page-labelled extracted text retained' }
  } catch (error) {
    signal.throwIfAborted()
    return { ...retained, extracted: false, coverage: 'Original PDF retained; text extraction is incomplete',
      issues: [error instanceof Error ? error.message : String(error)] }
  }
}

/**
 * Bulk paper retrieval retains successes and reports original/text coverage per paper.
 * @param ctx - Host context providing retrieval and project storage services.
 * @param projectId - Owning project for every retained paper.
 * @param papers - Publication requests, deduplicated by their supplied identity.
 * @param signal - Cancellation signal for the complete sequential retrieval batch.
 * @returns Per-paper receipts and whether every paper has retained extracted text.
 */
export async function downloadPapers(ctx: Context, projectId: WorkspaceId,
  papers: readonly PaperDownloadInput[], signal: AbortSignal): Promise<PaperDownloadBatchReceipt> {
  const receipts: PaperDownloadBatchReceipt['receipts'] = []
  const seen = new Set<string>()
  for (const paper of papers) {
    signal.throwIfAborted()
    const identity = paper.url ?? paper.arxivId ?? ''
    if (seen.has(identity)) continue
    seen.add(identity)
    try { receipts.push(await downloadPaper(ctx, projectId, paper, signal)) }
    catch (error) {
      signal.throwIfAborted()
      receipts.push({ identity, downloaded: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { receipts, complete: receipts.every(receipt => receipt.downloaded && ('extracted' in receipt && receipt.extracted)) }
}
