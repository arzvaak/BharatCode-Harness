/** Bounded local Markdown discovery and portable vault export. No index writes authored files. */
import { constants } from 'node:fs'
import { open, lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { parseResearchMarkdown, researchPath, resolveResearchLink } from './research-markdown.ts'
import type { ResearchInspection, ResearchList, ResearchNote } from './research-types.ts'

export interface ResearchLimits {
  maxFiles: number
  maxFileBytes: number
  maxTextBytes: number
  pageSize: number
  maxExportBytes: number
  maxResourceBytes: number
}
const defaults: ResearchLimits = {
  maxFiles: 10_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxTextBytes: 64 * 1024 * 1024,
  pageSize: 200,
  maxExportBytes: 64 * 1024 * 1024,
  maxResourceBytes: 16 * 1024 * 1024,
}
const ignored = new Set(['node_modules', 'vendor', 'dist', 'lib', '__pycache__', 'target', '.git', '.obsidian'])
const visible = (path: string): boolean => path.split('/').every(part => !part.startsWith('.') && !ignored.has(part))
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
/** Stateless projection: every scan sees external disk edits; clients own stale-result guards. */
export class ResearchLibrary {
  private readonly limits: ResearchLimits
  constructor(
    private readonly root: string,
    limits: Partial<ResearchLimits> = {},
  ) {
    this.limits = { ...defaults, ...limits }
  }
  /** Canonical root containment; symlinks are never resources in a portable vault. */
  async safePath(selected: string): Promise<string> {
    const path = researchPath(selected)
    if (path === undefined || !visible(path)) throw new Error('Research path is outside the project or private')
    const root = await realpath(this.root)
    let current = root
    for (const part of path.split('/')) {
      current = resolve(current, part)
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error('Research paths must not traverse symlinks')
    }
    const canonical = await realpath(current)
    const rel = relative(root, canonical)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
      throw new Error('Research path is outside the project')
    return canonical
  }
  /** Read a complete bounded file through a stable, non-symlink handle. */
  async readBytes(selected: string, maxBytes = this.limits.maxFileBytes): Promise<Uint8Array> {
    const path = await this.safePath(selected)
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = await file.stat()
      if (!before.isFile() || before.size > maxBytes)
        throw new Error('Research file is not a file or exceeds byte limit')
      const data = await file.readFile()
      const after = await file.stat()
      const current = await lstat(await this.safePath(selected))
      if (
        data.byteLength > maxBytes ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        current.ino !== after.ino ||
        current.dev !== after.dev
      )
        throw new Error('Research file changed during read; retry')
      return data
    } finally {
      await file.close()
    }
  }
  /** Read complete valid UTF-8; no silently replaced or truncated characters. */
  async readText(path: string): Promise<string> {
    return new TextDecoder('utf-8', { fatal: true }).decode(await this.readBytes(path))
  }
  private async scan(): Promise<{ notes: ResearchNote[]; texts: Map<string, string>; issues: string[] }> {
    const notes: ResearchNote[] = []
    const texts = new Map<string, string>()
    const issues: string[] = []
    const queue = ['']
    let totalBytes = 0
    let visited = 0
    let candidates = 0
    while (queue.length) {
      const directory = queue.shift() ?? ''
      let children
      try {
        children = await readdir(directory === '' ? await realpath(this.root) : await this.safePath(directory), {
          withFileTypes: true,
        })
      } catch (error) {
        issues.push(`${directory || '.'}: ${message(error)}`)
        continue
      }
      for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = directory ? `${directory}/${entry.name}` : entry.name
        if (!visible(path)) continue
        if (++visited > this.limits.maxFiles * 3) {
          issues.push('Research discovery entry limit reached')
          queue.length = 0
          break
        }
        if (entry.isSymbolicLink()) {
          issues.push(`${path}: symlink excluded`)
          continue
        }
        if (entry.isDirectory()) {
          queue.push(path)
          continue
        }
        if (!/\.(md|markdown)$/i.test(path) || !entry.isFile()) continue
        if (++candidates > this.limits.maxFiles) {
          issues.push('Research note limit reached')
          queue.length = 0
          break
        }
        try {
          const bytes = await this.readBytes(path)
          totalBytes += bytes.byteLength
          if (totalBytes > this.limits.maxTextBytes) {
            issues.push('Research total text byte limit reached')
            queue.length = 0
            break
          }
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          const parsed = parseResearchMarkdown(text)
          notes.push({
            ...parsed,
            title: parsed.title || entry.name.replace(/\.(md|markdown)$/i, ''),
            path,
            version: createHash('sha256').update(bytes).digest('hex'),
            excerpt: text.slice(0, 240),
          })
          texts.set(path, text)
        } catch (error) {
          issues.push(`${path}: ${message(error)}`)
        }
      }
    }
    return { notes: notes.sort((a, b) => a.path.localeCompare(b.path)), texts, issues }
  }
  /** Deterministic bounded page. Cursor is the last returned path, not an unstable array offset. */
  async list(query = '', cursor?: string): Promise<ResearchList> {
    if (query.length > 2000 || (cursor?.length ?? 0) > 4096) throw new Error('Research search exceeds input limit')
    const scan = await this.scan()
    const wanted = query.trim().toLocaleLowerCase()
    const matches = scan.notes.filter(
      note =>
        !wanted ||
        [note.title, note.path, ...note.aliases, ...note.tags, scan.texts.get(note.path) ?? ''].some(text =>
          text.toLocaleLowerCase().includes(wanted),
        ),
    )
    const rest = matches.filter(note => cursor === undefined || note.path.localeCompare(cursor) > 0)
    const notes = rest.slice(0, this.limits.pageSize)
    return {
      notes,
      total: matches.length,
      cursor: rest.length > notes.length ? notes.at(-1)?.path : undefined,
      issues: scan.issues,
    }
  }
  /** Inspect links and backlinks against the entire bounded scan, not a UI search page. */
  async inspect(path: string): Promise<ResearchInspection> {
    const normalized = researchPath(path)
    const scan = await this.scan()
    const note = scan.notes.find(note => note.path === normalized)
    if (note === undefined) throw new Error('Research note is missing or not indexed')
    const text = scan.texts.get(note.path)
    if (text === undefined) throw new Error('Indexed research text is unavailable; refresh')
    return {
      note,
      text,
      outgoing: note.links.map(link => ({ link, resolution: resolveResearchLink(scan.notes, note.path, link) })),
      backlinks: scan.notes
        .filter(other =>
          other.links.some((link) => {
            const result = resolveResearchLink(scan.notes, other.path, link)
            return result.status === 'resolved' && result.path === note.path
          }),
        )
        .map(other => ({ path: other.path, title: other.title, excerpt: other.excerpt })),
      issues: scan.issues,
    }
  }
  /** Resolve against all indexed notes, independently of the current search page. */
  async resolveLink(
    from: string,
    target: string,
    wiki: boolean,
  ): Promise<import('./research-types.ts').ResearchResolution> {
    const normalized = researchPath(from)
    if (normalized === undefined) throw new Error('Invalid research origin')
    const scan = await this.scan()
    const result = resolveResearchLink(scan.notes, normalized, { target, wiki })
    if ((result.status === 'resolved' || result.status === 'missing') && !visible(result.path))
      return { status: 'invalid' }
    return result
  }
  /** Explicit exclusive creation. Existing notes and vault metadata are never overwritten. */
  async create(selected: string, title: string): Promise<{ path: string }> {
    const path = researchPath(selected)
    if (
      path === undefined ||
      !visible(path) ||
      !/\.(md|markdown)$/i.test(path) ||
      path
        .split('/')
        .some(
          part =>
            /[<>:"|?*\x00-\x1f]/.test(part) ||
            /[. ]$/.test(part) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        )
    )
      throw new Error('Choose a portable Markdown path inside the project')
    if (!title.trim() || title.length > 500 || /[\r\n]/.test(title)) throw new Error('Choose a single-line note title')
    const root = await realpath(this.root)
    let parent = root
    for (const part of path.split('/').slice(0, -1)) {
      parent = resolve(parent, part)
      try {
        await mkdir(parent)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      if ((await lstat(parent)).isSymbolicLink()) throw new Error('Research paths must not traverse symlinks')
      if ((await realpath(parent)) !== parent) throw new Error('Research parent changed; retry')
    }
    const destination = resolve(root, path)
    const file = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await file.writeFile(`# ${title.trim()}\n\n`)
      await file.sync()
    } finally {
      await file.close()
    }
    return { path }
  }
  /** Bundle canonical Markdown plus referenced attachments, notebooks and captured source copies. */
  async exportVault(
    extraFiles: readonly { path: string; text: string }[],
  ): Promise<{ bytes: Uint8Array; files: string[]; issues: string[] }> {
    const scan = await this.scan()
    const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
    const issues = [...scan.issues]
    let bytes = 0
    const add = (path: string, data: Uint8Array): boolean => {
      if (Object.hasOwn(files, path)) {
        issues.push(`${path}: export path collision`)
        return false
      }
      if (bytes + data.byteLength > this.limits.maxExportBytes) {
        issues.push(`${path}: export byte limit reached`)
        return false
      }
      files[path] = data
      bytes += data.byteLength
      return true
    }
    for (const [path, text] of scan.texts) add(path, strToU8(text))
    for (const file of extraFiles) {
      if (researchPath(file.path) !== file.path || !visible(file.path)) throw new Error('Invalid export source path')
      add(file.path, strToU8(file.text))
    }
    const resources = new Set<string>()
    for (const note of scan.notes)
      for (const link of note.links) {
        const result = resolveResearchLink(scan.notes, note.path, link)
        if (result.status === 'missing') resources.add(result.path)
        if (result.status === 'ambiguous' || result.status === 'invalid')
          issues.push(`${note.path}: unresolved link ${link.target}`)
      }
    for (const path of resources) {
      if (Object.hasOwn(files, path)) continue
      try {
        add(path, await this.readBytes(path, this.limits.maxResourceBytes))
      } catch (error) {
        issues.push(`${path}: ${message(error)}`)
      }
    }
    const manifestPath = 'BharatCode-export.txt'
    if (!Object.hasOwn(files, manifestPath))
      files[manifestPath] = strToU8(
        `Open this folder as an Obsidian vault. Markdown and attachments are ordinary files.\nExported at ${new Date().toISOString()}\n${issues.length ? 'Omissions and warnings:\n' + issues.join('\n') : 'All indexed notes and referenced resources were exported.'}\n`,
      )
    return { bytes: zipSync(files, { level: 6 }), files: Object.keys(files), issues }
  }
}
