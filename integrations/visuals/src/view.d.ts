import type { ComponentType } from 'react'
/** The native renderer keeps ownership of the answer and its component props. */
export declare function makeAssistantWrapper<Props extends {
  node: { data: { status: string; blocks: readonly { kind: string; text?: string }[] } }
}>(Native: ComponentType<Props>, useTranslate?: () => (key: string) => string): ComponentType<Props>
