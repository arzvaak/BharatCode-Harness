/** Presentation preferences only; no task or permission mutations. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { ResearchPreference } from './surfaces.ts'
import type { WorkspacePreset } from './layout.ts'
import type { WorkflowProfile } from '@deepseek-ai/dsh-workspace/types'

export type WorkflowView = WorkflowProfile | 'chat'
export interface WorkflowPresentationState {
  research?: Record<string, ResearchPreference>
  researchChat?: Record<string, boolean>
  profiles: Record<string, WorkflowView>
  documents?: Record<string, { paths: string[]; active?: string | undefined }>
  surfaceVisibility?: Record<string, boolean>
  editorVisibility?: Record<string, boolean>
  layouts?: Record<string, { preset: WorkspacePreset; swapped: boolean }>
}
export function createWorkflowPresentationStore() {
  return defineStore({
    init: (): WorkflowPresentationState => ({ profiles: {} }),
    persist: 'bharatcode.workspace.presentation.v1',
    actions: {
      researchView: (draft, key: string, change: Partial<ResearchPreference>) => {
        draft.research ??= {}
        draft.research[key] = { complexity: 'full', section: 'overview', ...draft.research[key], ...change }
      },
      showResearchChat: (draft, key: string, visible: boolean) => {
        draft.researchChat ??= {}
        draft.researchChat[key] = visible
      },
      rememberDocument: (draft, session: string, path: string) => {
        draft.documents ??= {}
        const previous = draft.documents[session]
        draft.documents[session] = { paths: [...new Set([...previous?.paths ?? [], path])], active: path }
      },
      showEditor: (draft, key: string, visible: boolean) => {
        draft.surfaceVisibility ??= {}
        draft.surfaceVisibility[key] = visible
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
