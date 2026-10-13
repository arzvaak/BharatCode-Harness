// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { QuoteSelection } from '../src/client/skeleton/QuoteSelection.tsx'

beforeEach(() => { Range.prototype.getBoundingClientRect = () => new DOMRect(20, 20, 100, 20) })

afterEach(() => { cleanup(); document.getSelection()?.removeAllRanges() })

function mount(enabled = true) {
  let draft = 'My existing question'
  const insert = vi.fn((text: string) => { draft += text; return true })
  function Fixture() {
    const root = useRef<HTMLDivElement>(null)
    return <div ref={root}>
      <div data-assistant-output=""><p>First line</p><p>Second line</p></div>
      <p>User text</p>
      <QuoteSelection root={root} enabled={enabled} label="Ask about this" onQuote={insert} />
    </div>
  }
  render(<Fixture />)
  return { draft: () => draft, insert }
}

function select(element: Element) {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
}

it('offers a quote for selected assistant output without sending or replacing the draft', () => {
  const f = mount()
  select(screen.getByText('First line'))
  const button = screen.getByRole('button', { name: 'Ask about this' })
  fireEvent.mouseDown(button)
  fireEvent.click(button)
  expect(f.draft()).toBe('My existing question\n\n> First line\n\n')
  expect(document.getSelection()?.isCollapsed).toBe(true)
  expect(screen.queryByRole('button', { name: 'Ask about this' })).toBeNull()
})

it('ignores user text and selections crossing out of one assistant output', () => {
  mount()
  select(screen.getByText('User text'))
  expect(screen.queryByRole('button', { name: 'Ask about this' })).toBeNull()
  const range = document.createRange()
  range.setStart(screen.getByText('First line').firstChild!, 0)
  range.setEnd(screen.getByText('User text').firstChild!, 4)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  expect(screen.queryByRole('button', { name: 'Ask about this' })).toBeNull()
})

it('dismisses with Escape and does not offer insertion while the composer is locked', () => {
  mount(false)
  select(screen.getByText('First line'))
  expect(screen.queryByRole('button', { name: 'Ask about this' })).toBeNull()
  cleanup()
  mount()
  select(screen.getByText('First line'))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('button', { name: 'Ask about this' })).toBeNull()
})
