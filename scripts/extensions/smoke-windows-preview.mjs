/** Install the actual Windows preview and exercise fresh onboarding and restart. */
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') throw Error('Windows preview smoke requires native Windows');
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const artifacts = join(root, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts');
const installers = (await readdir(artifacts)).filter(name => name.endsWith('.exe'));
assert.equal(installers.length, 1);
const owned = await mkdtemp(join(tmpdir(), 'bharatcode-windows-preview-'));
const install = join(owned, 'application');
const run = promisify(execFile);
await run(join(artifacts, installers[0]), ['/S', `/D=${install}`], { timeout: 300000 });
const executable = join(install, 'BharatCode.exe');
const profile = join(owned, 'electron');
async function launch() {
  const child = spawn(executable, ['--remote-debugging-port=0', `--user-data-dir=${profile}`], {
    cwd: owned, env: { ...process.env, DSH_HOME: join(owned, 'home'), DSH_LOCALE: 'en', DSH_DESKTOP_WEB_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
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
        try { return { child, browser: await chromium.connectOverCDP(endpoint), log: () => log }; } catch {}
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
  await run('taskkill', ['/PID', String(session.child.pid), '/T', '/F']).catch(() => {});
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
const first = await launch();
try {
  const welcome = await findPage(first, page => page.url().includes('welcome.html'));
  await welcome.getByRole('button', { name: 'Get started', exact: true }).click();
  const page = await findPage(first, page => page.url().startsWith('dsh-app://app/'));
  await page.getByText('Chat', { exact: true }).first().waitFor({ timeout: 90000 });
  await page.screenshot({ path: join(artifacts, 'windows-onboarding.png') });
} finally { await stop(first); }
const second = await launch();
try {
  const page = await findPage(second, page => page.url().startsWith('dsh-app://app/'));
  await page.getByText('Chat', { exact: true }).first().waitFor({ timeout: 90000 });
  assert.equal(second.browser.contexts().flatMap(context => context.pages()).some(page => page.url().includes('welcome.html')), false);
  await page.screenshot({ path: join(artifacts, 'windows-restart.png') });
} finally { await stop(second); }
await writeFile(join(artifacts, 'windows-preview-smoke.json'), JSON.stringify({ schemaVersion: 1,
  platform: 'win32', arch: 'x64', result: 'passed', installer: installers[0],
  checks: ['actual-installer', 'native-welcome', 'workspace', 'persisted-onboarding-restart'],
  completedAt: new Date().toISOString() }, null, 2) + '\n');
console.log('Windows preview installer, desktop onboarding and restart passed');
