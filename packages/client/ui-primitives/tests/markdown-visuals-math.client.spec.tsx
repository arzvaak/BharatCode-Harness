// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from './markdown-test-components.tsx'
// Exercise the actual extension wrapper with the native math renderer.
import { makeAssistantWrapper } from '../../../../integrations/visuals/src/view.js'

afterEach(cleanup)
const inline = String.raw`\boxed{E = mc^2}`
const display = String.raw`\boxed{\begin{aligned} x &= \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} \\ y &= \sum_{i=1}^{n} x_i \end{aligned}}`
const answer = `Inline $${inline}$.\n\n\`\`\`visual\nmetrics\nSolutions | 2\n\`\`\`\n\n\\[\n${display}\n\\]`
function Native({ node }: { node: { data: { status: string; blocks: { kind: string; text: string }[] } } }) {
  return createElement('section', null, node.data.blocks.map((block, key) =>
    createElement(MarkdownText, { key, text: block.text, streaming: node.data.status === 'running' })))
}
const Wrapper = makeAssistantWrapper(Native)
function wrapped(text: string, status: string) {
  return createElement(Wrapper, { node: { data: { status, blocks: [{ kind: 'text', text }] } } })
}
describe('Visuals and native LaTeX', () => {
  it('preserves boxed and aligned TeX on both sides of an inline graphic', () => {
    const { container } = render(wrapped(answer, 'settled'))
    expect(container.querySelectorAll('figure')).toHaveLength(1)
    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelectorAll('.fbox')).toHaveLength(2)
    expect(container.querySelectorAll('.katex-display')).toHaveLength(1)
    expect([...container.querySelectorAll('annotation')].map(n => n.textContent)).toEqual([inline, display])
    expect(container.querySelector('.katex-error')).toBeNull()
  })
  it('keeps incomplete streamed TeX literal and typesets the completed boxed answer', () => {
    const live = render(wrapped(answer.slice(0, -8), 'running'))
    expect(live.container.querySelector('.katex')).toBeNull()
    expect(live.container.querySelector('.katex-error')).toBeNull()
    live.rerender(wrapped(answer, 'settled'))
    expect(live.container.querySelectorAll('.fbox')).toHaveLength(2)
    expect(live.container.querySelector('.katex-error')).toBeNull()
  })
})

it('uses display metrics for settled formula products while leaving streamed text unchanged', () => {
  const source = String.raw`| Quantity | Formula |
|---|---|
| Bundle | $[r^n(\prod_{i<j}d_{ij}^2)]^{1/n^2}$ |`
  const live = render(wrapped(source, 'running'))
  expect(live.container.textContent).not.toContain('\\displaystyle')
  live.rerender(wrapped(source, 'settled'))
  expect(live.container.querySelector('annotation')?.textContent).toBe(String.raw`\displaystyle [r^n(\prod_{i<j}d_{ij}^2)]^{1/n^2}`)
  expect(live.container.querySelector('.op-limits')).not.toBeNull()
  expect(live.container.querySelector('.katex-error')).toBeNull()
})

it('aligns equivalent formulas and keeps units inside the native math box', () => {
  const source = String.raw`| Quantity | Formula |
|---|---|
| L | $2\times10^{-7}\ln(D/r)$ H/m $=0.4605\log_{10}(D/r)$ mH/km |`
  const { container } = render(wrapped(source, 'settled'))
  const cell = container.querySelector('tbody td:nth-child(2)')!
  expect(cell.querySelectorAll('.katex')).toHaveLength(1)
  const projected = cell.querySelector('annotation')!.textContent
  expect(projected).toContain(String.raw`\begin{aligned}`)
  expect(projected).toContain(String.raw`\text{H/m} \\ & =0.4605`)
  expect(projected).toContain(String.raw`\text{mH/km}`)
  expect(container.querySelector('.katex-error')).toBeNull()
})
