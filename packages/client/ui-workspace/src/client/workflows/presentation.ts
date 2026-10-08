/** Presentation preferences only; no task or permission mutations. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { WorkflowProfile } from '@deepseek-ai/dsh-workspace/types'

export type WorkflowView = WorkflowProfile | 'chat'
export interface WorkflowPresentationState {
  profiles: Record<string, WorkflowView>
}
export function createWorkflowPresentationStore() {
  return defineStore({
    init: (): WorkflowPresentationState => ({ profiles: {} }),
    persist: 'bharatcode.workspace.presentation.v1',
    actions: {
      choose: (draft, session: string, profile: WorkflowView) => {
        draft.profiles[session] = profile
      },
    },
  })
}
