/** Recovery drafts live in private host storage; they never write project files. */
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DocumentRecoveryDraft, SaveDocumentDraftRequest } from './types.ts'

const draftSchema = z.object({
  sessionId: z.string().transform(value => value as SessionId),
  path: z.string(),
  baseVersion: z.string(),
  text: z.string(),
  revision: z.string(),
  updatedAt: z.string(),
})
const draftDomain = defineDomain({
  name: 'document_drafts',
  version: 1,
  tables: { drafts: domainTable<string, DocumentRecoveryDraft>(draftSchema) },
})
const key = (session: SessionId, path: string) =>
  createHash('sha256')
    .update(JSON.stringify([session, path]))
    .digest('hex')

/** Durable host-private drafts with optimistic revision checks and serialized writes. */
export class DocumentDrafts extends Service {
  static inject = ['storageDomain']
  private drafts?: KvTable<string, DocumentRecoveryDraft>
  private tail: Promise<void> = Promise.resolve()
  constructor(ctx: Context) {
    super(ctx, 'documentDrafts')
  }
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(draftDomain)
    this.ctx.effect(() => () => domain.close(), 'document-drafts.storage')
    this.drafts = domain.table('drafts')
  }
  private table(): KvTable<string, DocumentRecoveryDraft> {
    if (this.drafts === undefined) throw new Error('Document recovery storage is unavailable.')
    return this.drafts
  }
  /** Read the recovery revision without modifying project files.
   * @param session - Draft owner.
   * @param path - Draft workspace path.
   * @returns An immutable draft copy, or undefined.
   */
  read(session: SessionId, path: string): DocumentRecoveryDraft | undefined {
    const draft = this.table().get(key(session, path))
    return draft === undefined ? undefined : Object.freeze({ ...draft })
  }
  /** Persist a draft only when its expected revision matches the current copy.
   * @param input - Recovery content and expected revision.
   * @returns A durable immutable revision after storage acknowledgement.
   */
  save(input: SaveDocumentDraftRequest): Promise<DocumentRecoveryDraft> {
    const request = { ...input }
    const operation = this.tail.then(async () => {
      if (request.path.trim() === '' || Buffer.byteLength(request.text, 'utf8') > 32 * 1024 * 1024)
        throw new Error('Document recovery path or size is invalid.')
      const previous = this.read(request.sessionId, request.path)
      if ((previous?.revision ?? null) !== request.expectedDraftRevision)
        throw new Error('A newer recovery draft exists. Reload it before replacing it.')
      const draft: DocumentRecoveryDraft = {
        sessionId: request.sessionId,
        path: request.path,
        baseVersion: request.baseVersion,
        text: request.text,
        revision: randomUUID(),
        updatedAt: new Date().toISOString(),
      }
      await this.table().put(key(request.sessionId, request.path), draft)
      return Object.freeze(draft)
    })
    this.tail = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
  /** Remove the expected recovery copy while preserving concurrent changes.
   * @param session - Draft owner.
   * @param path - Draft workspace path.
   * @param expectedRevision - Exact revision authorized for deletion.
   */
  clear(session: SessionId, path: string, expectedRevision: string): Promise<void> {
    const operation = this.tail.then(async () => {
      const current = this.read(session, path)
      if (current === undefined) return
      if (current.revision !== expectedRevision)
        throw new Error('A newer recovery draft exists. Preserve it before clearing it.')
      await this.table().delete(key(session, path))
    })
    this.tail = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    documentDrafts: DocumentDrafts
  }
}
