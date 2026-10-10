/** Browser-check the published site's interactions and responsive layout using an owned fixture. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '../..');
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright');
const directory = await mkdtemp(join(tmpdir(), 'bc-marketing-'));
await cp(join(root, 'integrations/extension-store/site'), directory, { recursive: true });
const version = '0.2.0-rc.2.20261010.1';
const tag = `v${version}`;
const packages = Object.fromEntries(['rpm', 'deb', 'AppImage'].map(kind => { const name = `bharatcode-${version}-linux-x86_64.${kind}`; return [kind, { name, url: `https://github.com/arzvaak/BharatCode-Harness/releases/download/${tag}/${name}` }]; }));
await writeFile(join(directory, 'release.json'), JSON.stringify({ version, url: `https://github.com/arzvaak/BharatCode-Harness/releases/tag/${tag}`, packages }));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(directory, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(directory + '/')) { response.statusCode = 403; response.end(); return; }
    const bytes = await readFile(file); response.setHeader('Content-Type', types[extname(file)] ?? 'text/plain'); response.end(bytes);
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ colorScheme: 'light', viewport: { width: 1440, height: 1050 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByText(`Preview ${version}`, { exact: true }).waitFor();
  for (const mode of ['Chat', 'Coding', 'Research', 'Writing']) {
    const tab = page.getByRole('tab').filter({ hasText: mode }); await tab.click();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('tabpanel').getAttribute('aria-labelledby'), await tab.getAttribute('id'));
  }
  const writing = page.getByRole('tab').filter({ hasText: 'Writing' }); await writing.press('ArrowRight');
  assert.equal(await page.getByRole('tab').filter({ hasText: 'Chat' }).getAttribute('aria-selected'), 'true');
  for (const kind of ['rpm', 'deb', 'AppImage']) assert.equal(await page.locator(`[data-package="${kind}"]`).getAttribute('href'), packages[kind].url);
  await page.getByRole('link', { name: 'Download .rpm', exact: true }).scrollIntoViewIfNeeded();
  await page.locator('article').filter({ has: page.getByRole('heading', { name: 'Fedora & RPM' }) }).getByText('Installation command', { exact: true }).click();
  await page.locator('[data-copy="rpm"]').click();
  await page.getByText('Installation command copied.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `sudo dnf install ./${packages.rpm.name}`);
  const evidence = join(root, 'dist/marketing-qualification'); await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, 'desktop.png'), fullPage: true });
  assert.equal(await page.getByRole('link', { name: 'View on GitHub', exact: true }).getAttribute('href'), 'https://github.com/arzvaak/BharatCode-Harness');
  await page.getByRole('button', { name: 'Use dark mode', exact: true }).click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
  assert.equal(await page.getByRole('button', { name: 'Use light mode', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: join(evidence, 'desktop-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByText(`Preview ${version}`, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile content overflows');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'Theme choice should survive navigation');
  await page.screenshot({ path: join(evidence, 'mobile-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Use light mode', exact: true }).click();
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.getByRole('tab').filter({ hasText: 'Research' }).click();
  await page.screenshot({ path: join(evidence, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const automatic = await browser.newContext({ colorScheme: 'dark' });
  const automaticPage = await automatic.newPage();
  await automaticPage.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await automaticPage.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await automaticPage.emulateMedia({ colorScheme: 'light' });
  await automaticPage.getByRole('button', { name: 'Use dark mode', exact: true }).waitFor();
  await automatic.close();
  const restricted = await browser.newContext({ colorScheme: 'dark' });
  await restricted.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw Error('Storage unavailable'); } }); });
  const restrictedPage = await restricted.newPage();
  await restrictedPage.goto(`http://127.0.0.1:${server.address().port}/`);
  await restrictedPage.getByRole('button', { name: 'Use light mode', exact: true }).click();
  assert.equal(await restrictedPage.evaluate(() => document.documentElement.dataset.theme), 'light');
  await restricted.close();
  for (const invalid of [{ version, url: 'https://malicious.invalid/', packages },
    { version, url: `https://github.com/arzvaak/BharatCode-Harness/releases/tag/${tag}`, packages: { ...packages, AppImage: { ...packages.AppImage, url: 'https://malicious.invalid/download' } } }]) {
    await page.unroute('**/release.json');
    await page.route('**/release.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invalid) }));
    await page.reload(); await page.getByRole('status').getByText(/Direct downloads are unavailable/).waitFor();
    for (const kind of ['rpm', 'deb', 'AppImage']) assert.equal(await page.locator(`[data-package="${kind}"]`).getAttribute('href'), 'https://github.com/arzvaak/BharatCode-Harness/releases');
  }
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ result: 'passed', workflows: true, keyboard: true, downloads: true, clipboard: true, mobile: true, rejectedInvalidRelease: true }, null, 2) + '\n');
  console.log('Marketing site: workflows, keyboard, downloads, clipboard, mobile layout, and invalid-release fallback passed');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
