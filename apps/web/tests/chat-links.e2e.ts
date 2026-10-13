/** Private copied chat links prepare completed history for different model selections. */
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { formatChatLink } from '@deepseek-ai/dsh-util-workspace-path'
import { launchWebScaffold, seedSession, readPersistedEvents, watchConsole } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

it('copies a chat link and gives its real history to two model selections without exporting', async () => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  const browser = await chromium.launch()
  const id = SessionId('copied-reference-source')
  const source = Session.create(SessionId(id))
  source.append('turn/start', { turn: 1 })
  source.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'REFERENCE_EVIDENCE_37: choose the third option.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const fixture = [JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0,
    cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0 }), ...source.snapshotEvents().map(event => JSON.stringify(event)), ''].join('\n')
  const requests: string[] = []
  const stop = scaffold.ctx.on('llm/stream', async function* (options) {
    requests.push(JSON.stringify(options))
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'LINK_REFERENCE_OK' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'LINK_REFERENCE_OK' } },
      { type: 'usage', usage: { inputTokens: 100, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    yield* chunks
  })
  try {
    await seedSession(scaffold, fixture, id)
    const page = await newEnglishPage(browser)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const errors = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'All chats', exact: true }).click()
    const row = page.locator(`[data-row-key="session:${id}"]`)
    await row.click(); await row.hover()
    await row.getByRole('button', { name: /^Session actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Copy chat link', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Chat link copied', exact: true }).waitFor()
    const link = await page.evaluate(async () => navigator.clipboard.readText())
    expect(link).toBe(formatChatLink(id))
    const before = await readPersistedEvents(scaffold, id)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^New session$/i }).first().click()
    await expect.poll(() => page.locator('[data-conversation-session]').getAttribute('data-conversation-session')).not.toBe(id)
    const input = page.locator('[data-composer-input][contenteditable="true"]').last()
    await input.fill(`Compare this earlier chat: ${link}`)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(() => requests.length).toBe(1)
    await page.getByText('LINK_REFERENCE_OK', { exact: true }).last().waitFor()
    expect(requests[0]).toContain('REFERENCE_EVIDENCE_37')
    expect(requests[0]).toContain('referenced-sessions')
    await page.getByRole('button', { name: /^Select model, current/ }).click()
    await page.getByRole('menuitem', { name: /^Model/ }).click()
    await page.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash-Vision-Exp', exact: true }).click()
    await input.fill(`Reconsider the same chat with this model: ${link}`)
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests[1]).toContain('REFERENCE_EVIDENCE_37')
    expect(requests[1]).toContain('deepseek-v4-flash-vision-exp')
    expect(await readPersistedEvents(scaffold, id)).toEqual(before)
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    await page.screenshot({ path: join(REPO_ROOT, 'dist/chat-links-workbench.png') })
    await page.setViewportSize({ width: 980, height: 760 })
    await page.screenshot({ path: join(REPO_ROOT, 'dist/chat-links-workbench-narrow.png') })
    expect(errors.pageErrors).toEqual([])
  } finally { stop(); await browser.close(); await scaffold.close() }
}, 120_000)

it('opens a queued native chat link after real client startup and metadata loading', async () => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  const browser = await chromium.launch()
  const id = SessionId('native-queued-source')
  const source = Session.create(id)
  source.append('turn/start', { turn: 1 })
  source.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Native source history' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const fixture = [JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0,
    cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0 }), ...source.snapshotEvents().map(event => JSON.stringify(event)), ''].join('\n')
  try {
    await seedSession(scaffold, fixture, id)
    const page = await newEnglishPage(browser)
    const errors = watchConsole(page)
    await page.addInitScript((link) => {
      let pending: string | undefined = link
      Object.assign(window, { dshDesktop: { chats: {
        takePending: async () => { const value = pending; pending = undefined; return value },
        subscribe: () => () => {},
      } } })
    }, formatChatLink(id))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await expect.poll(() => page.locator('[data-conversation-session]').evaluateAll(nodes => nodes[0]?.getAttribute('data-conversation-session')), {
      timeout: 10_000,
    }).toBe(id)
    await page.getByText('Native source history', { exact: true }).waitFor()
    expect(errors.pageErrors).toEqual([])
  } finally { await browser.close(); await scaffold.close() }
}, 60_000)
