/** Install the actual Windows preview and exercise fresh onboarding and restart. */
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

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
async function launch() {
  const logPath = join(owned, 'wine-launch.log');
  const logFile = wine ? openSync(logPath, 'w') : undefined;
  const child = spawn(wine ? 'wine' : executable, [...(wine ? [executable] : []), '--remote-debugging-port=0', `--user-data-dir=${windowsPath(profile)}`], {
    cwd: owned, env: { ...process.env, DSH_HOME: windowsPath(join(owned, 'home')), DSH_LOCALE: 'en', DSH_DESKTOP_WEB_PORT: '0' },
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
const checks = ['actual-installer', 'native-welcome', 'workspace', 'extensions', 'skills', 'persisted-onboarding-restart'];
const first = await launch();
try {
  const welcome = await findPage(first, page => page.url().includes('welcome.html'));
  await welcome.getByRole('button', { name: 'Get started', exact: true }).click();
  const page = await findPage(first, page => page.url().startsWith('dsh-app://app/'));
  page.setDefaultTimeout(30000);
  await page.setViewportSize({ width: 1280, height: 754 });
  const start = page.getByRole('button', { name: 'Get started', exact: true });
  await Promise.race([start.waitFor({ timeout: 90000 }), page.getByRole('button', { name: 'Chat', exact: true }).waitFor({ timeout: 90000 })]);
  if (await start.count()) {
    await start.click();
    await page.getByRole('button', { name: 'Set up later', exact: true }).click();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Open app', exact: true }).click();
    checks.push('provider-setup-deferral');
  }
  await page.getByRole('button', { name: 'Chat', exact: true }).waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.locator('.bc-store-card').first().waitFor();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search repository skills', exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, 'windows-onboarding.png') });
} finally { await stop(first); }
const second = await launch();
try {
  const page = await findPage(second, page => page.url().startsWith('dsh-app://app/'));
  await page.setViewportSize({ width: 1280, height: 754 });
  await page.getByRole('button', { name: 'Chat', exact: true }).waitFor({ timeout: 90000 });
  assert.equal(second.browser.contexts().flatMap(context => context.pages()).some(page => page.url().includes('welcome.html')), false);
  await page.screenshot({ path: join(artifacts, 'windows-restart.png') });
} finally { await stop(second); }
await writeFile(join(artifacts, 'windows-preview-smoke.json'), JSON.stringify({ schemaVersion: 1,
  platform: 'win32', arch: 'x64', execution: wine ? 'wine-on-linux' : 'native-windows', result: 'passed', installer: installers[0],
  checks,
  completedAt: new Date().toISOString() }, null, 2) + '\n');
console.log('Windows preview installer, desktop onboarding and restart passed');
