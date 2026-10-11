/** Interruptible tool changes preserve editor DOM and respect live reduced-motion settings. */
import { useLayoutEffect, useRef, type RefObject } from 'react'
/** @param tool - Active tool identity. @returns Container of stable tool panels. */
export function useToolMotion<T extends HTMLElement>(tool: string): RefObject<T> {
  const root = useRef<T>(null)
  const running = useRef<Animation>()
  useLayoutEffect(() => {
    const panel = root.current?.querySelector<HTMLElement>('[role=tabpanel]:not([hidden])')
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
    const current = panel === undefined || panel === null ? undefined : getComputedStyle(panel)
    const from = running.current?.playState === 'running' ? { opacity: current?.opacity ?? '1', transform: current?.transform ?? 'none' } : { opacity: '.35', transform: 'translateY(8px)' }
    running.current?.cancel()
    if (!media?.matches && panel !== undefined && panel !== null && typeof panel.animate === 'function')
      running.current = panel.animate([from, { opacity: '1', transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' })
    const cancel = () => running.current?.cancel()
    if (media !== undefined && typeof media.addEventListener === 'function') media.addEventListener('change', cancel)
    return () => { cancel(); if (media !== undefined && typeof media.removeEventListener === 'function') media.removeEventListener('change', cancel) }
  }, [tool])
  return root
}
