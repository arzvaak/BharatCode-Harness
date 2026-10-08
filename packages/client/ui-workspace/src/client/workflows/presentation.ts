/** Presentation preferences only; no task or permission mutations. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspacePreset } from './layout.ts'
import type { WorkflowProfile } from '@deepseek-ai/dsh-workspace/types'

export type WorkflowView = WorkflowProfile | 'chat'
export interface WorkflowPresentationState {
  profiles: Record<string, WorkflowView>
  documents?: Record<string, { paths: string[]; active?: string | undefined }>
  editorVisibility?: Record<string, boolean>
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
      showEditor: (draft, key: string, visible: boolean) => {
        draft.editorVisibility ??= {}
        draft.editorVisibility[key] = visible
      },
      forgetDocument: (draft, session: string, path: string, active: string | undefined) => {
        const previous = draft.documents?.[session]
        if (previous !== undefined) {
          previous.paths = previous.paths.filter(value => value !== path)
          previous.active = active
        }
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
