/** Verify the Windows payload and actual installer locally under an isolated Wine prefix. */
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { readdirSync } from 'node:fs';

if (process.platform !== 'linux' || !process.env.WINEPREFIX) throw Error('Local Windows qualification requires Linux and an isolated WINEPREFIX');
const root = resolve(import.meta.dirname, '../..');
const artifacts = join(root, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts');
const application = join(artifacts, 'win-unpacked');
const windows = path => 'Z:' + path.split('/').join(String.fromCharCode(92));
const payloadLog = join(artifacts, 'windows-payload.log');
const output = openSync(payloadLog, 'w');
try {
  execFileSync('wine', [join(application, 'BharatCode.exe'), '--expose-internals',
    windows(join(root, 'apps/desktop/tests/fixtures/runtime-payload-smoke.mjs')),
    windows(join(application, 'resources/app.asar/dsh')), windows(join(application, 'resources/runtime'))], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', output, output], timeout: 180000,
  });
} finally { closeSync(output); }
const lines = readFileSync(payloadLog, 'utf8').split('\n');
const payload = lines.filter(line => line.startsWith('{')).map(line => JSON.parse(line.trim())).at(-1);
if (!payload || payload.platform !== 'win32' || !['koffi', 'sharp', 'html', 'pty', 'pnpm', 'grep', 'glob'].every(key => payload[key] === true)) throw Error('Windows payload checks did not all pass');
execFileSync(process.execPath, [join(root, 'scripts/extensions/smoke-windows-preview.mjs'), '--wine'], { env: process.env, stdio: 'inherit', timeout: 360000 });
const metadata = JSON.parse(readFileSync(join(artifacts, 'windows-preview-build.json')));
if (metadata.dirty !== false || !/^[a-f0-9]{40}$/.test(metadata.commit)) throw Error('A clean source-bound Windows build is required');
const assets = readdirSync(artifacts).filter(name => /\.(exe|blockmap)$/u.test(name)).map(name => {
  const bytes = readFileSync(join(artifacts, name));
  return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
if (assets.filter(asset => asset.name.endsWith('.exe')).length !== 1) throw Error('Exactly one Windows installer is required');
const report = { schemaVersion: 1, result: 'passed', execution: 'local-linux-wine', nativeWindowsVerified: false,
  commit: metadata.commit, version: metadata.version, signed: false, payload,
  desktop: JSON.parse(readFileSync(join(artifacts, 'windows-preview-smoke.json'))), assets,
  completedAt: new Date().toISOString() };
writeFileSync(join(artifacts, 'windows-qualification.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(artifacts, 'WINDOWS-SHA256SUMS'), assets.map(asset => `${asset.sha256}  ${asset.name}`).join('\n') + '\n');
console.log('Local Windows payload, installer, desktop and restart checks passed');
