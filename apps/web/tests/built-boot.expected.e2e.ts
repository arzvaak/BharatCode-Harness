// @vitest-environment jsdom
// The built-bundle boot smoke: the assembled-jsdom test that owns the boot
// graph itself. Other files share the same scaffolding (assembled-boot.ts) to
// reach a surface only the built bundles expose; this one asserts that the
// graph assembles at all — staged activation across the immediately tier and
// the inject layers, per-plugin CSS injection, and a rendered journey reaching
// chat content from the keyless RemoteMock scenario.
//
// Component behavior remains owned by per-package suites (SlotTestRuntime
// benches over src). This smoke additionally pins the resident interaction
// fixture's cross-plugin projection because only the built connection,
// Controller, UI adapter, and Workspace graph can prove that transport-to-row
// path end to end.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('boots the built plugin graph and renders a fixture session end to end', async () => {
  mountAssembledApp()

  // The sidebar renders from the boot graph: every inject layer activated.
  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  expect(document.querySelector('svg[viewBox="0 0 512 512"]')).not.toBeNull()
  expect(screen.getAllByText('BharatCode').length).toBeGreaterThan(0)
  expect(screen.queryByText('DSH Local Build')).toBeNull()
  // Workspace groups begin folded; expand the fixture before selecting history.
  const fixtureGroup = (await within(tree).findAllByText('fixture'))
    .map(el => el.closest<HTMLElement>('[role="treeitem"]'))
    .find(el => el?.getAttribute('aria-expanded') !== null)
  if (fixtureGroup == null) throw new Error('fixture Workspace group missing')
  if (fixtureGroup.getAttribute('aria-expanded') === 'false') fireEvent.click(fixtureGroup)

  // The resident fixture has both a question and an approval; composer routing
  // exposes the question first, and the assembled workspace plugin mirrors that
  // actionable wait instead of the underlying running state.
  const waitingTitle = await within(tree).findByText('Fixture 历史会话')
  const waitingRow = waitingTitle.closest<HTMLElement>('[role="treeitem"]')
  if (waitingRow === null) throw new Error('fixture Session title must belong to a tree row')
  expect(waitingRow.querySelector('[data-state="warning"]')).not.toBeNull()
  expect(waitingRow.querySelector('[data-state="ongoing"]')).toBeNull()
  within(waitingRow).getByText('Waiting for answer')
  within(waitingRow).getByText('Answer')

  // Opening a session reaches chat content through the RemoteMock transport.
  fireEvent.click(waitingTitle)
  await waitFor(() => {
    expect(document.querySelector('[data-sample="bash"]')).not.toBeNull()
  }, { timeout: 10_000 })
  // The generated bundle roster mounts the question UI before the approval UI.
  // Skip the resident fixture's three questions, then resolve its approval so
  // the ordinary composer bar (which owns ContextMeter) resumes.
  for (let index = 0; index < 3; index += 1) {
    fireEvent.click(await screen.findByRole('button', { name: 'Skip' }))
  }
  const allowOnce = await screen.findByRole('button', { name: 'Allow once' })
  await waitFor(() => {
    within(waitingRow).getByText('Waiting for approval')
    within(waitingRow).getByText('Approval')
  })
  fireEvent.click(allowOnce)

  // The fixture mirrors all three token-meter projections, so the assembled
  // ContextMeter reaches its composition panel instead of only the occupancy
  // fallback path.
  const contextTrigger = await screen.findByRole('button', { name: /of context used/ })
  fireEvent.click(contextTrigger)
  const contextPanel = await screen.findByRole('dialog', { name: 'of context used' })
  within(contextPanel).getByText('System prompt')
  within(contextPanel).getByText('Tool definitions')
  within(contextPanel).getByText('Messages')

  // The built ToolRow and DiffBlock share the write fixture's trailing-newline
  // semantics: `hello fixture\n` contributes one addition. Counts belong to the
  // tool row; the diff's line markers are CSS pseudo-elements, absent from textContent.
  const mutationRows = [...document.querySelectorAll<HTMLElement>('[data-variant="write"],[data-variant="edit"]')]
  expect(mutationRows.length).toBeGreaterThan(0)
  const writeRow = mutationRows.find(row => row.getAttribute('data-variant') === 'write'
    && row.textContent?.includes('new-demo.txt'))
  if (writeRow === undefined) throw new Error('fixture write row missing')
  expect(within(writeRow).getAllByText('+1', { exact: true })).toHaveLength(1)
  expect(within(writeRow).getAllByText('-0', { exact: true })).toHaveLength(1)
  expect(writeRow.querySelector('[data-diff]')).toBeNull()
  for (const row of mutationRows) {
    const toggle = row.querySelector('[data-expandable]')
    if (toggle !== null) act(() => { fireEvent.click(toggle) })
  }
  const diffCards = [...document.querySelectorAll('[data-diff]')]
  expect(diffCards.length).toBeGreaterThan(0)
  const writeDiff = writeRow.querySelector<HTMLElement>('[data-diff]')
  if (writeDiff === null) throw new Error('expanded fixture write diff missing')
  within(writeDiff).getByText('hello fixture', { exact: true })
  expect(within(writeRow).getAllByText('+1', { exact: true })).toHaveLength(1)
  expect(within(writeRow).getAllByText('-0', { exact: true })).toHaveLength(1)
  expect(writeDiff.textContent).not.toContain('+1 -0')

  // The web render intent reaches the assembled boot graph: the fixture's
  // web_search / web_fetch turns render their keyed WebRow cards, proving the
  // registration, wire projection, and card rendering survive the real bundle
  // path (not just the per-package src benches). WebRow composes ToolRow, so the
  // card is collapsed behind the row; the keyed row is pinned by its `data-tool`
  // (ToolRow sets it from the wire tool name).
  const webSearchRow = await waitFor(() => {
    const row = document.querySelector('[data-tool="web_search"]')
    expect(row).not.toBeNull()
    expect(document.querySelector('[data-tool="web_fetch"]')).not.toBeNull()
    return row!
  }, { timeout: 10_000 })
  // Expand the web_search row to prove its WebBlock card renders end to end.
  const webToggle = webSearchRow.querySelector('[data-expandable]')
  if (webToggle !== null) act(() => { fireEvent.click(webToggle) })
  await waitFor(() => {
    expect(webSearchRow.querySelector('[data-web]')).not.toBeNull()
  }, { timeout: 10_000 })

  // Destinations resolve independent conversations; each working surface opens
  // immediately, while the context disclosure retains its explicit close action.
  fireEvent.click(screen.getByRole('button', { name: 'Research' }))
  const research = await screen.findByRole('region', { name: 'Research workspace' }, { timeout: 10_000 })
  expect(within(research).getByRole('combobox', { name: 'Research presentation' })).toHaveProperty('value', 'full')
  expect(within(research).getByRole('button', { name: 'Execution' })).toBeTruthy()
  fireEvent.change(within(research).getByRole('combobox', { name: 'Research presentation' }), { target: { value: 'simple' } })
  expect(within(research).queryByRole('button', { name: 'Execution' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Coding' }))
  expect(await screen.findByRole('region', { name: 'Coding workspace' }, { timeout: 10_000 })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Code editor' })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Files' }).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText('Workspace layout', { selector: 'summary' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Workspace layout' }), { target: { value: 'chat-focus' } })
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Workspace layout' }).value).toBe('chat-focus')
  fireEvent.click(screen.getByRole('button', { name: 'Swap sides' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
  expect(screen.getByLabelText<HTMLSelectElement>('Workspace layout').value).toBe('document-focus')
  fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
  const usingContext = await screen.findByRole('button', { name: /^Using context \(\d+\)$/ })
  fireEvent.click(usingContext)
  const evidencePanel = await screen.findByRole('dialog', { name: 'Using context' })
  fireEvent.click(within(evidencePanel).getByRole('button', { name: 'Close context' }))
  expect(screen.queryByRole('dialog', { name: 'Using context' })).toBeNull()
  expect(document.activeElement).toBe(usingContext)

  // Every bundle injected its plugin-owned style tag (the loader's CSS path).
  const styleOwners = [...document.head.querySelectorAll('style[data-plugin]')]
    .map(style => style.getAttribute('data-plugin'))
  for (const plugin of ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-tool']) {
    expect(styleOwners).toContain(plugin)
  }
})

it('boots without ui-chat and does not select another conversation view implicitly', async () => {
  mountAssembledApp({ exclude: ['@deepseek-ai/dsh-client-ui-chat'] })

  const tree = await screen.findByRole('tree', { name: 'Sessions' }, { timeout: 10_000 })
  const boot = Reflect.get(window, '__DSH_BOOT__') as { entries: Array<{ id: string }> } | undefined
  expect(boot?.entries.some(entry => entry.id === '@deepseek-ai/dsh-client-ui-chat')).toBe(false)
  const fixtureGroup = (await within(tree).findAllByText('fixture'))
    .map(el => el.closest<HTMLElement>('[role="treeitem"]'))
    .find(el => el?.getAttribute('aria-expanded') !== null)
  if (fixtureGroup?.getAttribute('aria-expanded') === 'false') fireEvent.click(fixtureGroup)
  const sessionTitle = await within(tree).findByText('Fixture 历史会话')
  fireEvent.click(sessionTitle)
  await waitFor(() => {
    expect(document.querySelector('[data-slot="conversation.session"]')).not.toBeNull()
  }, { timeout: 10_000 })
  expect(document.querySelector('[data-slot="conversation.view"]')).toBeNull()
})
