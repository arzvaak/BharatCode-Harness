#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const TOOLKIT = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(TOOLKIT, '../../..');
const SOURCE_COMMIT = process.env.SOURCE_COMMIT ?? 'aea4dfe0a988652c75a8c73f5fc58fee5ae79699';
const MAX_TAR_BYTES = 256 * 1024 * 1024;
const manifestAtRepo = JSON.parse(await readFile(join(TOOLKIT, '../package.json'), 'utf8'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(-4000)}`);
  }
  return result.stdout;
}

function outputPath() {
  const index = process.argv.indexOf('--out');
  return resolve(index >= 0 ? process.argv[index + 1] : join(REPO, 'dist/3d-toolkit/bharatcode-3d-toolkit-0.1.1-linux-x64.tgz'));
}

async function listFiles(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else result.push(path);
    }
  }
  await walk(root);
  return result;
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function gunzipBytes(path) {
  let bytes = 0;
  for await (const chunk of createReadStream(path).pipe(createGunzip())) bytes += chunk.length;
  return bytes;
}

async function packagePathFor(name, root) {
  return join(root, 'node_modules', ...name.split('/'), 'package.json');
}

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('This artifact is qualified only for Linux x64; package it on Linux x64.');
}
if (!/^[a-f0-9]{40}$/.test(SOURCE_COMMIT)) throw new Error('SOURCE_COMMIT must be a full Git commit SHA.');
const sourceTree = run('git', ['rev-parse', `${SOURCE_COMMIT}^{commit}`], { cwd: REPO }).trim();
if (sourceTree !== SOURCE_COMMIT) throw new Error(`Requested source commit is not present: ${SOURCE_COMMIT}`);

const temp = await mkdtemp(join(tmpdir(), 'bharatcode-3d-toolkit-release-'));
const archiveOut = outputPath();
const workRoot = join(temp, 'source');
const unpackRoot = join(temp, 'unpacked');
const npmPackDir = join(temp, 'npm-pack');
await mkdir(workRoot, { recursive: true });
await mkdir(unpackRoot, { recursive: true });
await mkdir(npmPackDir, { recursive: true });
try {
  const sourceArchive = run('git', ['archive', '--format=tar', SOURCE_COMMIT, 'integrations/3d-toolkit'], { cwd: REPO, encoding: null, maxBuffer: 32 * 1024 * 1024 });
  const sourceTar = join(temp, 'source.tar');
  await writeFile(sourceTar, sourceArchive, { mode: 0o600 });
  run('tar', ['-xf', sourceTar, '-C', workRoot]);
  const packageRoot = join(workRoot, 'integrations/3d-toolkit');
  const lockBytes = await readFile(join(packageRoot, 'package-lock.json'));
  const stagedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (stagedManifest.name !== manifestAtRepo.name || stagedManifest.version !== manifestAtRepo.version) throw new Error('Pinned package identity does not match this release script.');
  if (stagedManifest.engines?.dsh !== '>=0.2.0-rc.2 <0.3.0' || stagedManifest.engines?.node !== '>=24') throw new Error('Pinned host/runtime engine requirements changed; review before packaging.');

  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps'], { cwd: packageRoot, maxBuffer: 8 * 1024 * 1024 });
  run('npm', ['run', 'build'], { cwd: packageRoot, maxBuffer: 8 * 1024 * 1024 });
  const packText = run('npm', ['pack', '--json', '--pack-destination', npmPackDir], { cwd: packageRoot, maxBuffer: 32 * 1024 * 1024 });
  const pack = JSON.parse(packText)[0];
  const npmArchive = join(npmPackDir, pack.filename);
  run('tar', ['-xzf', npmArchive, '-C', unpackRoot]);
  const unpackedPackage = join(unpackRoot, 'package');

  const typeOnly = join(unpackedPackage, 'node_modules/@types/three');
  await rm(typeOnly, { recursive: true, force: true });
  for (const file of await listFiles(join(unpackedPackage, 'node_modules'))) {
    if (/\.(?:map|ts|mts|cts)$/u.test(file)) await rm(file, { force: true });
  }
  const allFiles = await listFiles(unpackedPackage);
  if (allFiles.some(file => /\.(?:map|ts|mts|cts)$/u.test(file))) throw new Error('Type/source-map files remain after pruning.');

  for (const [name, version] of Object.entries(stagedManifest.dependencies)) {
    const dependencyManifest = JSON.parse(await readFile(await packagePathFor(name, unpackedPackage), 'utf8'));
    if (dependencyManifest.name !== name || dependencyManifest.version !== version) {
      throw new Error(`Bundled dependency version mismatch: ${name} expected ${version}, found ${dependencyManifest.version}`);
    }
    const license = join(unpackedPackage, 'lib/licenses', `${name.replaceAll('/', '-')}-LICENSE`);
    await access(license, constants.R_OK);
  }
  const peerRoot = join(unpackedPackage, 'node_modules/@deepseek-ai/dsh-tools');
  try { await access(peerRoot); throw new Error('Host peer @deepseek-ai/dsh-tools must remain unbundled.'); } catch (error) { if (error.message.includes('must remain')) throw error; }
  const esbuildBin = join(unpackedPackage, 'node_modules/@esbuild/linux-x64/bin/esbuild');
  await access(esbuildBin, constants.X_OK);
  const wasmFiles = allFiles.filter(file => file.endsWith('.wasm'));
  if (!wasmFiles.length) throw new Error('Expected bundled WebAssembly runtime files are missing.');

  await mkdir(dirname(archiveOut), { recursive: true });
  await rm(archiveOut, { force: true });
  run('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archiveOut, '-C', unpackRoot, 'package'], { maxBuffer: 8 * 1024 * 1024 });
  const archiveStats = await stat(archiveOut);
  const uncompressedBytes = await gunzipBytes(archiveOut);
  if (uncompressedBytes > MAX_TAR_BYTES) {
    throw new Error(`Expanded archive is ${uncompressedBytes} bytes, above the extension-store limit ${MAX_TAR_BYTES}.`);
  }
  const archiveEntries = run('tar', ['-tzf', archiveOut], { maxBuffer: 32 * 1024 * 1024 }).split('\n').filter(Boolean);
  const modulePackageCount = archiveEntries.filter(entry => /(?:^|\/)package\.json$/u.test(entry) && entry.startsWith('package/node_modules/')).length;
  if (!archiveEntries.includes('package/package.json') || !archiveEntries.includes('package/node_modules/@esbuild/linux-x64/bin/esbuild')) {
    throw new Error('Final archive is missing package metadata or the Linux x64 esbuild binary.');
  }

  const receipt = {
    receiptVersion: 1,
    package: `${stagedManifest.name}@${stagedManifest.version}`,
    sourceCommit: SOURCE_COMMIT,
    platform: 'linux-x64',
    nodeRequirement: stagedManifest.engines.node,
    dshRequirement: stagedManifest.engines.dsh,
    peerDependencies: stagedManifest.peerDependencies,
    directDependencies: stagedManifest.dependencies,
    packageLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
    artifact: {
      file: archiveOut,
      bytes: archiveStats.size,
      sha256: await sha256(archiveOut),
      decompressedTarBytes: uncompressedBytes,
      decompressedTarLimitBytes: MAX_TAR_BYTES,
      bundledPackageManifestCount: modulePackageCount,
      wasmFileCount: wasmFiles.length,
      esbuildBinary: 'package/node_modules/@esbuild/linux-x64/bin/esbuild',
    },
    exclusions: ['vendored .map, .ts, .mts, .cts sources', 'vendored @types/three (types only)', 'host peer @deepseek-ai/dsh-tools'],
    verification: ['exact dependency versions and per-dependency bundled license files', 'Linux x64 esbuild executable present', 'WASM files retained', 'archive expands below 256 MiB extension-store ceiling'],
    nodeVersion: process.version,
    npmVersion: run('npm', ['--version']).trim(),
  };
  await writeFile(`${archiveOut}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
