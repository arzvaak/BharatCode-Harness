/** Short, disposable motion for changed workflow surfaces; source/editor nodes stay mounted. */
import type { RefObject } from 'react'
import { useLayoutEffect, useRef } from 'react'

/**
 * Animate newly admitted workflow elements while honoring reduced motion and owner lifetime.
 * @param owner - Identity whose changes reset animation ownership.
 * @param revision - Render revision used to find newly admitted elements.
 * @returns Root ref for the workflow container.
 */
export function useWorkflowMotion<T extends HTMLElement>(owner: string, revision: unknown): RefObject<T> {
  const root = useRef<T>(null)
  const previous = useRef(new Map<Element, string>())
  const animations = useRef<Animation[]>([])
  useLayoutEffect(() => {
    previous.current.clear()
    return () => {
      for (const animation of animations.current) animation.cancel()
      animations.current = []
      previous.current.clear()
    }
  }, [owner])
  useLayoutEffect(() => {
    const element = root.current
    if (element === null) return
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
    const cancel = () => {
      for (const animation of animations.current) animation.cancel()
      animations.current = []
    }
    const next = new Map<Element, string>()
    const frames: { node: HTMLElement; opacity: string; transform: string; fresh: boolean }[] = []
    for (const node of element.querySelectorAll<HTMLElement>('[data-workflow-motion]')) {
      const identity = node.dataset.workflowMotion ?? ''
      next.set(node, identity)
      if (previous.current.get(node) === identity || node.hidden || node.getClientRects().length === 0) continue
      const style = getComputedStyle(node)
      const running = typeof node.getAnimations === 'function' && node.getAnimations().length > 0
      frames.push({
        node,
        opacity: running ? style.opacity : '0.7',
        transform: running ? style.transform : 'translateY(3px)',
        fresh: !previous.current.has(node),
      })
    }
    cancel()
    previous.current = next
    if (!media?.matches) {
      for (const { node, opacity, transform, fresh } of frames) {
        if (typeof node.animate !== 'function') continue
        const reveal = node.dataset.workflowMotion === 'structure'
        animations.current.push(
          node.animate([
            { opacity: fresh ? 0.45 : opacity, transform: reveal ? 'none' : fresh ? 'translateY(7px)' : transform, ...(reveal ? { maxHeight: '0px' } : {}) },
            { opacity: 1, transform: 'none', ...(reveal ? { maxHeight: `${node.getBoundingClientRect().height}px` } : {}) },
          ], { duration: fresh ? 230 : 170, easing: 'cubic-bezier(.16,.8,.3,1)' }),
        )
      }
    }
    // Changing the OS preference stops an in-flight transition immediately.
    if (media !== undefined && typeof media.addEventListener === 'function') media.addEventListener('change', cancel)
    return () => {
      if (media !== undefined && typeof media.removeEventListener === 'function') media.removeEventListener('change', cancel)
    }
  }, [owner, revision])
  return root
}
