/** Host-backed actions shared by independently presented workflow surfaces. */
import type { WorkspaceApp, WorkspaceAppResource, LanguageReview } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceDirectoryListing } from '@deepseek-ai/dsh-api-workspace-files/types'
import type {
  WorkflowRecord,
  SaveWorkflowRecord,
  WorkspaceId,
  ArtifactRelation,
  LinkArtifactsRequest,
  ArtifactInspection,
  ArtifactRevision,
  ArtifactRevisionId,
  PreparedHandoff,
  RegisterArtifactRequest,
  SearchArtifactsRequest,
  SearchArtifactsResult,
  WorkflowProfile,
} from '@deepseek-ai/dsh-workspace/types'

/** Files and captured evidence are read through their owning remote services. */
export interface WorkspaceSurfaceActions {
  applications?(session: SessionId): Promise<readonly WorkspaceApp[]>
  applicationResource?(session: SessionId, server: string, tool: string): Promise<WorkspaceAppResource>
  applicationCall?(
    session: SessionId,
    server: string,
    hostTool: string,
    generation: string,
    tool: string,
    argumentsJson: string,
  ): Promise<string>
  captureChange?(session: SessionId): Promise<{ commit: string; artifact: ArtifactRevision }>
  recordVerification?(
    session: SessionId,
    change: ArtifactRevisionId,
    commit: string,
    paths: string[],
    method: 'playwright' | 'devtools' | 'manual' | 'test',
    status: 'passed' | 'failed' | 'cancelled',
    detail: string,
  ): Promise<WorkflowRecord>
  languageReview?(
    session: SessionId,
    path: string,
    text: string,
    line: number,
    character: number,
    newName?: string,
  ): Promise<LanguageReview>
  listFiles(this: void, session: SessionId, path: string): Promise<WorkspaceDirectoryListing>
  openPreview(this: void, session: SessionId, path: string): void
  openFiles?(this: void): void
  toggleFiles?(this: void): void
  toggleTerminal?(this: void): void
  openTerminal(this: void): void
  openProject?(this: void, profile: WorkflowProfile): void
  searchArtifacts(this: void, request: SearchArtifactsRequest): Promise<SearchArtifactsResult>
  cancelNotebook?(this: void, session: SessionId, jobId: string): Promise<void>
  executeNotebook?(this: void, project: WorkspaceId, id: string, session: SessionId): Promise<string>
  workflowRecords?(this: void, project: WorkspaceId): Promise<readonly WorkflowRecord[]>
  saveWorkflowRecord?(this: void, request: SaveWorkflowRecord): Promise<WorkflowRecord>
  linkArtifacts?(this: void, request: LinkArtifactsRequest): Promise<ArtifactRelation>
  relatedArtifacts?(this: void, id: ArtifactRevisionId): Promise<readonly ArtifactRelation[]>
  readArtifact(this: void, id: ArtifactRevisionId): Promise<ArtifactRevision>
  registerArtifact(this: void, request: RegisterArtifactRequest): Promise<ArtifactRevision>
  inspectArtifact(this: void, id: ArtifactRevisionId): Promise<ArtifactInspection>
  requestEvidenceHandoff(this: void, session: SessionId, artifact: ArtifactRevision, workflow: WorkflowProfile): void
  openSession(this: void, session: SessionId): void
  readContext?(this: void, session: SessionId): Promise<readonly PreparedHandoff[]>
}
/** View density and selected research area; these do not change a running task. */
export interface ResearchPreference {
  complexity: 'full' | 'simple'
  section: ResearchSection
  sourcePassage?: { start: number; end: number; quote: string } | undefined
  sourceRevision?: ArtifactRevisionId | undefined
}
/** Selectable research workspace areas. */
export type ResearchSection =
  | 'overview'
  | 'sources'
  | 'workspace'
  | 'notes'
  | 'runs'
  | 'terminal'
  | 'evidence'
  | 'manuscript'
  | 'context'
  | 'history'
