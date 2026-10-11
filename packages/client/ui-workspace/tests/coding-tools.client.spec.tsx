// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CodingWorkspace, type CodingWorkspaceProps } from '../src/client/workflows/CodingWorkspace.tsx'
import { en } from '../src/client/locales.ts'
vi.mock('../src/client/workflows/CodeEditor.tsx', () => ({ CodeEditor: ({ text,label }: { text:string;label:string }) => <textarea aria-label={label} defaultValue={text}/> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const props = (): CodingWorkspaceProps => ({ sessionId:'coding-session' as never,profile:'coding',t:((key:keyof typeof en)=>en[key]) as CodingWorkspaceProps['t'],view:{ active:'main.ts',documents:{ 'main.ts':{ path:'main.ts',base:{ absolutePath:'/project/main.ts',version:'v1',text:'const value = 1' },text:'const value = 1',busy:false } } },collapseEditor:vi.fn(),openDocument:async()=>{},closeDocument:async()=>{},selectDocument:vi.fn(),editDocument:async()=>{},saveDocument:async()=>{},rebaseDocument:async()=>{},openPreview:vi.fn(),openTerminal:vi.fn(),toggleFiles:vi.fn(),listFiles:async()=>({ path:'',entries:[],truncated:false }),searchArtifacts:async()=>({ hits:[],hasMore:false }),readArtifact:vi.fn(),registerArtifact:vi.fn(),inspectArtifact:vi.fn(),requestEvidenceHandoff:vi.fn(),openSession:vi.fn() })
it('keeps the source editor and draft through tools and exposes preview in Document options', async () => {
  const p=props();render(<CodingWorkspace {...p}/>)
  const source=await screen.findByRole('textbox',{ name:'Code source' }) as HTMLTextAreaElement
  fireEvent.change(source,{ target:{ value:'Keep this unsaved buffer' } })
  fireEvent.click(screen.getByRole('tab',{ name:'Changes' }))
  expect(screen.queryByRole('textbox',{ name:'Code source' })).toBeNull()
  expect(screen.getByText('Review your working changes')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab',{ name:'Editor' }))
  expect(screen.getByRole('textbox',{ name:'Code source' })).toBe(source)
  expect(source.value).toBe('Keep this unsaved buffer')
  fireEvent.click(screen.getByText('Document options',{ selector:'summary' }))
  fireEvent.click(screen.getByRole('button',{ name:'Open rich preview' }))
  expect(p.openPreview).toHaveBeenCalledWith(p.sessionId,'main.ts')
})
it('supports roving keyboard tabs and suppresses tool motion when reduced motion is enabled', () => {
  vi.stubGlobal('matchMedia',()=>({ matches:true }))
  const animate=vi.fn();const previous=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'animate');HTMLElement.prototype.animate=animate
  try {
    render(<CodingWorkspace {...props()}/>)
    const editor=screen.getByRole('tab',{ name:'Editor' });fireEvent.keyDown(editor,{ key:'ArrowRight' })
    const changes=screen.getByRole('tab',{ name:'Changes' })
    expect(changes.getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(changes)
    fireEvent.keyDown(changes,{ key:'End' })
    expect(screen.getByRole('tab',{ name:'Checks' }).getAttribute('aria-selected')).toBe('true')
    expect(animate).not.toHaveBeenCalled()
  } finally { if (previous === undefined) Reflect.deleteProperty(HTMLElement.prototype,'animate'); else Object.defineProperty(HTMLElement.prototype,'animate',previous) }
})
