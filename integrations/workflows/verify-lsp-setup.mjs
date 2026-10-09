/** Verify the generated setup against the real local language server without user accounts. */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const patch = JSON.parse(await readFile(new URL('./lsp-workspace.patch.yml', import.meta.url), 'utf8'));
const config = patch[0].config.servers.typescript;
const cwd = await mkdtemp(join(tmpdir(), 'bharatcode-lsp-'));
await writeFile(join(cwd, 'jsconfig.json'), JSON.stringify({ compilerOptions: { checkJs: true }, include: ['*.js'] }));
const child = spawn(config.command, config.args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = Buffer.alloc(0), id = 0;
const waiting = new Map(), diagnostics = new Map();
let stderr = '';
child.stderr.on('data', data => { stderr += data; });
child.stdout.on('data', data => {
  buffer = Buffer.concat([buffer, data]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
    buffer = buffer.subarray(end + 4 + length);
    if (message.id != null && waiting.has(message.id)) {
      const pending = waiting.get(message.id); waiting.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    }
    if (message.method === 'textDocument/publishDiagnostics') diagnostics.set(message.params.uri, message.params.diagnostics);
    if (message.id != null && message.method) send({ jsonrpc: '2.0', id: message.id, result: null });
  }
});
function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); child.stdin.write(body);
}
function request(method, params) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    waiting.set(requestId, { resolve, reject });
    send({ jsonrpc: '2.0', id: requestId, method, params });
  });
}
const timer = setTimeout(() => { console.error(stderr); child.kill(); process.exitCode = 1; }, 20000);
try {
  const rootUri = pathToFileURL(cwd).href;
  await request('initialize', { processId: process.pid, rootUri, capabilities: { workspace: { workspaceFolders: true, configuration: true }, textDocument: { synchronization: { dynamicRegistration: false }, publishDiagnostics: { relatedInformation: false } } }, initializationOptions: config.initializationOptions, workspaceFolders: [{ uri: rootUri, name: 'fixture' }] });
  send({ jsonrpc: '2.0', method: 'initialized', params: {} });
  for (const [filename, languageId, text] of [['a.ts', 'typescript', "const n: number = 'text';\n"], ['a.js', 'javascript', "// @ts-check\n/** @type {number} */\nconst n = 'text';\n"]]) {
    const uri = pathToFileURL(join(cwd, filename)).href;
    await writeFile(join(cwd, filename), text);
    send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId, version: 1, text } } });
    const deadline = Date.now() + 10000;
    while (!(diagnostics.get(uri)?.length) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(diagnostics.get(uri)?.some(item => item.code === 2322), `${filename}: expected real TypeScript type error`);
    const edits = await request('textDocument/formatting', { textDocument: { uri }, options: config.formattingOptions });
    assert.ok(Array.isArray(edits), `${filename}: formatting response`);
    console.log(`${filename}: real diagnostics code 2322 and formatting passed`);
  }
  await request('shutdown', null);
  send({ jsonrpc: '2.0', method: 'exit' });
} finally {
  clearTimeout(timer); child.kill(); await rm(cwd, { recursive: true, force: true });
}
