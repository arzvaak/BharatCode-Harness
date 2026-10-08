/** Presentation preferences only; no task or permission mutations. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspacePreset } from './layout.ts'
import type { WorkflowProfile } from '@deepseek-ai/dsh-workspace/types'

export type WorkflowView = WorkflowProfile | 'chat'
export interface WorkflowPresentationState {
  profiles: Record<string, WorkflowView>
  documents?: Record<string, { paths: string[]; active: string }>
  layouts?: Record<string, { preset: WorkspacePreset; swapped: boolean }>
}
export function createWorkflowPresentationStore() {
  return defineStore({
    init: (): WorkflowPresentationState => ({ profiles: {} }),
    persist: 'bharatcode.workspace.presentation.v1',
    actions: {
      rememberDocument: (draft, session: string, path: string) => {
        draft.documents ??= {}
        const previous = draft.documents[session]
        draft.documents[session] = { paths: [...new Set([...previous?.paths ?? [], path])], active: path }
      },
      arrange: (draft, key: string, preset: WorkspacePreset, swapped: boolean) => {
        draft.layouts ??= {}
        draft.layouts[key] = { preset, swapped }
      },
      choose: (draft, session: string, profile: WorkflowView) => {
        draft.profiles[session] = profile
      },
    },
  })
}
