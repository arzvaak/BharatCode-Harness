import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import css from './QuoteSelection.module.css'

interface SelectedQuote { text: string; left: number; top: number }

/**
 * Offer an explicit composer quote for a selection within one assistant output.
 * @param props - Selection scope, composer availability, localized label, and guarded insertion.
 * @returns a floating action while assistant text is selected, otherwise null.
 */
export function QuoteSelection({ root, enabled, label, onQuote }: {
  root: RefObject<HTMLDivElement>
  enabled: boolean
  label: string
  onQuote: (text: string) => boolean
}) {
  const [quote, setQuote] = useState<SelectedQuote | null>(null)
  useEffect(() => {
    if (!enabled) { setQuote(null); return }
    const doc = root.current?.ownerDocument
    if (doc === undefined) return
    const update = () => {
      const selection = doc.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) {
        setQuote(null); return
      }
      const range = selection.getRangeAt(0)
      const element = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
      const output = element(range.startContainer)?.closest('[data-assistant-output]')
      if (output === undefined || output === null || !root.current?.contains(output)
        || !output.contains(range.endContainer) || selection.toString().trim() === '') {
        setQuote(null); return
      }
      const rect = range.getBoundingClientRect()
      setQuote({ text: selection.toString(),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 164)),
        top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 44)),
      })
    }
    const dismiss = () => { setQuote(null) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    doc.addEventListener('selectionchange', update)
    doc.addEventListener('keydown', onKey)
    doc.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      doc.removeEventListener('selectionchange', update)
      doc.removeEventListener('keydown', onKey)
      doc.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [enabled, root])

  if (!enabled || quote === null) return null
  return createPortal(
    <button type="button" className={css.action} style={{ left: quote.left, top: quote.top }}
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => {
        const text = `\n\n${quote.text.split('\n').map(line => `> ${line}`).join('\n')}\n\n`
        root.current?.ownerDocument.getSelection()?.removeAllRanges()
        if (!onQuote(text)) return
        setQuote(null)
      }}
    >{label}</button>, root.current?.ownerDocument.body ?? document.body,
  )
}
