/** Shared spring press feedback for workbench controls, including keyboard activation. */
import { useEffect, type RefObject } from 'react'

/**
 * Attach spring feedback to the controls inside a workbench.
 * @param root - Control boundary whose disposal restores styles and stops frames.
 */
export function useControlMotion(root: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = root.current
    if (element === null) return
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined
    const states = new Map<HTMLButtonElement, {
      position: number
      velocity: number
      target: number
      original: string
      transition: string
    }>()
    let frame = 0
    let previous = 0
    const restore = (button: HTMLButtonElement, state: { original: string; transition: string }): void => {
      button.style.transform = state.original
      button.style.transitionProperty = state.transition
    }
    const reset = (): void => {
      cancelAnimationFrame(frame)
      frame = 0
      for (const [button, state] of states) restore(button, state)
      states.clear()
    }
    const tick = (now: number): void => {
      frame = 0
      const elapsed = Math.min(Math.max((now - previous) / 1000, 0), .032)
      previous = now
      let moving = false
      for (const [button, state] of states) {
        if (!button.isConnected || button.disabled) {
          restore(button, state)
          states.delete(button)
          continue
        }
        const steps = Math.max(1, Math.ceil(elapsed / .008))
        const dt = elapsed / steps
        for (let index = 0; index < steps; index++) {
          state.velocity += ((state.target - state.position) * 310 - state.velocity * 29) * dt
          state.position += state.velocity * dt
        }
        const settled = Math.abs(state.target - state.position) < .001 && Math.abs(state.velocity) < .005
        if (settled && state.target === 0) {
          restore(button, state)
          states.delete(button)
        } else {
          if (settled) { state.position = state.target; state.velocity = 0 }
          button.style.transform = `translateY(${state.position * 1.5}px) scale(${1 - state.position * .025})`
          moving ||= !settled
        }
      }
      if (moving) frame = requestAnimationFrame(tick)
    }
    const wake = (): void => {
      if (frame !== 0) return
      previous = performance.now()
      frame = requestAnimationFrame(tick)
    }
    const press = (event: Event): void => {
      if (media?.matches || !(event.target instanceof Element)) return
      if (event instanceof KeyboardEvent && (event.repeat || !['Enter', ' '].includes(event.key))) return
      if (typeof PointerEvent === 'function' && event instanceof PointerEvent && event.button !== 0) return
      const button = event.target.closest('button')
      if (!(button instanceof HTMLButtonElement) || button.disabled || !element.contains(button)) return
      const state = states.get(button) ?? {
        position: 0, velocity: 0, target: 0, original: button.style.transform, transition: button.style.transitionProperty,
      }
      button.style.transitionProperty = 'background-color, color, border-color, box-shadow'
      state.target = 1
      states.set(button, state)
      wake()
    }
    const release = (): void => {
      for (const state of states.values()) state.target = 0
      if (states.size > 0) wake()
    }
    element.addEventListener('pointerdown', press)
    element.addEventListener('keydown', press)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('keyup', release)
    window.addEventListener('blur', release)
    if (media !== undefined && typeof media.addEventListener === 'function') media.addEventListener('change', reset)
    return () => {
      reset()
      element.removeEventListener('pointerdown', press)
      element.removeEventListener('keydown', press)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', release)
      if (media !== undefined && typeof media.removeEventListener === 'function') media.removeEventListener('change', reset)
    }
  }, [root])
}
