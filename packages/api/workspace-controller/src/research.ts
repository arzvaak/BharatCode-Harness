/** Research operations share immutable evidence storage and never replace editor publication. */
import type { Context } from '@deepseek-ai/cordis'
import { ResearchLibrary } from '@deepseek-ai/dsh-workspace'
import { researchCitationMarkers, prepareResearchCitation, researchRelativeLink, researchPath } from '@deepseek-ai/dsh-workspace/research-markdown'
import type {
  ArtifactRevision,
  ArtifactRevisionId,
  ResearchExport,
  ResearchInspection,
  ResearchList,
  WorkspaceId,
} from '@deepseek-ai/dsh-workspace/types'

/** Project-scoped operations used by UI remotes and model tools. */
export class ResearchOperations {
  constructor(private readonly ctx: Context) {}
  private library(projectId: WorkspaceId): ResearchLibrary {
    const project = this.ctx.workspaceRegistry.get(projectId)
    if (project === undefined) throw new Error('Unknown research project')
    return new ResearchLibrary(project.path)
  }
  /** Browse a bounded Markdown page without capturing it into model context. */
  async list(projectId: WorkspaceId, query = '', cursor?: string): Promise<ResearchList> {
    return this.library(projectId).list(query, cursor)
  }
  /** Read one complete indexed note and resolved backlinks. */
  async inspect(projectId: WorkspaceId, path: string): Promise<ResearchInspection> {
    return this.library(projectId).inspect(path)
  }
  /** Resolve a link against the complete bounded index. */
  resolveLink(
    projectId: WorkspaceId,
    from: string,
    target: string,
    wiki: boolean,
  ): Promise<import('@deepseek-ai/dsh-workspace/types').ResearchResolution> {
    return this.library(projectId).resolveLink(from, target, wiki)
  }
  /** Read only bounded, contained image resources; never return arbitrary project files. */
  async resource(projectId: WorkspaceId, path: string): Promise<{ base64: string; mime: string }> {
    const extension = path.split('.').at(-1)?.toLowerCase()
    const types: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    }
    const mime = extension === undefined ? undefined : types[extension]
    if (mime === undefined) throw new Error('This resource is not a supported inline figure')
    const bytes = await this.library(projectId).readBytes(path, 8 * 1024 * 1024)
    return { base64: Buffer.from(bytes).toString('base64'), mime }
  }
  /** Create an exclusive file and report capture failure separately from creation. */
  async create(projectId: WorkspaceId, path: string, title: string): Promise<{ path: string; issues: string[] }> {
    const created = await this.library(projectId).create(path, title)
    const issues: string[] = []
    try {
      await this.ctx.projectKnowledge.register({ projectId, path: created.path, kind: 'note', title })
    } catch (error) {
      issues.push(
        `Note created; evidence capture incomplete: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return { ...created, issues }
  }
  /** Persist complete new knowledge and exact citation evidence without replacing existing notes. */
  async store(projectId: WorkspaceId, path: string, title: string, text: string,
    citations: readonly { sourceId: ArtifactRevisionId; start: number; end: number }[] = []) {
    if (!text.trim()) throw new Error('Provide nonempty knowledge content')
    const canonicalPath = researchPath(path)
    if (canonicalPath === undefined) throw new Error('Choose a portable Markdown path inside the project')
    let content = text
    for (const citation of citations) {
      const source = this.ctx.projectKnowledge.read(citation.sourceId)
      if (source.projectId !== projectId) throw new Error('Citation source belongs to another project')
      if (!Number.isSafeInteger(citation.start) || !Number.isSafeInteger(citation.end) ||
        citation.start < 0 || citation.end <= citation.start || citation.end > source.text.length)
        throw new Error('Choose a passage within the captured source')
      content = prepareResearchCitation(content, {
        id: source.id, title: source.title,
        url: researchRelativeLink(canonicalPath, `sources/captured/${source.id}.md`),
        start: citation.start, end: citation.end, quote: source.text.slice(citation.start, citation.end),
      })
    }
    const created = await this.library(projectId).create(canonicalPath, title, content)
    try {
      const captured = await this.captureCitations(projectId, created.path, content)
      const inspected = await this.inspect(projectId, created.path)
      if (inspected.text !== content) throw new Error('Note changed during read back; inspect its current version')
      return { ...created, version: inspected.note.version, artifactId: captured.artifact.id,
        linked: captured.linked, issues: captured.issues }
    } catch (error) {
      return { ...created, linked: 0, issues: [
        `Note saved; evidence capture or read back incomplete: ${error instanceof Error ? error.message : String(error)}`,
      ] }
    }
  }
  /** Propose a portable citation against the exact saved note; never publish an AI edit. */
  async prepareCitation(projectId: WorkspaceId, path: string, expectedText: string,
    sourceId: ArtifactRevisionId, start: number, end: number): Promise<{ path: string; proposedText: string }> {
    const canonicalPath = researchPath(path)
    if (canonicalPath === undefined) throw new Error('Choose a portable Markdown path inside the project')
    const current = await this.library(projectId).readText(canonicalPath)
    if (current !== expectedText) throw new Error('Note changed; read its current version before proposing a citation')
    const source = this.ctx.projectKnowledge.read(sourceId)
    if (source.projectId !== projectId) throw new Error('Citation source belongs to another project')
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > source.text.length)
      throw new Error('Choose a passage within the captured source')
    const proposedText = prepareResearchCitation(current, {
      id: source.id, title: source.title,
      url: researchRelativeLink(canonicalPath, `sources/captured/${source.id}.md`),
      start, end, quote: source.text.slice(start, end),
    })
    return { path: canonicalPath, proposedText }
  }
  /** Capture saved text and validate portable citation markers against exact immutable sources. */
  async captureCitations(
    projectId: WorkspaceId,
    path: string,
    expectedText: string,
  ): Promise<{ artifact: ArtifactRevision; linked: number; issues: string[] }> {
    const library = this.library(projectId)
    const text = await library.readText(path)
    if (text !== expectedText)
      throw new Error('Note changed or was not saved; save/review the current version before capturing citations')
    const artifact = await this.ctx.projectKnowledge.register({ projectId, path, kind: 'note' })
    if (artifact.text !== expectedText) throw new Error('Note changed during evidence capture; retry')
    const issues: string[] = []
    let linked = 0
    for (const marker of researchCitationMarkers(text)) {
      try {
        const source = this.ctx.projectKnowledge.read(marker.id as ArtifactRevisionId)
        if (source.projectId !== projectId) throw new Error('Citation source belongs to another project')
        const quote = source.text.slice(marker.start, marker.end)
        if (
          !Number.isSafeInteger(marker.start) ||
          !Number.isSafeInteger(marker.end) ||
          marker.start < 0 ||
          marker.end <= marker.start ||
          marker.end > source.text.length ||
          marker.quotedText !== quote.replace(/\r\n/g, '\n')
        )
          throw new Error('Citation quote does not match the selected source passage')
        await this.ctx.projectKnowledge.link({
          projectId,
          from: artifact.id,
          to: source.id,
          relation: 'cites',
          passage: { start: marker.start, end: marker.end, quote },
        })
        ++linked
      } catch (error) {
        issues.push(
          `${marker.id}: citation evidence incomplete: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return { artifact, linked, issues }
  }
  /** Export ordinary files plus exact source revisions referenced by portable citations. */
  async export(projectId: WorkspaceId): Promise<ResearchExport> {
    const library = this.library(projectId)
    const captured = new Map<string, string>()
    const issues: string[] = []
    let cursor: string | undefined
    do {
      const page = await library.list('', cursor)
      for (const note of page.notes) {
        try {
          for (const marker of researchCitationMarkers(await library.readText(note.path))) {
            try {
              const source = this.ctx.projectKnowledge.read(marker.id as ArtifactRevisionId)
              if (source.projectId !== projectId) throw new Error('Citation source belongs to another project')
              captured.set(`sources/captured/${source.id}.md`, source.text)
            } catch (error) {
              issues.push(`${note.path}/${marker.id}: ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        } catch (error) {
          issues.push(`${note.path}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      cursor = page.cursor
    } while (cursor !== undefined)
    const result = await library.exportVault([...captured].map(([path, text]) => ({ path, text })))
    return {
      filename: 'research-vault.zip',
      base64: Buffer.from(result.bytes).toString('base64'),
      files: result.files,
      issues: [...issues, ...result.issues],
    }
  }
}
