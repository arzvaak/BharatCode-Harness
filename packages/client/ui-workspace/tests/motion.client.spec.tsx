// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { useWorkflowMotion } from '../src/client/workflows/motion.ts'

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalAnimate === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  else Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
})
function Harness({ owner = 'a', open = false, identity = 'source' }) {
  const ref = useWorkflowMotion<HTMLDivElement>(owner, `${open}/${identity}`)
  return <div ref={ref}><textarea aria-label="Draft" defaultValue="Unsent text" />{open && <article data-workflow-motion={identity}>Source</article>}</div>
}
function motion() {
  const media = new EventTarget()
  let reduced = false
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: media.addEventListener.bind(media), removeEventListener: media.removeEventListener.bind(media) }))
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
  const cancel = vi.fn()
  const animate = vi.fn(() => ({ cancel }))
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  return { cancel, animate, reduce() { reduced = true; media.dispatchEvent(new Event('change')) } }
}
it('disposes obsolete motion on rapid reversal and owner changes without replacing the draft', () => {
  const m = motion()
  const view = render(<Harness />)
  const draft = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Draft' })
  draft.value = 'Still writing'
  view.rerender(<Harness open />)
  expect(m.animate).toHaveBeenCalledOnce()
  view.rerender(<Harness />)
  expect(m.cancel).toHaveBeenCalledOnce()
  view.rerender(<Harness open />)
  view.rerender(<Harness owner="b" open />)
  expect(m.cancel).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
  expect(draft.value).toBe('Still writing')
  view.unmount()
  expect(m.cancel).toHaveBeenCalledTimes(3)
})
it('honours reduced motion both before opening and during an active transition', () => {
  const m = motion()
  const view = render(<Harness open />)
  expect(m.animate).toHaveBeenCalledOnce()
  m.reduce()
  expect(m.cancel).toHaveBeenCalledOnce()
  view.rerender(<Harness open identity="other-source" />)
  expect(m.animate).toHaveBeenCalledOnce()
  expect(screen.getByText('Source')).toBeTruthy()
})
