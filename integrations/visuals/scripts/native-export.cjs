// Own one Electron session. This checks native export/clipboard delivery, not
// full application startup, provider generation or desktop installer signing.
const { app, BrowserWindow, clipboard } = require('electron');
const assert = require('node:assert/strict');
const { readFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { createServer } = require('node:http');
const profile = process.env.BC_VISUALS_PROFILE;
if (!profile) throw Error('Owned native fixture profile is required');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
let server, window;
const waitFor = async (read, label) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await read()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('Timed out: ' + label);
};
let timeout;
const deadline = new Promise((_resolve, reject) => {
  timeout = setTimeout(() => reject(Error('Native graphics deadline exceeded')), 90_000);
});
async function run() {
  await app.whenReady();
  const expected = JSON.parse(readFileSync(process.env.BC_VISUALS_EXPECTED, 'utf8'));
  const files = {
    '/': Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><title>BC owned graphics qualification</title><body><div id="root"></div><script src="/harness.js"></script><script src="/factory.js"></script></body></html>'),
    '/harness.js': readFileSync(process.env.BC_VISUALS_HARNESS),
    '/factory.js': readFileSync(join(__dirname, '../lib/client.js')),
    '/client.mermaid.js': readFileSync(join(__dirname, '../lib/client.mermaid.js')),
  };
  let diagramModuleRequests = 0;
  server = createServer((req, res) => {
    if (req.url === '/client.mermaid.js') diagramModuleRequests++;
    if (!files[req.url]) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'text/javascript');
    res.end(files[req.url]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({ show: true, width: 1000, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
      partition: 'bc-owned-native-visuals' } });
  const externalRequests = [];
  window.webContents.session.webRequest.onBeforeRequest((details, done) => {
    const admitted = details.url.startsWith(origin + '/') || details.url.startsWith('blob:' + origin + '/');
    if (!admitted) externalRequests.push(details.url);
    done({ cancel: !admitted });
  });
  const permissionAllowed = (permission) => ['clipboard-read', 'clipboard-sanitized-write'].includes(permission);
  window.webContents.session.setPermissionCheckHandler((wc, permission) => wc?.getURL().startsWith(origin + '/') && permissionAllowed(permission));
  window.webContents.session.setPermissionRequestHandler((wc, permission, callback) => callback(wc?.getURL().startsWith(origin + '/') && permissionAllowed(permission)));
  await window.loadURL(origin);
  window.focus();
  await waitFor(() => window.webContents.executeJavaScript("Boolean(document.querySelector('.dv-figure svg'))"), 'default chart');
  assert.equal(diagramModuleRequests, 0, 'charts do not load the diagram engine');
  for (const kind of ['chart', 'diagram']) {
    if (kind === 'diagram') {
      await window.webContents.executeJavaScript("document.querySelectorAll('.dv-gallery-nav button')[7].click()", true);
      await waitFor(() => window.webContents.executeJavaScript("Boolean(document.querySelector('.dv-figure[data-visual-kind=mermaid] svg'))"), 'local diagram');
    }
    const source = await window.webContents.executeJavaScript("document.querySelector('.dv-figure').textContent");
    assert.ok(source.length > 0);
    await clipboard.clear();
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.dv-figure button')].find(b=>b.textContent==='Copy source').click()", true);
    await waitFor(async () => (await clipboard.readText()).length > 0, kind + ' clipboard');
    const copied = await clipboard.readText();
    const nativeSource = process.platform === 'win32' ? expected[kind].replace(/\n/g, '\r\n') : expected[kind];
    assert.equal(copied, nativeSource, 'original source reaches native clipboard with platform line endings');
    const target = join(profile, kind + '.svg');
    let downloadStarted = false;
    const delivered = new Promise((resolve, reject) => {
      window.webContents.session.once('will-download', (_event, item) => {
        downloadStarted = true;
        assert.equal(item.getMimeType(), 'image/svg+xml');
        item.setSavePath(target);
        item.once('done', (_event, state) => state === 'completed' ? resolve() : reject(Error('Native download ' + state)));
      });
    });
    await window.webContents.executeJavaScript("[...document.querySelectorAll('.dv-figure button')].find(b=>b.textContent==='Export SVG').click()", true);
    await waitFor(async () => {
      const error = await window.webContents.executeJavaScript("document.querySelector('.dv-figure').textContent.includes('exportError')");
      if (error) throw Error(kind + ' SVG serializer reported failure');
      return downloadStarted;
    }, kind + ' native download start');
    await delivered;
    const svg = readFileSync(target, 'utf8');
    assert.match(svg, /<svg\b/);
    assert.match(svg, /viewBox=/);
    assert.ok(svg.length > 200);
    assert.doesNotMatch(svg, /<script\b|javascript:/i);
    console.log(JSON.stringify({ kind, nativeDownloadBytes: Buffer.byteLength(svg), nativeClipboardBytes: Buffer.byteLength(copied) }));
  }
  assert.equal(diagramModuleRequests, 1, 'diagram engine is served once from the bundled local module');
  assert.deepEqual(externalRequests, [], 'bundled graphics need no external download');
}
Promise.race([run(), deadline]).then(() => { process.exitCode = 0; }, error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  clearTimeout(timeout);
  window?.destroy();
  if (server) await new Promise(resolve => server.close(resolve));
  // The launcher removes the owned profile after Electron releases Windows locks.
  app.exit(process.exitCode ?? 1);
});
