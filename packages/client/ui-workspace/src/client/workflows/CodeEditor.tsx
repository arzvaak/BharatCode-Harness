/** A lifecycle-owned Monaco model, with local worker assets and no CDN dependency. */
import type { LanguageDiagnostic } from '@deepseek-ai/dsh-api-workspace-controller/types'
import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/python/register.js'
import css from './documents.module.css'

export function CodeEditor({
  text,
  path,
  label,
  onChange,
  onSave,
  onSelection,
  diagnostics,
}: {
  diagnostics?: readonly LanguageDiagnostic[] | undefined
  text: string
  path: string
  label: string
  onChange: (value: string) => void
  onSave: () => void
  onSelection: (selection: { start: number; end: number; text: string }) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const instance = useRef<monaco.editor.IStandaloneCodeEditor>()
  const latest = useRef({ onChange, onSave })
  latest.current = { onChange, onSave }
  useEffect(() => {
    if (root.current === null) return
    const language = /\.tsx?$/.test(path)
      ? 'typescript'
      : /\.[cm]?jsx?$/.test(path)
        ? 'javascript'
        : /\.py$/.test(path)
          ? 'python'
          : 'plaintext'
    const model = monaco.editor.createModel(text, language)
    const palette = (): string => document.body.hasAttribute('data-ds-dark-theme') ? 'vs-dark' : 'vs'
    const editor = monaco.editor.create(root.current, {
      model,
      theme: palette(),
      automaticLayout: true,
      ariaLabel: label,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    })
    instance.current = editor
    const themeObserver = new MutationObserver(() => {
      monaco.editor.setTheme(palette())
    })
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    let external = false
    const selections = editor.onDidChangeCursorSelection((event) => {
      const range = event.selection
      if (!range.isEmpty()) {
        const start = model.getOffsetAt(range.getStartPosition())
        const end = model.getOffsetAt(range.getEndPosition())
        onSelection({ start, end, text: model.getValueInRange(range) })
      }
    })
    const changes = editor.onDidChangeModelContent(() => {
      if (!external) latest.current.onChange(editor.getValue())
    })
    const update = (value: string): void => {
      external = true
      editor.setValue(value)
      external = false
    }
    synchronizer.current = update
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      latest.current.onSave()
    })
    return () => {
      themeObserver.disconnect()
      selections.dispose()
      changes.dispose()
      editor.dispose()
      model.dispose()
      instance.current = undefined
      synchronizer.current = undefined
    }
  }, [path])
  const synchronizer = useRef<(value: string) => void>()
  useEffect(() => {
    if (instance.current?.getValue() !== text) synchronizer.current?.(text)
  }, [text])
  useEffect(() => {
    const model = instance.current?.getModel()
    if (model !== undefined && model !== null)
      monaco.editor.setModelMarkers(
        model,
        'workspace-language',
        (diagnostics ?? []).map(value => ({
          startLineNumber: value.range.start.line + 1,
          startColumn: value.range.start.character + 1,
          endLineNumber: value.range.end.line + 1,
          endColumn: value.range.end.character + 1,
          message: value.message,
          severity:
            value.severity === 1
              ? monaco.MarkerSeverity.Error
              : value.severity === 2
                ? monaco.MarkerSeverity.Warning
                : value.severity === 3
                  ? monaco.MarkerSeverity.Info
                  : monaco.MarkerSeverity.Hint,
        })),
      )
  }, [diagnostics, path])
  return <div ref={root} className={css.code} aria-label={label} />
}
