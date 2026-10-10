/** Exercise a real sandboxed AppImage with an owned fresh profile and restart. */
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const version = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'))).version;
const executable = join(root, `apps/desktop/.desktop-build/targets/linux-x64/artifacts/bharatcode-${version}-linux-x86_64.AppImage`);
const home = await mkdtemp(join(tmpdir(), 'bc-local-appimage-'));
async function launch() {
  console.log('AppImage smoke: launch');
  const child = spawn(executable, ['--ozone-platform=x11', '--remote-debugging-port=0', `--user-data-dir=${join(home, 'electron')}`],
    { cwd: home, detached: true, stdio: 'ignore', env: { ...process.env, WAYLAND_DISPLAY: '',
      DSH_HOME: join(home, 'home'), DSH_LOCALE: 'en', DSH_DESKTOP_WEB_PORT: '0' } });
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
  const second = await launch();
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
  } finally { await second.stop(); }
  console.log('Sandboxed AppImage: welcome, provider deferral, fixed footer, scrolling, Skills and restart passed.');
} finally { await rm(home, { recursive: true, force: true }); }
