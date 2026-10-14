/** Mutable library membership is separate from immutable captured evidence. */
import type { ArtifactRevisionId, WorkspaceId } from './types.ts'

/** Membership of a retained source identity in the research library. */
export type SourceStatus = 'active' | 'discovery' | 'archived' | 'removed'
/** Reversible selection decision with its human-readable reason and canonical replacement. */
export interface SourceSelection {
  readonly status: SourceStatus
  readonly reason: string
  readonly replacementId?: ArtifactRevisionId | undefined
}
/** Latest source metadata and selection state, excluding captured body text. */
export interface SourceBankItem extends SourceSelection {
  readonly id: ArtifactRevisionId
  readonly path: string
  readonly title: string
  readonly revision: string
  readonly bytes: number
  readonly revisions: number
}
/** Project-owned source inventory filters and versioned pagination. */
export interface SourceBankRequest {
  readonly projectId: WorkspaceId
  readonly statuses?: readonly SourceStatus[] | undefined
  readonly limit?: number | undefined
  readonly cursor?: string | undefined
}
/** Full-bank totals plus one bounded metadata page. */
export interface SourceBankResult {
  readonly version: string
  readonly counts: Readonly<Record<SourceStatus, number>>
  readonly storedRevisions: number
  readonly activeBytes: number
  readonly items: readonly SourceBankItem[]
  readonly nextCursor?: string
}
/** Bulk selection changes; applying requires the preview's bank version. */
export interface CurateSourcesRequest {
  readonly projectId: WorkspaceId
  readonly changes: readonly (SourceSelection & { readonly id: ArtifactRevisionId })[]
  readonly apply?: boolean | undefined
  readonly expectedVersion?: string | undefined
}
/** Validated preview or durable curation commit receipt. */
export interface CurateSourcesResult {
  readonly applied: boolean
  readonly version: string
  readonly changes: readonly SourceBankItem[]
}
/** Required retained identities and literal evidence passages for a project. */
export interface CheckSourcesRequest {
  readonly projectId: WorkspaceId
  readonly requiredIds?: readonly ArtifactRevisionId[] | undefined
  readonly requiredTexts?: readonly string[] | undefined
}
/** Full-bank coverage and citation checks with bounded diagnostic groups. */
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
