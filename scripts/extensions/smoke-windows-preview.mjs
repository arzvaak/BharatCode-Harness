/** Install the actual Windows preview and exercise fresh onboarding and restart. */
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const wine = process.platform === 'linux' && process.argv.includes('--wine');
if (process.platform !== 'win32' && !wine) throw Error('Windows preview smoke requires native Windows or explicit --wine');
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const artifacts = join(root, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts');
const installers = (await readdir(artifacts)).filter(name => name.endsWith('.exe'));
assert.equal(installers.length, 1);
const owned = await mkdtemp(join(wine ? join(process.env.WINEPREFIX, 'drive_c') : tmpdir(), 'bharatcode-windows-preview-'));
const windowsPath = path => wine && path.startsWith(join(process.env.WINEPREFIX, 'drive_c') + '/')
  ? 'C:' + path.slice(join(process.env.WINEPREFIX, 'drive_c').length).split('/').join(String.fromCharCode(92)) : path;
const install = join(owned, 'application');
const run = promisify(execFile);
await run(wine ? 'wine' : join(artifacts, installers[0]), [...(wine ? [join(artifacts, installers[0])] : []), '/S', `/D=${windowsPath(install)}`], { timeout: 300000 });
const executable = join(install, 'BharatCode.exe');
const profile = join(owned, 'electron');
async function launch(configured = false, chatLink) {
  const logPath = join(owned, 'wine-launch.log');
  const logFile = wine ? openSync(logPath, 'w') : undefined;
  const child = spawn(wine ? 'wine' : executable, [...(wine ? [executable] : []), '--remote-debugging-port=0', `--user-data-dir=${windowsPath(profile)}`, ...(chatLink ? [chatLink] : [])], {
    cwd: owned, env: { ...process.env, ...(configured ? { BHARATCODE_API_KEY: 'owned-chat-fixture-key' } : {}), DSH_HOME: windowsPath(join(owned, 'home')), DSH_LOCALE: 'en', DSH_DESKTOP_WEB_PORT: '0' },
    stdio: wine ? ['ignore', logFile, logFile] : ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  if (logFile !== undefined) closeSync(logFile);
  child.stdout?.on('data', chunk => { log += chunk; });
  child.stderr?.on('data', chunk => { log += chunk; });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  try {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw Error(`Application exited ${child.exitCode}: ${log}`);
      let endpoint;
      try {
        const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
        endpoint = `http://127.0.0.1:${port}`;
        if (!path) endpoint = undefined;
      } catch {}
      if (endpoint) {
        try { return { child, browser: await chromium.connectOverCDP(endpoint), log: () => wine ? readFileSync(logPath, 'utf8') : log }; } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error(`Application debugger unavailable: ${log}`);
  } catch (error) {
    await run('taskkill', ['/PID', String(child.pid), '/T', '/F']).catch(() => {});
    throw error;
  }
}
async function stop(session) {
  await session.browser.close();
  if (wine) await run('wineserver', ['-k']).catch(() => {});
  else await run('taskkill', ['/PID', String(session.child.pid), '/T', '/F']).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1000));
}
async function findPage(session, predicate) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const page = session.browser.contexts().flatMap(context => context.pages()).find(predicate);
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error(`Expected desktop page did not open: ${session.log()}`);
}
const checks = ['actual-installer', 'native-welcome', 'workspace', 'extensions', 'skills', 'restart'];
const first = await launch();
try {
  const welcome = await findPage(first, page => page.url().includes('welcome.html'));
  await welcome.getByRole('button', { name: 'Get started', exact: true }).click();
  const page = await findPage(first, page => page.url().startsWith('dsh-app://app/'));
  page.setDefaultTimeout(30000);
  await page.setViewportSize({ width: 1280, height: 754 });
  const start = page.getByRole('button', { name: 'Get started', exact: true });
  await Promise.race([start.waitFor({ timeout: 90000 }), page.getByRole('button', { name: 'Account menu', exact: true }).waitFor({ timeout: 90000 })]);
  if (await start.count()) {
    await start.click();
    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Open app', exact: true }).click();
    checks.push('provider-setup-deferral');
  }
  await page.locator('summary[aria-label="Tools & workflows"]').waitFor({ timeout: 90000 });
  if (await page.locator('details:has(summary[aria-label="Tools & workflows"]):not([open])').count()) {
    await page.locator('summary[aria-label="Tools & workflows"]').click();
  }
  await page.getByRole('button', { name: 'Chat', exact: true }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.locator('.bc-store-card').first().waitFor();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search repository skills', exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, 'windows-onboarding.png') });
} finally { await stop(first); }
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
try {
  const yaml = require('js-yaml');
  const desktopProfile = join(owned, 'home/profiles/desktop');
  const provider = yaml.load(readFileSync(join(root, 'integrations/provider-hub/cordis.patch.yml'), 'utf8')).find(row => row.id === 'llm-pi-ai').config.providers.bharatcode;
  const patches = yaml.load(await readFile(join(desktopProfile, 'cordis.patch.yml'), 'utf8'));
  patches.push({ id: 'llm-pi-ai', config: { providers: { bharatcode: { ...provider, baseURL: `http://127.0.0.1:${modelServer.address().port}/v1` } } } });
  await writeFile(join(desktopProfile, 'cordis.patch.yml'), yaml.dump(patches));
  let copiedLink;
  let sourceChat;
  const second = await launch(true);
  try {
    const page = await findPage(second, page => page.url().startsWith('dsh-app://app/'));
    await page.setViewportSize({ width: 1280, height: 754 });
    await page.locator('summary[aria-label="Tools & workflows"]').waitFor({ timeout: 90000 });
    await page.locator('summary[aria-label="Tools & workflows"]').click();
    assert.equal(await page.getByRole('button', { name: 'Get started', exact: true }).count(), 0);
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
    console.log('Windows smoke: full chat and follow-up completed through bundled plugins');
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
    console.log('Windows smoke: copied chat link supplied real history to a new chat');


  } finally { await stop(second); }
  await writeFile(join(profile, 'DevToolsActivePort'), '');
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
    console.log('Windows smoke: cold private link opened the existing source chat');
  } finally { await stop(linked); }
} finally { await new Promise(resolve => modelServer.close(resolve)); }
checks.push('copied-chat-reference', 'cold-chat-link');
await writeFile(join(artifacts, 'windows-preview-smoke.json'), JSON.stringify({ schemaVersion: 1,
  platform: 'win32', arch: 'x64', execution: wine ? 'wine-on-linux' : 'native-windows', result: 'passed', installer: installers[0],
  checks,
  completedAt: new Date().toISOString() }, null, 2) + '\n');
console.log('Windows preview installer, desktop onboarding and restart passed');
