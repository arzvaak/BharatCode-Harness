import { mkdir, writeFile, readdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { zipSync, strToU8 } from 'fflate';
import { ProjectStore, safeDirectory } from './projects.js';
import { PreviewServer } from './server.js';
import { compile } from './compiler.js';
import { viewerHTML } from './browser.js';

export async function browserExecutable(configured) {
  if (configured) { await access(configured); return configured; }
  for (const candidate of [chromium.executablePath(), '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    try { await access(candidate); return candidate; } catch {}
  }
  const cache = join(homedir(), '.cache', 'ms-playwright');
  for (const name of (await readdir(cache).catch(() => [])).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
    for (const executable of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const candidate = join(cache, name, executable);
      try { await access(candidate); return candidate; } catch {}
    }
  }
  throw Error('Chromium is required for renders and model exports. Set browserPath to an existing Playwright Chromium executable.');
}
function renderOptions(options) {
  const width = options.width ?? 960, height = options.height ?? 640, time = options.time ?? 0;
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096)) throw Error('Render dimensions must be integers between 64 and 4096');
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > 86400) throw Error('Time must be between 0 and 86400 seconds');
  return {width, height, time};
}
export class Studio {
  constructor({directory, browserPath} = {}) {
    this.directory = resolve(directory); this.browserPath = browserPath;
    this.projects = new ProjectStore(join(this.directory, 'projects'));
    this.server = new PreviewServer(); this.activeBrowsers = new Set(); this.closed = false; this.abort = new AbortController();
  }
  async snapshot(scope, id, engine, signal) {
    if (this.closed) throw Error('3D toolkit is closed');
    signal=signal?AbortSignal.any([signal,this.abort.signal]):this.abort.signal;
    signal.throwIfAborted();
    const project = await this.projects.get(scope, id, engine);
    const key = `${this.projects.owner(scope)}/${id}/${project.revision}`;
    // Compile per operation so an aborted caller never poisons a shared build.
    const script = await compile(project, signal);
    signal.throwIfAborted();
    const html = viewerHTML(project.title);
    const url = await this.server.publish(key, html, script);
    return {project, script, html, url};
  }
  async preview(scope, id, engine, options = {}) {
    const snapshot = await this.snapshot(scope, id, engine, options.signal);
    return {projectId: id, engine, revision: snapshot.project.revision, url: snapshot.url};
  }
  async withPage(snapshot, options, action) {
    options={...options,signal:options.signal?AbortSignal.any([options.signal,this.abort.signal]):this.abort.signal};
    const {width, height, time} = renderOptions(options);
    options.signal?.throwIfAborted();
    const browser = await chromium.launch({executablePath: await browserExecutable(this.browserPath), headless: true,
      args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    this.activeBrowsers.add(browser);
    let failure;
    const abort = () => { failure = options.signal?.reason ?? Error('Render aborted'); void browser.close(); };
    const deadline = setTimeout(() => { failure = Error('3D render deadline exceeded'); void browser.close(); }, 45000);
    options.signal?.addEventListener('abort', abort, {once: true});
    try {
      options.signal?.throwIfAborted();
      const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 1, acceptDownloads: false, serviceWorkers: 'block'});
      // Even if generated code changes page CSP, its network remains limited to this snapshot.
      const permitted = new Set([snapshot.url, new URL('app.js', snapshot.url).href]);
      await context.route('**/*', route => permitted.has(route.request().url()) ? route.continue() : route.abort());
      const page = await context.newPage();
      let moduleError;
      page.on('pageerror', error=>{moduleError=error;});
      page.setDefaultTimeout(30000);
      await page.goto(snapshot.url, {waitUntil: 'load'});
      if(moduleError) throw Error(`Scene module failed: ${moduleError.message}`);
      await page.waitForFunction(() => window.BC3D?.ready || window.BC3D?.error);
      const error = await page.evaluate(() => window.BC3D.error);
      if (error) throw Error(`Scene initialization failed: ${error}`);
      const metrics = await page.evaluate(time => window.BC3D.step(time), time);
      if (!metrics.meshes) throw Error('Scene contains no renderable meshes');
      return await action(page, metrics);
    } catch (error) { throw failure ?? error; }
    finally { clearTimeout(deadline); options.signal?.removeEventListener('abort', abort); this.activeBrowsers.delete(browser); await browser.close(); }
  }
  async saveOutput(scope, project, extension, bytes) {
    const directory = join(this.projects.path(scope, project.id), 'exports');
    await safeDirectory(directory);
    const path = join(directory, `r${project.revision}-${randomUUID()}.${extension}`);
    await writeFile(path, bytes, {flag: 'wx', mode: 0o600});
    return {path, bytes: bytes.length, revision: project.revision, projectId: project.id, engine: project.engine};
  }
  async render(scope, id, engine, options = {}) {
    renderOptions(options); options.signal?.throwIfAborted();
    const snapshot = await this.snapshot(scope, id, engine, options.signal);
    const result = await this.withPage(snapshot, options, async (page, metrics) => ({bytes: await page.locator('canvas').first().screenshot({type: 'png', timeout: 10000}), metrics}));
    const saved = await this.saveOutput(scope, snapshot.project, 'png', result.bytes);
    return {...saved, ...result};
  }
  async export(scope, id, engine, options = {}) {
    const format = options.format ?? 'glb';
    if (!['glb', 'source', 'viewer', ...(engine === 'babylon' ? ['babylon'] : [])].includes(format)) throw Error('Unsupported export format');
    renderOptions(options); options.signal?.throwIfAborted();
    if(this.closed) throw Error('3D toolkit is closed');
    const snapshot = format==='source' ? {project:await this.projects.get(scope,id,engine)} : await this.snapshot(scope, id, engine, options.signal);
    let bytes, extension;
    if (format === 'source' || format === 'viewer') {
      const {source, ...manifest} = snapshot.project;
      const files = {'scene.tsx': strToU8(source), 'project.json': strToU8(JSON.stringify(manifest, null, 2)),
        'README.txt': strToU8('Editable BharatCode 3D project. scene.tsx exports createScene({canvas,width,height}). Reimport the source with the matching engine. Viewer exports contain a bundled offline index.html; open it in a browser. No CDN or server is required.\n')};
      if (format === 'viewer') {files['index.html'] = strToU8(viewerHTML(snapshot.project.title, snapshot.script.toString())); files['app.js'] = snapshot.script;}
      bytes = Buffer.from(zipSync(files, {level: 6})); extension = 'zip';
    } else {
      const value = await this.withPage(snapshot, options, page => page.evaluate(format => window.BC3D.export(format), format));
      bytes = format === 'babylon' ? Buffer.from(value) : Buffer.from(value, 'base64'); extension = format;
      if (bytes.length > 64 * 1024 * 1024) throw Error('Model export exceeds 64 MiB');
    }
    return {...await this.saveOutput(scope, snapshot.project, extension, bytes), format};
  }
  async close() { this.closed = true; this.abort.abort(Error('3D toolkit closed; operation aborted')); await Promise.allSettled([...this.activeBrowsers].map(browser => browser.close())); this.activeBrowsers.clear(); await this.server.close(); }
}
