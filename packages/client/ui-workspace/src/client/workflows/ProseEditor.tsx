/** Lexical's Markdown editing face keeps the original source until a content edit. */
import { useEffect, useRef, useState } from 'react'
import { createEditor, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND } from 'lexical'
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import { registerHistory, createEmptyHistoryState } from '@lexical/history'
import { $convertFromMarkdownString, $convertToMarkdownString, TRANSFORMERS, CODE } from '@lexical/markdown'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './documents.module.css'
const transformers = TRANSFORMERS.filter(transformer => transformer !== CODE)

export function ProseEditor({
  text,
  label,
  onChange,
  onUnsupported,
  onSelection,
  t,
}: PropsLocale<'workspace'> & {
  text: string
  label: string
  onChange: (value: string) => void
  onUnsupported?: () => void
  onSelection?: (value: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef({ text, onChange, onUnsupported })
  latest.current = { text, onChange, onUnsupported }
  const synchronize = useRef<(value: string) => void>()
  const source = useRef(text)
  const controller = useRef<ReturnType<typeof createEditor>>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    const editor = createEditor({
      namespace: 'workspace-prose',
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
      onError: (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    })
    controller.current = editor
    editor.setRootElement(root.current)
    const rich = registerRichText(editor)
    const history = registerHistory(editor, createEmptyHistoryState(), 300)
    let importing = false
    let lastSerialized = ''
    let ending = ''
    let lineEnding = '\n'
    const serialize = (markdown: string): string => markdown.replace(/\n/g, lineEnding) + ending
    const importText = (value: string): void => {
      importing = true
      ending = value.match(/(?:\r?\n)*$/)?.[0] ?? ''
      lineEnding = value.includes('\r\n') ? '\r\n' : '\n'
      editor.update(
        () => {
          $convertFromMarkdownString(value.replace(/\r\n/g, '\n'), transformers)
          lastSerialized = $convertToMarkdownString(transformers)
        },
        { discrete: true, tag: 'external' },
      )
      importing = false
      if (serialize(lastSerialized) !== value) latest.current.onUnsupported?.()
    }
    synchronize.current = importText
    importText(latest.current.text)
    const updates = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves, tags }) => {
      if (tags.has('external') || importing || (dirtyElements.size === 0 && dirtyLeaves.size === 0)) return
      const markdown = editorState.read(() => $convertToMarkdownString(transformers))
      if (markdown !== lastSerialized) {
        lastSerialized = markdown
        source.current = serialize(markdown)
        latest.current.onChange(source.current)
      }
    })
    const dispose = (): void => {
      updates()
      history()
      rich()
      editor.setRootElement(null)
      controller.current = undefined
      synchronize.current = undefined
    }
    return dispose
  }, [])
  useEffect(() => {
    const editor = controller.current
    if (editor === undefined) return
    if (source.current !== text) {
      source.current = text
      synchronize.current?.(text)
    }
  }, [text])
  return (
    <>
      <div className={css.toolbar}>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault()
          }}
          onClick={() => {
            controller.current?.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')
          }}
        >
          {t('editor.bold')}
        </button>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault()
          }}
          onClick={() => {
            controller.current?.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')
          }}
        >
          {t('editor.italic')}
        </button>
        <button
          type="button"
          onClick={() => {
            controller.current?.dispatchCommand(UNDO_COMMAND, undefined)
          }}
        >
          {t('editor.undo')}
        </button>
        <button
          type="button"
          onClick={() => {
            controller.current?.dispatchCommand(REDO_COMMAND, undefined)
          }}
        >
          {t('editor.redo')}
        </button>
      </div>
      {error !== undefined && <p role="alert">{error}</p>}
      <div
        className={css.prose}
        ref={root}
        contentEditable
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        suppressContentEditableWarning
        onMouseUp={() => {
          const selection = window.getSelection()
          if (selection !== null && root.current?.contains(selection.anchorNode)) {
            const value = selection.toString()
            if (value !== '') onSelection?.(value)
          }
        }}
      />
    </>
  )
}
