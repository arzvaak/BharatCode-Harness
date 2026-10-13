/** Research source tools and fresh workspace chats share the live UI state. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

it('retains Research for fresh workspace chats and shows sources added through tools', async () => {
  const scaffold = await launchWebScaffold({ firstUse: true })
  const browser = await chromium.launch()
  try {
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[data-conversation-session]').waitFor()
    await page.getByRole('button', { name: 'Workspaces', exact: true }).click()
    const project = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd, 'Research regression')
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
    await page.getByRole('menuitem').filter({ hasText: 'Research regression' }).click()
    await expect.poll(() => project.sessionIds.length).toBe(1)
    await page.getByRole('navigation', { name: 'Workflows', exact: true }).getByRole('button', { name: 'Coding', exact: true }).click()
    await expect.poll(() => project.sessionIds.length).toBe(2)
    await page.getByRole('navigation', { name: 'Workflows', exact: true }).getByRole('button', { name: 'Research', exact: true }).click()
    await expect.poll(() => project.sessionIds.length).toBe(3)
    const existing = [...project.sessionIds]
    const previous = await page.locator('[data-conversation-session]').getAttribute('data-conversation-session')
    await page.locator('[data-row-key^="workspace:"]').filter({ hasText: 'Research regression' }).hover()
    await page.getByRole('button', { name: 'New session in Research regression', exact: true }).click()
    await expect.poll(() => project.sessionIds.length).toBe(4)
    await expect.poll(() => page.locator('[data-conversation-session]').getAttribute('data-conversation-session')).not.toBe(previous)
    const current = await page.locator('[data-conversation-session]').getAttribute('data-conversation-session')
    expect(existing).not.toContain(current)
    await expect.poll(() => page.getByRole('navigation', { name: 'Workflows', exact: true }).getByRole('button', { name: 'Research', exact: true }).getAttribute('aria-current')).toBe('page')
    await page.getByRole('button', { name: 'Sources', exact: true }).click()
    await writeFile(join(scaffold.workspaceCwd, 'tool-source.md'), 'Evidence added through the model tool')
    const agent = scaffold.ctx.agents.list().find(value => value.id === current)!
    expect(agent).toBeDefined()
    const result = await scaffold.ctx.tools.execute({ name: 'project_sources',
      arguments: { action: 'register', input: { path: 'tool-source.md', title: 'Tool source regression' } },
      agent, callId: ToolCallId('research-source-regression'), signal: new AbortController().signal })
    expect(result.isError, JSON.stringify(result.content)).toBe(false)
    await page.getByRole('button', { name: 'Tool source regression', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Tool source regression', exact: true }).click()
    await page.getByText('Evidence added through the model tool', { exact: true }).waitFor()
    await page.reload({ waitUntil: 'load' })
    await expect.poll(() => page.getByRole('navigation', { name: 'Workflows', exact: true }).getByRole('button', { name: 'Research', exact: true }).getAttribute('aria-current')).toBe('page')
    expect(await page.locator('[data-conversation-session]').getAttribute('data-conversation-session')).toBe(current)
    await page.getByRole('navigation', { name: 'Workflows', exact: true }).getByRole('button', { name: 'Coding', exact: true }).click()
    await page.getByRole('navigation', { name: 'Workflows', exact: true }).getByRole('button', { name: 'Research', exact: true }).click()
    await expect.poll(() => page.locator('[data-conversation-session]').getAttribute('data-conversation-session')).toBe(current)
    expect(tripwire.pageErrors).toEqual([])
  } finally { await browser.close(); await scaffold.close() }
}, 120_000)
