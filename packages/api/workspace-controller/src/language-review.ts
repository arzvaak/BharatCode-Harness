/** Browser-safe language review vocabulary. Providers return proposals, never write files. */
export interface LanguageDiagnostic {
  severity: number
  message: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  source?: string
  code?: string | number
}
/**
 * Diagnostics and proposed file edits bound to the reviewed source revision.
 */
export interface LanguageReview {
  path: string
  base: string
  diagnostics: readonly LanguageDiagnostic[]
  proposals: readonly { title: string; files: readonly { path: string; before: string; after: string }[] }[]
}
/**
 * Optional language-server provider that returns edit previews without writing files.
 */
export interface WorkspaceLanguageProvider {
  review(
    request: { root: string; path: string; text: string; position: { line: number; character: number }; newName?: string },
    signal?: AbortSignal,
  ): Promise<LanguageReview>
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceLanguage: WorkspaceLanguageProvider
  }
}
