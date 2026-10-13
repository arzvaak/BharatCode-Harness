/** Exercise a real sandboxed AppImage with an owned fresh profile and restart. */
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const version = JSON.parse(readFileSync(join(root, 'apps/desktop/.desktop-build/targets/linux-x64/artifacts/linux-preview-build.json'))).version;
const executable = join(root, `apps/desktop/.desktop-build/targets/linux-x64/artifacts/bharatcode-${version}-linux-x86_64.AppImage`);
const home = await mkdtemp(join(tmpdir(), 'bc-local-appimage-'));
const requests = [];
const modelServer = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/v1/models') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'qwen-3.8-27b', name: 'Qwen 3.8 27B' }, { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }] }));
    return;
  }
  let text = ''; for await (const chunk of request) text += chunk;
  const body = JSON.parse(text); requests.push(body);
  const reply = JSON.stringify(body.messages).includes('follow-up marker') ? 'GUARD_FOLLOWUP_OK' : 'GUARD_CHAT_OK';
  response.setHeader('Content-Type', 'text/event-stream');
  response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`);
});
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
async function launch(configured = false, chatLink) {
  console.log('AppImage smoke: launch');
  const child = spawn(executable, ['--ozone-platform=x11', '--remote-debugging-port=0', `--user-data-dir=${join(home, 'electron')}`, ...(chatLink ? [chatLink] : [])],
    { cwd: home, detached: true, stdio: 'ignore', env: { ...process.env, WAYLAND_DISPLAY: '',
      ...(configured ? { BHARATCODE_API_KEY: 'owned-chat-fixture-key' } : {}), DSH_HOME: join(home, 'home'), DSH_LOCALE: 'en', DSH_DESKTOP_WEB_PORT: '0' } });
  let launchError;
  child.once('error', error => { launchError = error; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    let timer;
    await Promise.race([closed, new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') { reject(error); return; } }
        void closed.then(resolve);
      }, 10000);
    })]);
    clearTimeout(timer);
  };
  try {
    const deadline = Date.now() + 60000;
    let endpoint;
    while (!endpoint && Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw Error(`AppImage exited before its window became available (${child.exitCode ?? child.signalCode})`);
      try {
        const [port, path] = String(await readFile(join(home, 'electron/DevToolsActivePort'))).trim().split('\n');
        endpoint = `ws://127.0.0.1:${port}${path}`;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!endpoint) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!endpoint) throw Error('AppImage window readiness timed out');
    const browser = await chromium.connectOverCDP(endpoint);
    console.log('AppImage smoke: connected');
    return { browser, stop: async () => { await stop(); await browser.close(); } };
  } catch (error) { await stop(); throw error; }
}
let copiedLink;
let sourceChat;
try {
  const first = await launch();
  try {
    let welcome;
    const deadline = Date.now() + 60000;
    while (!welcome && Date.now() < deadline) {
      welcome = first.browser.contexts()[0].pages().find(page => page.url().includes('welcome.html'));
      if (!welcome) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!welcome) throw Error('Native welcome did not open');
    await welcome.getByRole('button', { name: 'Get started', exact: true }).click();
    console.log('AppImage smoke: native welcome entered');
    const page = first.browser.contexts()[0].pages().find(page => page.url().startsWith('dsh-app://app/'));
    if (!page) throw Error('Workspace did not open');
    await page.setViewportSize({ width: 1280, height: 754 });
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Open app', exact: true }).click();
    const footer = page.getByRole('button', { name: 'Account menu', exact: true });
    await footer.waitFor();
    console.log('AppImage smoke: onboarding deferred');
    await footer.click();
    if (await page.getByRole('menuitem', { name: 'Feedback', exact: true }).count()) throw Error('External Feedback remains in the account menu');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'All chats', exact: true }).waitFor();
    if (await page.getByRole('treeitem').filter({ hasText: 'Default workspace' }).count()) throw Error('Fresh profile registered a default Workspace');
    await page.locator('[data-conversation-session]').waitFor();
    await page.locator('summary[aria-label="Tools & workflows"]').waitFor({ timeout: 90000 });
    if (await page.locator('details:has(summary[aria-label="Tools & workflows"]):not([open])').count()) {
      await page.locator('summary[aria-label="Tools & workflows"]').click();
    }
    await page.getByRole('button', { name: /^Research/ }).click();
    const files = page.getByRole('button', { name: 'Files', exact: true });
    await files.click();
    const filesDeadline = Date.now() + 10000;
    while (await files.getAttribute('aria-expanded') !== 'true' && Date.now() < filesDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (await files.getAttribute('aria-expanded') !== 'true') throw Error('Files did not expand');
    await files.click();
    const collapseDeadline = Date.now() + 10000;
    while (await files.getAttribute('aria-expanded') !== 'false' && Date.now() < collapseDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    if (await files.getAttribute('aria-expanded') !== 'false') throw Error('Files did not collapse on the second click');
    const footerDeadline = Date.now() + 10000;
    let footerText = (await footer.innerText()).trim();
    while (footerText !== 'User' && Date.now() < footerDeadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      footerText = (await footer.innerText()).trim();
    }
    if (footerText !== 'User') throw Error(`Missing-name footer differs from User: ${footerText}`);
    await page.getByRole('button', { name: 'Extensions', exact: true }).click();
    const store = page.locator('.bc-store');
    await store.locator('.bc-store-card').first().waitFor();
    await store.evaluate(element => { element.scrollTop = element.scrollHeight; });
    if (await store.evaluate(element => element.scrollTop) <= 0) throw Error('Extension page cannot scroll');
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search repository skills', exact: true }).waitFor();
    for (const height of [750, 480]) {
      await page.setViewportSize({ width: 1274, height });
      const before = await footer.boundingBox();
      await page.getByRole('button', { name: 'Extensions', exact: true }).evaluate(button => {
        let element = button.parentElement;
        while (element && getComputedStyle(element).overflowY !== 'auto') element = element.parentElement;
        if (!element) throw Error('Sidebar scroll viewport missing');
        element.scrollTop = element.scrollHeight;
      });
      const after = await footer.boundingBox();
      if (!after || after.y !== before.y || after.y + after.height > height) throw Error('Fixed footer moves or clips');
    }
  } finally { await first.stop(); }
  console.log('AppImage smoke: first instance stopped');
  await rm(join(home, 'electron/DevToolsActivePort'), { force: true });
  const profile = join(home, 'home/profiles/desktop');
  const yaml = require('js-yaml');
  const provider = yaml.load(readFileSync(join(root, 'integrations/provider-hub/cordis.patch.yml'), 'utf8')).find(row => row.id === 'llm-pi-ai').config.providers.bharatcode;
  const patches = yaml.load(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'));
  patches.push({ id: 'llm-pi-ai', config: { providers: { bharatcode: { ...provider, baseURL: `http://127.0.0.1:${modelServer.address().port}/v1` } } } });
  await writeFile(join(profile, 'cordis.patch.yml'), yaml.dump(patches));
  const second = await launch(true);
  try {
    let page;
    const deadline = Date.now() + 60000;
    while (!page && Date.now() < deadline) {
      page = second.browser.contexts()[0].pages().find(page => page.url().startsWith('dsh-app://app/'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw Error('Restarted workspace missing');
    await page.getByRole('button', { name: 'Account menu', exact: true }).waitFor({ timeout: 60000 });
    if (await page.locator('[data-desktop-onboarding]').count()) throw Error('Completed onboarding reappeared');
    await page.locator('summary[aria-label="Tools & workflows"]').waitFor({ timeout: 90000 });
    if (await page.locator('details:has(summary[aria-label="Tools & workflows"]):not([open])').count()) {
      await page.locator('summary[aria-label="Tools & workflows"]').click();
    }
    await page.getByRole('button', { name: /^Chat/ }).click();
    await page.locator('[data-conversation-session]').waitFor();
    const composer = page.locator('[data-composer-input][contenteditable="true"]').last();
    await composer.click();
    await composer.pressSequentially('Reply with the initial marker. Do not use tools.', { delay: 15 });
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('GUARD_CHAT_OK', { exact: true }).last().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Send message', exact: true }).waitFor();
    await composer.click();
    await composer.pressSequentially('Now reply with the follow-up marker. Do not use tools.', { delay: 15 });
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('GUARD_FOLLOWUP_OK', { exact: true }).last().waitFor({ timeout: 30000 });
    const chats = requests.filter(request => JSON.stringify(request.messages).includes('initial marker'));
    assert.ok(chats.length >= 2, 'Chat and follow-up must reach the model through all bundled plugins');
    assert.deepEqual(chats[0].chat_template_kwargs, { enable_thinking: true });
    assert.ok(chats[0].tools.length > 0, 'Full chat tool configuration must reach the adapter');
    console.log('AppImage smoke: full chat and follow-up completed through bundled plugins');
    sourceChat = await page.locator('[data-conversation-session]').getAttribute('data-conversation-session');
    await page.getByRole('button', { name: 'All chats', exact: true }).click();
    const row = page.locator(`[data-row-key="session:${sourceChat}"]`);
    await row.hover();
    await row.getByRole('button', { name: /^Session actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Copy chat link', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Chat link copied', exact: true }).waitFor();
    copiedLink = await page.evaluate(async () => navigator.clipboard.readText());
    assert.equal(copiedLink, `dsh://sessions/${sourceChat}`);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^New session$/i }).first().click();
    const targetDeadline = Date.now() + 30000;
    while (await page.locator('[data-conversation-session]').getAttribute('data-conversation-session') === sourceChat) {
      if (Date.now() > targetDeadline) throw Error('Copied-link target chat did not open');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await composer.fill(`Use this earlier chat as reference: ${copiedLink}`);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('GUARD_FOLLOWUP_OK', { exact: true }).last().waitFor({ timeout: 30000 });
    assert.ok(requests.some(request => JSON.stringify(request.messages).includes('referenced-sessions')
      && JSON.stringify(request.messages).includes('initial marker')), 'Copied chat history reaches the installed model adapter');
    console.log('AppImage smoke: copied chat link supplied real history to a new chat');


  } finally { await second.stop(); }
  await rm(join(home, 'electron/DevToolsActivePort'), { force: true });
  const linked = await launch(true, copiedLink);
  try {
    let page;
    const deadline = Date.now() + 60000;
    while (!page && Date.now() < deadline) {
      page = linked.browser.contexts()[0].pages().find(page => page.url().startsWith('dsh-app://app/'));
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!page) throw Error('Cold linked workspace missing');
    while (await page.locator('[data-conversation-session]').getAttribute('data-conversation-session') !== sourceChat) {
      if (Date.now() > deadline) throw Error('Cold private link failed to select its source chat');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await page.getByText('GUARD_CHAT_OK', { exact: true }).last().waitFor();
    console.log('AppImage smoke: cold private link opened the existing source chat');
  } finally { await linked.stop(); }
  console.log('Sandboxed AppImage: welcome, provider deferral, fixed footer, scrolling, Skills and restart passed.');
} finally { await new Promise(resolve => modelServer.close(resolve)); await rm(home, { recursive: true, force: true }); }
