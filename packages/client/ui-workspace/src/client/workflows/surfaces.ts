/** Host-backed actions shared by independently presented workflow surfaces. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceDirectoryListing } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { ArtifactInspection, ArtifactRevision, ArtifactRevisionId, PreparedHandoff, RegisterArtifactRequest, SearchArtifactsRequest, SearchArtifactsResult, WorkflowProfile } from '@deepseek-ai/dsh-workspace/types'

/** Files and captured evidence are read through their owning remote services. */
export interface WorkspaceSurfaceActions {
  listFiles(this: void, session: SessionId, path: string): Promise<WorkspaceDirectoryListing>
  openPreview(this: void, session: SessionId, path: string): void
  openFiles?(this: void): void
  toggleFiles?(this: void): void
  toggleTerminal?(this: void): void
  openTerminal(this: void): void
  searchArtifacts(this: void, request: SearchArtifactsRequest): Promise<SearchArtifactsResult>
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
  sourceRevision?: ArtifactRevisionId | undefined
}
export type ResearchSection = 'overview' | 'sources' | 'workspace' | 'notes' | 'runs' | 'terminal' | 'evidence' | 'manuscript' | 'context' | 'history'
