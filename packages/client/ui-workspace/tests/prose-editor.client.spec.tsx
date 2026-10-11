// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ProseEditor } from '../src/client/workflows/ProseEditor.tsx'
import { en } from '../src/client/locales.ts'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
afterEach(cleanup)
const t = ((key: keyof typeof en) => en[key]) as PropsLocale<'workspace'>['t']
it('mounts rich Markdown without normalizing the source and follows external revisions without edits', async () => {
  const change = vi.fn()
  const r = render(<ProseEditor text={'# Title\n\nAn **important** paragraph.\n'} label="Manuscript" onChange={change} t={t} />)
  expect(screen.getByRole('textbox', { name: 'Manuscript' }).textContent).toContain('important')
  expect(change).not.toHaveBeenCalled()
  r.rerender(<ProseEditor text={'# Revised\n\nOther text.'} label="Manuscript" onChange={change} t={t} />)
  await waitFor(() =>{  expect(screen.getByRole('textbox', { name: 'Manuscript' }).textContent).toContain('Other text') })
  expect(change).not.toHaveBeenCalled()
})
it('falls back for lossy syntax on initial and external revisions, without changing source', () => {
  const change = vi.fn()
  const unsupported = vi.fn()
  const rendered = render(
    <ProseEditor text={'__bold__\n'} label="Manuscript" onChange={change} onUnsupported={unsupported} t={t} />,
  )
  expect(unsupported).toHaveBeenCalledOnce()
  expect(change).not.toHaveBeenCalled()
  unsupported.mockClear()
  rendered.rerender(
    <ProseEditor
      text={'# Heading\r\n\r\nA **bold** sentence.\r\n'}
      label="Manuscript"
      onChange={change}
      onUnsupported={unsupported}
      t={t}
    />,
  )
  expect(unsupported).not.toHaveBeenCalled()
  expect(change).not.toHaveBeenCalled()
  rendered.rerender(
    <ProseEditor text={'- first\n- second\n'} label="Manuscript" onChange={change} onUnsupported={unsupported} t={t} />,
  )
  expect(unsupported).not.toHaveBeenCalled()
  expect(change).not.toHaveBeenCalled()
  rendered.rerender(<ProseEditor text={'__italic__\n'} label="Manuscript" onChange={change} onUnsupported={unsupported} t={t} />)
  expect(unsupported).toHaveBeenCalledOnce()
  expect(change).not.toHaveBeenCalled()
})
