import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ManagedDependencyStore } from '../../integrations/extension-store/src/managed-dependencies.js';
import { probeCommand } from '../../integrations/extension-store/src/dependencies.js';
import { verifyCatalog, REQUIRED_MANAGED_EVIDENCE } from '../../integrations/extension-store/src/contracts.js';
import { packageRuntime } from './managed-release.mjs';

const version = '0.15.1';
const sourceCommit = '9dfd3a08500b7896045f907433cf7b4b02434fad';
const pins = {
  linux: { triple: 'x86_64-unknown-linux-musl', suffix: 'tar.xz', bytes: 17462992, sha256: 'a6d077d0a95eed5a2eba715b2dae06be954f624ccbf85758a03f389ded33118c' },
  win32: { triple: 'x86_64-pc-windows-msvc', suffix: 'zip', bytes: 22463684, sha256: '19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736' },
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const packageRequire = createRequire(new URL('../../integrations/extension-store/package.json', import.meta.url));
const { Context } = await import(pathToFileURL(packageRequire.resolve('@deepseek-ai/cordis')).href);
const { LocalSubprocessRuntime } = await import(pathToFileURL(packageRequire.resolve('@deepseek-ai/dsh-subprocess-local')).href);
const platform = process.platform;
if (!pins[platform] || process.arch !== 'x64') throw Error('Qualification requires native Linux or Windows x64');
const pin = pins[platform];
const directory = await mkdtemp(join(tmpdir(), 'bc-managed-native-'));
const context = new Context();
try {
  await context.plugin(LocalSubprocessRuntime);
  const archiveName = `typst-${pin.triple}.${pin.suffix}`;
  const url = `https://github.com/typst/typst/releases/download/v${version}/${archiveName}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || Number(response.headers.get('content-length')) > pin.bytes) throw Error('Pinned upstream download failed');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > pin.bytes) throw Error('Pinned upstream download exceeds byte inventory');
    chunks.push(chunk);
  }
  const upstream = Buffer.concat(chunks);
  if (upstream.length !== pin.bytes || hash(upstream) !== pin.sha256) throw Error('Pinned upstream bytes changed');
  const upstreamPath = join(directory, archiveName);
  await writeFile(upstreamPath, upstream);
  const prefix = `typst-${pin.triple}`;
  const executable = platform === 'win32' ? 'typst.exe' : 'typst';
  const files = {};
  for (const name of [executable, 'LICENSE', 'NOTICE']) {
    // Read fixed members from hash-pinned upstream archives without extracting paths.
    const result = spawnSync('tar', ['-xOf', upstreamPath, `${prefix}/${name}`], { maxBuffer: 128 * 1024 * 1024, timeout: 30000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir() } });
    if (result.status !== 0 || !result.stdout?.length) throw Error('Pinned upstream runtime or notices missing');
    files[name === executable ? `bin/${name}` : name] = result.stdout;
  }
  assert.equal(hash(files.LICENSE), '62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a');
  files['UPSTREAM.json'] = Buffer.from(JSON.stringify({ version, sourceCommit, url, bytes: pin.bytes, sha256: pin.sha256 }) + '\n');
  const packed = await packageRuntime(files);
  const second = await packageRuntime(files);
  assert.equal(hash(packed.bytes), hash(second.bytes), 'Packing must reproduce exact bytes');
  const artifact = { assetName: `typst-runtime-${version}-${platform}-x64.tgz`, bytes: packed.bytes.length,
    sha256: hash(packed.bytes), format: 'tar.gz', unpackedBytes: packed.unpackedBytes };
  const evidence = process.env.GITHUB_RUN_ID
    ? `https://github.com/arzvaak/Bharatcode-Harness/actions/runs/${process.env.GITHUB_RUN_ID}`
    : 'https://github.com/typst/typst/releases/tag/v0.15.1';
  const bundle = { id: 'typst-runtime', version, architecture: 'x64', source: 'https://github.com/typst/typst', sourceCommit,
    license: 'Apache-2.0', status: 'qualified', platforms: [platform], provides: { typst: version }, artifacts: { [platform]: artifact },
    commands: { [platform]: { typst: `bin/${executable}` } }, qualificationEvidence: REQUIRED_MANAGED_EVIDENCE.map(check => ({ platform,
      sourceCommit, artifactSha256: artifact.sha256, check, result: 'passed', evidence })) };
  // This candidate is admitted only into the owned fixture. No production catalog is changed.
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, revision: 1, channel: 'preview', entries: [], managedDependencies: [bundle] }));
  const keys = generateKeyPairSync('ed25519');
  const catalog = verifyCatalog(bytes, sign(null, bytes, keys.privateKey).toString('base64'), keys.publicKey);
  const store = new ManagedDependencyStore({ directory: join(directory, 'profile'), platform, subprocess: context.subprocess,
    assetResolver: name => name === artifact.assetName ? { id: 1, size: artifact.bytes } : undefined,
    transport: { asset: async () => packed.bytes } });
  await store.load(catalog);
  await store.install(bundle);
  const command = await store.resolveCommand('typst');
  assert.equal((await probeCommand(command, ['--version'], { subprocess: context.subprocess })).version, version);
  await store.load(catalog);
  assert.equal(store.view().length, 1, 'Restart reloads the verified runtime');
  const source = join(directory, 'report.typ');
  await writeFile(source, '= BC managed runtime\nA reproducible report.\n$ x^2 + y^2 = z^2 $\n');
  for (const format of ['pdf', 'svg']) {
    const output = join(directory, `report.${format}`);
    const child = context.subprocess.spawn({ argv: [command, 'compile', '--ignore-system-fonts', source, output], cwd: directory,
      env: {}, stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }, graceMs: 500, signal: AbortSignal.timeout(30000) });
    try { assert.equal((await child.done).exitCode, 0, `Compile ${format}`); }
    finally { child.terminate(); await child.waitForExit(); }
    const rendered = await readFile(output);
    assert.ok(rendered.length > 1000);
    assert.match(rendered.toString('utf8'), format === 'pdf' ? /^%PDF-/ : /<svg/);
  }
  await store.remove(bundle.id, bundle.version);
  assert.equal(store.view().length, 0);
  await assert.rejects(stat(join(store.root, bundle.id, version)), { code: 'ENOENT' });
  const abort = new AbortController();
  store.probeRunner = async (command, args, options) => {
    const result = await probeCommand(command, args, options);
    abort.abort();
    return result;
  };
  await assert.rejects(store.install(bundle, abort.signal), /abort|cancel/i);
  assert.equal(store.view().length, 0);
  assert.equal((await readdir(store.root)).some(name => name.startsWith('.stage-')), false);
  const destination = resolve('dist/managed-dependencies');
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, artifact.assetName), packed.bytes);
  const report = { id: bundle.id, version, architecture: 'x64', source: bundle.source, sourceCommit, license: bundle.license,
    provides: bundle.provides, platform, artifact, commands: bundle.commands[platform], checks: [...REQUIRED_MANAGED_EVIDENCE, 'document-workflow'],
    evidence, hosted: Boolean(process.env.GITHUB_RUN_ID), upstream: { url, bytes: pin.bytes, sha256: pin.sha256 } };
  await writeFile(join(destination, `qualification-${platform}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`Native ${platform} Typst ${version}: reproducible archive, signed install/reload, PDF/SVG, cancellation and removal passed (${artifact.bytes} bytes).`);
} finally {
  await context.fiber.dispose();
  await rm(directory, { recursive: true, force: true });
}
