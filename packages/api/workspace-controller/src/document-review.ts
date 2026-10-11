/** Immutable saved-source annotations; draft text is never silently published. */
import type { ArtifactRevision, ArtifactRelation, WorkflowRecord } from '@deepseek-ai/dsh-workspace/types'
export interface DocumentEvidence {
  artifact?: ArtifactRevision
  comments: readonly WorkflowRecord[]
  sources: readonly {
    relation: ArtifactRelation
    artifact: ArtifactRevision
    status: 'current' | 'stale' | 'missing' | 'captured'
  }[]
}
