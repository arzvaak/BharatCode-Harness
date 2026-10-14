/** Mutable library membership is separate from immutable captured evidence. */
import type { ArtifactRevisionId, WorkspaceId } from './types.ts'

export type SourceStatus = 'active' | 'discovery' | 'archived' | 'removed'
export interface SourceSelection {
  readonly status: SourceStatus
  readonly reason: string
  readonly replacementId?: ArtifactRevisionId | undefined
}
export interface SourceBankItem extends SourceSelection {
  readonly id: ArtifactRevisionId
  readonly path: string
  readonly title: string
  readonly revision: string
  readonly bytes: number
  readonly revisions: number
}
export interface SourceBankRequest {
  readonly projectId: WorkspaceId
  readonly statuses?: readonly SourceStatus[] | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}
export interface SourceBankResult {
  readonly version: string
  readonly counts: Readonly<Record<SourceStatus, number>>
  readonly storedRevisions: number
  readonly activeBytes: number
  readonly items: readonly SourceBankItem[]
  readonly nextCursor?: string
}
export interface CurateSourcesRequest {
  readonly projectId: WorkspaceId
  readonly changes: readonly (SourceSelection & { readonly id: ArtifactRevisionId })[]
  readonly apply?: boolean | undefined
  readonly expectedVersion?: string | undefined
}
export interface CurateSourcesResult {
  readonly applied: boolean
  readonly version: string
  readonly changes: readonly SourceBankItem[]
}
export interface CheckSourcesRequest {
  readonly projectId: WorkspaceId
  readonly requiredIds?: readonly ArtifactRevisionId[] | undefined
  readonly requiredTexts?: readonly string[] | undefined
}
export interface CheckSourcesResult {
  readonly ok: boolean
  readonly version: string
  readonly counts: Readonly<Record<SourceStatus, number>>
  readonly storedRevisions: number
  readonly missingIds: readonly ArtifactRevisionId[]
  readonly missingTexts: readonly string[]
  readonly duplicateGroups: readonly (readonly ArtifactRevisionId[])[]
  readonly citationIssues: readonly string[]
  readonly omittedDuplicateGroups: number
  readonly omittedCitationIssues: number
}
