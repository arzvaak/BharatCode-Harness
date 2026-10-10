/** General chat folders, explicit Workspace membership, and workflow Files toggling. */
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it('keeps general chats independent and toggles Files with visible state', async () => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await expect.poll(() => scaffold.ctx.agents.list().length).toBe(1)
    const first = scaffold.ctx.agents.list()[0]!
    const firstFolder = first.session.header.cwd!
    expect(firstFolder.startsWith(join(scaffold.harnessHome, 'chats', 'chat-'))).toBe(true)
    expect((await stat(firstFolder)).isDirectory()).toBe(true)
    expect(scaffold.ctx.workspaceRegistry.list()).toHaveLength(0)

    await page.getByRole('button', { name: 'All chats', exact: true }).click()
    await expect.poll(() => page.getByRole('button', { name: 'All chats', exact: true }).getAttribute('aria-pressed')).toBe('true')
    await page.getByRole('button', { name: 'Workspaces', exact: true }).click()

    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Explicit project')
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
    await page.getByRole('menuitem').filter({ hasText: 'Explicit project' }).click()
    await expect.poll(() => workspace.sessionIds.length).toBe(1)
    expect(workspace.sessionIds).not.toContain(first.id)

    const count = scaffold.ctx.agents.list().length
    await page.locator('button').filter({ hasText: 'New Session' }).first().click()
    await expect.poll(() => scaffold.ctx.agents.list().length).toBe(count + 1)
    const newest = scaffold.ctx.agents.list().find(agent => agent.id !== first.id && !workspace.sessionIds.includes(agent.id))!
    expect(newest.session.header.cwd).not.toBe(firstFolder)
    expect(newest.session.header.cwd!.startsWith(join(scaffold.harnessHome, 'chats', 'chat-'))).toBe(true)
    expect(workspace.sessionIds).toHaveLength(1)

    await page.getByRole('button', { name: /^Research/ }).click()
    const files = page.getByRole('button', { name: 'Files', exact: true })
    await files.waitFor()
    await files.click()
    await expect.poll(() => files.getAttribute('aria-expanded')).toBe('true')
    expect(await files.getAttribute('aria-pressed')).toBe('true')
    await files.click()
    await expect.poll(() => files.getAttribute('aria-expanded')).toBe('false')
    const savedFolder = newest.session.header.cwd
    await scaffold.ctx.sessionController.create({ sessionId: newest.id })
    expect(newest.session.header.cwd).toBe(savedFolder)
    await page.reload({ waitUntil: 'load' })
    await page.locator(`[data-row-key="session:${newest.id}"][aria-selected="true"]`).waitFor()
    expect(newest.session.header.cwd).toBe(savedFolder)
    expect(scaffold.ctx.agents.list()).toHaveLength(count + 1)
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 120_000)
