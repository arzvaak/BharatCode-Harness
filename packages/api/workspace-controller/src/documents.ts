/** Host-private recovery drafts, isolated from source-file publication. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { DocumentRecoveryDraft, SaveDocumentDraftRequest } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace'

export class DocumentDraftController extends TypertRemoteService {
  static inject = ['documentDrafts']
  constructor(ctx: Context) {
    super(ctx, 'documentDraftController', { namespace: 'documents' })
  }
  @Remote
  readDraft(sessionId: SessionId, path: string): DocumentRecoveryDraft | undefined {
    return this.ctx.documentDrafts.read(sessionId, path)
  }
  @Remote
  saveDraft(request: SaveDocumentDraftRequest): Promise<DocumentRecoveryDraft> {
    return this.ctx.documentDrafts.save(request)
  }
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
