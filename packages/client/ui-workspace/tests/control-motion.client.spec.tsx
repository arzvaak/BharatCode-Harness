// @vitest-environment jsdom
import { useRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useControlMotion } from '../src/client/workflows/control-motion.ts'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function Controls() {
  const root = useRef<HTMLElement>(null)
  useControlMotion(root)
  return <section ref={root}><button type="button">Capture changes</button><button type="button" disabled>Unavailable</button></section>
}
function frames() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let next = 0
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id) })
  return { callbacks, advance: (count: number) => {
    for (let step = 0; step < count; step++) {
      now += 16
      const active = [...callbacks.values()]; callbacks.clear()
      for (const callback of active) callback(now)
    }
  } }
}
it('retargets a keyboard press from its current position and stops at rest', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const f = frames(); render(<Controls />)
  const button = screen.getByRole('button', { name: 'Capture changes' })
  fireEvent.keyDown(button, { key: 'Enter' }); f.advance(8)
  const pressed = button.style.transform; expect(pressed).toContain('scale(')
  fireEvent.keyUp(window, { key: 'Enter' }); expect(button.style.transform).toBe(pressed)
  f.advance(80); expect(button.style.transform).toBe(''); expect(f.callbacks.size).toBe(0)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Unavailable' }), { key: 'Enter' })
  expect(f.callbacks.size).toBe(0)
})
it('restores styles and stops frames when reduced motion changes or the owner is disposed', () => {
  let change = () => {}
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: (_event: string, callback: () => void) => { change = callback }, removeEventListener: vi.fn() }))
  const f = frames(); const view = render(<Controls />)
  const button = screen.getByRole('button', { name: 'Capture changes' })
  fireEvent.keyDown(button, { key: ' ' }); f.advance(4); change()
  expect(button.style.transform).toBe(''); expect(f.callbacks.size).toBe(0)
  fireEvent.keyDown(button, { key: 'Enter' }); f.advance(4); view.unmount()
  expect(button.style.transform).toBe(''); expect(f.callbacks.size).toBe(0)
})
