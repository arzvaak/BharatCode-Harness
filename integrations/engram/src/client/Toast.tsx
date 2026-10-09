/**
 * Lightweight Toast: a top-right stacked notification, auto-dismisses after 3 seconds, paused on hover.
 * Four semantics: info / success / error / warning (icons and colors are decided by the stylesheet;
 * the message always comes from the string passed in by the caller).
 * confirm is not handled by this hook — that is a dialog decision, and window.confirm is kept to
 * avoid breaking flow semantics.
 * @module @kenz1117/dsh-engram/client/Toast
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './panel.module.css'

/** Toast semantic type. */
export type ToastKind = 'info' | 'success' | 'error' | 'warning'

/** A single Toast. */
interface ToastItem {
  readonly id: number
  readonly kind: ToastKind
  readonly message: string
  readonly duration: number
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  info: 3000,
  success: 3000,
  warning: 5000,
  error: 5000,
}

/** Sequentially incrementing id source (avoids a useEffect dependency on Date.now). */
let toastIdCursor = 0

/**
 * Renders the toasts array as a top-right floating layer. Returns a new ReactElement each frame;
 * the caller mounts it at the end of the panel root node. It does not disappear while hovered
 * (controlled by the timers maintained inside useToast).
 */
function ToastViewport({ items, onDismiss }: {
  readonly items: readonly ToastItem[]
  readonly onDismiss: (id: number) => void
}): React.ReactElement {
  return (
    <div className={styles.toastViewport} role="region" aria-live="polite" aria-label="notifications">
      {items.map(toast => {
        const kindClass = toast.kind === 'success' ? styles.toastSuccess
          : toast.kind === 'error' ? styles.toastError
          : toast.kind === 'warning' ? styles.toastWarning
          : styles.toastInfo
        return (
          <div key={toast.id}
            className={`${styles.toast} ${kindClass}`}
            role={toast.kind === 'error' || toast.kind === 'warning' ? 'alert' : 'status'}>
            <span className={styles.toastBody}>{toast.message}</span>
            <button type="button" className={styles.toastDismiss} aria-label="dismiss"
              onClick={() => { onDismiss(toast.id) }}>×</button>
          </div>
        )
      })}
    </div>
  )
}

/** Toast hook return value: the toasts list + push function + the render node. */
export interface ToastController {
  readonly toasts: readonly ToastItem[]
  readonly push: (kind: ToastKind, message: string, duration?: number) => void
  readonly dismiss: (id: number) => void
  readonly viewport: React.ReactElement
}

export function useToast(): ToastController {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([])
  // Timer table: id → setTimeout handle, so dismiss can cancel it.
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id))
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const push = useCallback((kind: ToastKind, message: string, duration?: number) => {
    toastIdCursor += 1
    const id = toastIdCursor
    const ms = duration ?? DEFAULT_DURATION[kind]
    const item: ToastItem = { id, kind, message, duration: ms }
    setToasts(current => [...current, item])
    const timer = setTimeout(() => { dismiss(id) }, ms)
    timersRef.current.set(id, timer)
  }, [dismiss])

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  const viewport = (
    <ToastViewport items={toasts} onDismiss={dismiss} />
  )

  return { toasts, push, dismiss, viewport }
}