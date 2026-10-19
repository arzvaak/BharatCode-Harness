import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
export class PreviewServer {
  constructor() { this.token = randomBytes(32).toString('hex'); this.pages = new Map(); this.starting = null; }
  async start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        let parsed;
        try {parsed = new URL(req.url, 'http://localhost');} catch {res.writeHead(400);res.end();return;}
        const path = parsed.pathname;
        const bytes = this.pages.get(path);
        const host = req.headers.host;
        if (host !== `127.0.0.1:${this.server.address().port}` || !['GET', 'HEAD'].includes(req.method) || !bytes) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, {'Content-Type': path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Content-Length': bytes.length,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; worker-src blob:; base-uri 'none'; form-action 'none'; object-src 'none'"});
        res.end(req.method === 'HEAD' ? undefined : bytes);
      });
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.origin = `http://127.0.0.1:${this.server.address().port}`; resolve(this.origin); });
    });
    return this.starting;
  }
  async publish(key, html, script) {
    await this.start();
    const prefix = `/${this.token}/${key}`;
    this.pages.set(`${prefix}/index.html`, Buffer.from(html));
    this.pages.set(`${prefix}/app.js`, script);
    while(this.pages.size>48) {this.pages.delete(this.pages.keys().next().value);}
    return `${this.origin}${prefix}/index.html`;
  }
  async close() { if (this.starting) await this.starting; this.pages.clear(); if (this.server) { this.server.closeAllConnections(); await new Promise(done => this.server.close(done)); } }
}
