/** Host-private recovery drafts, isolated from source-file publication. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { DocumentRecoveryDraft, SaveDocumentDraftRequest } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace'

/** Remote operations over durable editing drafts; these operations never publish workspace files. */
export class DocumentDraftController extends TypertRemoteService {
  static inject = ['documentDrafts']
  constructor(ctx: Context) {
    super(ctx, 'documentDraftController', { namespace: 'documents' })
  }
  /** Read the host-private recovery copy for this session and path.
   * @param sessionId - Draft owner.
   * @param path - Workspace path identifying the draft.
   * @returns The recovery draft, or undefined when none is saved.
   */
  @Remote
  readDraft(sessionId: SessionId, path: string): DocumentRecoveryDraft | undefined {
    return this.ctx.documentDrafts.read(sessionId, path)
  }
  /** Save the optimistic revision only after durable storage acknowledges it.
   * @param request - Draft content and expected recovery revision.
   * @returns The durable saved recovery revision.
   */
  @Remote
  saveDraft(request: SaveDocumentDraftRequest): Promise<DocumentRecoveryDraft> {
    return this.ctx.documentDrafts.save(request)
  }
  /** Remove only the expected recovery revision; a newer draft is preserved.
   * @param sessionId - Draft owner.
   * @param path - Workspace path identifying the draft.
   * @param expectedRevision - Recovery revision authorized for deletion.
   */
  @Remote
  clearDraft(sessionId: SessionId, path: string, expectedRevision: string): Promise<void> {
    return this.ctx.documentDrafts.clear(sessionId, path, expectedRevision)
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    documentDraftController: DocumentDraftController
  }
}
