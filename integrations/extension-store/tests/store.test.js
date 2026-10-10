import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { ExtensionStore } from "../src/store.js";
import { archive, managedArchive } from "./fixtures.js";
async function fixture({ platform = 'linux', dependencyProbeRunner, kind = 'native', dependencyIds = [], initialManagedBytes } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "bc-store-"));
  const bytes = archive({ name: "test-tool", version: "1.0.0" });
  const e = {
    id: "tool",
    name: "Tool",
    kind,
    version: "1.0.0",
    sourceCommit: "a".repeat(40),
    source: "https://github.com/test/tool",
    license: "MIT",
    scope: kind === 'mcp' ? 'session' : 'profile',
    platforms: [platform],
    bcVersion: "0.2.0-rc.2",
    status: "qualified",
    requirements: [],
    packageName: "test-tool",
    ...(kind === 'mcp' ? { tools: ['query'], runtime: { transport: 'stdio', command: 'python', args: ['-m', 'fixture_tool'] } } : {}),
    ...(dependencyIds.length ? { dependencyIds } : {}),
    qualification: { [platform]: ["packed-install", "lifecycle", "workflow"] },
    artifact: {
      assetId: 3,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
  e.qualificationEvidence = ['packed-install', 'lifecycle', 'workflow'].map(check => ({
    platform, check, sourceCommit: e.sourceCommit, artifactSha256: e.artifact.sha256,
    result: 'passed', evidence: 'https://github.com/arzvaak/Bharatcode-Harness/actions/runs/123',
  }));
  let managedBytes = initialManagedBytes;
  const managedBundle = managedBytes ? qualifiedManagedPython(platform, managedBytes) : undefined;
  const cat = Buffer.from(JSON.stringify({
      schemaVersion: 1,
      revision: 2,
      channel: "preview",
      entries: [e],
      ...(managedBundle ? { managedDependencies: [managedBundle] } : {}),
    }));
  const keys = generateKeyPairSync("ed25519");
  const signature = sign(null, cat, keys.privateKey).toString("base64");
  const installs = [];
  const transport = {
    request: async () =>
      Buffer.from(
        JSON.stringify([
          {
            tag_name: "extensions-preview-2",
            assets: [
              { name: "catalog.json", id: 1, size: cat.length },
              { name: "catalog.sig", id: 2, size: Buffer.from(signature).length },
              { name: `python-data-runtime-${platform}.tgz`, id: 4, size: managedBytes?.length ?? 1 },
            ],
          },
        ]),
      ),
    asset: async (id) => id === 1 ? cat : id === 2 ? Buffer.from(signature) : id === 4 ? managedBytes : bytes,
  };
  const manager = {
    installBundle: async (path, options) => {
      installs.push({ path, options });
      return { application: "applied" };
    },
    listBundles: () => [],
    setBundleEnabled: async () => ({ application: "applied" }),
  };
  const store = new ExtensionStore({
    directory: dir,
    transport,
    publicKey: keys.publicKey,
    manager,
    platform,
    bcVersion: "0.2.0-rc.2",
    dependencyProbeRunner,
  });
  return { dir, store, installs, transport, bytes, setManagedBytes(value) { managedBytes = value; } };
}
test("verifies release, caches signed bytes, installs exact package disabled", async () => {
  const { store, installs, bytes } = await fixture();
  await store.refresh();
  await store.install("tool");
  assert.equal(installs.length, 1);
  assert.equal(installs[0].options.enabled, false);
  assert.deepEqual(await readFile(installs[0].path), bytes);
  assert.equal(store.view().installed[0].id, "tool");
});
test("offline reads reverify signatures and tampered archives never reach installer", async () => {
  const { store, transport } = await fixture();
  await store.refresh();
  transport.asset = async () => Buffer.from("tampered");
  await assert.rejects(store.install("tool"), /integrity/);
  assert.equal(store.view().installed.length, 0);
  const offline = new ExtensionStore({
    ...store.options,
    transport: {
      request: async () => {
        throw Error("offline");
      },
    },
  });
  await offline.load();
  assert.equal(offline.view().catalog.revision, 2);
});
test("failed manager operation does not claim installation", async () => {
  const { store } = await fixture();
  await store.refresh();
  store.options.manager.installBundle = async () => ({
    application: "failed",
    error: { message: "failed" },
  });
  await assert.rejects(store.install("tool"), /failed/);
  assert.equal(store.view().installed.length, 0);
});
test("workspace activation persists without starting runtimes", async () => {
  const { store } = await fixture();
  await store.refresh();
  await store.install("tool");
  Object.assign(store.installed[0].descriptor, {
    scope: "session",
    kind: "mcp",
    tools: ["run"],
    runtime: { transport: "stdio", command: "node", args: ["fixture-only"] },
  });
  await store.activation("workspace-a", "tool", true);
  const reopened = new ExtensionStore(store.options);
  await reopened.load();
  assert.deepEqual(reopened.view().workspaceEnabled, [["workspace-a", "tool"]]);
  assert.equal(reopened.view().operations.length, 0);
});
test("declines downgrades and updates of enabled packages", async () => {
  const { store } = await fixture();
  await store.refresh();
  await store.install("tool");
  store.catalog.entries[0].version = "0.9.0";
  await assert.rejects(store.install("tool"), /downgrade/);
  store.catalog.entries[0].version = "1.1.0";
  store.installed[0].enabled = true;
  await assert.rejects(store.install("tool"), /Disable/);
});
test("awaits native persistence acknowledgement before completing activation", async () => {
  const { store } = await fixture();
  await store.refresh();
  await store.install("tool");
  Object.assign(store.installed[0].descriptor, {
    scope: "session",
    kind: "mcp",
    tools: ["run"],
    runtime: { transport: "stdio", command: "node", args: ["fixture-only"] },
  });
  let finish;
  let written = false;
  store.options.persistence = {
    write: async () => {
      await new Promise((r) => (finish = r));
      written = true;
    },
    read: async () => undefined,
  };
  const pending = store.activation("a", "tool", true);
  await new Promise((r) => setImmediate(r));
  assert.equal(written, false);
  finish();
  await pending;
  assert.equal(written, true);
});

function qualifiedManagedPython(platform, bytes) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const bundle = {
    id: 'python-data-runtime', version: '3.12.14',
    source: 'https://github.com/astral-sh/python-build-standalone', sourceCommit: 'b'.repeat(40),
    license: 'PSF-2.0', status: 'qualified', provides: { python: '3.12.14' }, platforms: [platform],
    artifacts: { [platform]: { assetName: `python-data-runtime-${platform}.tgz`, bytes: bytes.length, sha256, format: 'tar.gz', unpackedBytes: 4096 } },
    commands: { [platform]: { python: platform === 'win32' ? 'python.exe' : 'bin/python3' } },
  };
  bundle.qualificationEvidence = ['archive-safety', 'version-probe', 'cancellation', 'removal'].map(check => ({
    platform, check, sourceCommit: bundle.sourceCommit, artifactSha256: sha256,
    result: 'passed', evidence: 'https://github.com/arzvaak/Bharatcode-Harness/actions/runs/123',
  }));
  return bundle;
}

test('refresh binds signed managed artifact names and sizes to the release asset inventory', async () => {
  const bytes = managedArchive([{ path: 'runtime/python.exe', data: 'fixture-runtime' }]);
  const dependencyProbeRunner = async command => command.endsWith('python.exe')
    ? { available: true, version: '3.12.14' }
    : { available: false, reason: 'Executable not found' };
  const valid = await fixture({ platform: 'win32', dependencyProbeRunner, kind: 'mcp', dependencyIds: ['python'], initialManagedBytes: bytes });
  await valid.store.refresh();
  assert.equal(valid.store.dependencies.hasQualifiedBundle('python', '>=3.12.0'), true);
  assert.deepEqual(valid.store.releaseAssets.get('python-data-runtime-win32.tgz'), { id: 4, size: bytes.length });
  const offline = new ExtensionStore({
    ...valid.store.options,
    transport: {
      request: async () => { throw Error('offline'); },
      asset: async () => { throw Error('offline'); },
    },
  });
  await offline.load();
  assert.deepEqual(offline.releaseAssets.get('python-data-runtime-win32.tgz'), { id: 4, size: bytes.length });

  const mismatch = await fixture({ platform: 'win32', dependencyProbeRunner, kind: 'mcp', dependencyIds: ['python'], initialManagedBytes: bytes });
  mismatch.transport.request = async () => Buffer.from(JSON.stringify([{
    tag_name: 'extensions-preview-2',
    assets: [
      { name: 'catalog.json', id: 1, size: 1 },
      { name: 'catalog.sig', id: 2, size: 1 },
      { name: 'python-data-runtime-win32.tgz', id: 4, size: bytes.length + 1 },
    ],
  }]));
  await assert.rejects(mismatch.store.refresh(), /differs from the signed release inventory/);
  assert.equal(mismatch.store.catalog.revision, 1, 'a mismatched release must not replace the cached catalog');
});

test('managed Python setup requires one bundle for all Python modules used by an extension', async () => {
  const bytes = managedArchive([{ path: 'runtime/python.exe', data: 'fixture-runtime' }]);
  const dependencyProbeRunner = async (_command, args) => args[0] === '--version'
    ? { available: true, version: '3.12.14' }
    : { available: false, reason: 'Module not installed' };
  const { dir, store } = await fixture({
    platform: 'win32', dependencyProbeRunner, kind: 'mcp', dependencyIds: ['python', 'duckdb'], initialManagedBytes: bytes,
  });
  await store.refresh();
  await store.install('tool');
  await assert.rejects(store.installDependencies('tool'), /No single qualified managed runtime covers the Python requirements/);
  assert.equal(store.view().managedDependencies.length, 0);
  await assert.rejects(lstat(join(dir, 'managed-dependencies', 'python-data-runtime')), { code: 'ENOENT' });
});

test('managed runtime setup verifies the signed archive, probes its exact version, reuses it and removes it', async () => {
  const managed = managedArchive([{ path: 'runtime/python.exe', data: 'fixture-runtime' }]);
  let reportedVersion = '3.12.14';
  const dependencyProbeRunner = async command => command.endsWith('python.exe')
    ? { available: true, version: reportedVersion }
    : { available: false, reason: 'Executable not found' };
  const { dir, store, setManagedBytes } = await fixture({ platform: 'win32', dependencyProbeRunner, kind: 'mcp' });
  setManagedBytes(managed);
  await store.refresh();
  const extension = store.catalog.entries[0];
  extension.platforms = ['win32'];
  extension.qualificationEvidence.forEach(record => { record.platform = 'win32'; });
  extension.dependencyIds = ['python'];
  store.catalog.managedDependencies = [qualifiedManagedPython('win32', managed)];
  await store.dependencies.load(store.catalog);
  await store.install('tool');
  await store.installDependencies('tool');
  assert.equal(store.view().managedDependencies.length, 1);
  assert.equal(store.view().managedDependencies[0].provides.python, '3.12.14');
  assert.ok(await store.dependencies.resolveCommand('python'));
  reportedVersion = '3.12.15';
  await assert.rejects(store.installDependencies('tool'), /Remove the existing managed Python runtime/);
  reportedVersion = '3.12.14';
  await store.installDependencies('tool');
  assert.equal(store.view().managedDependencies.length, 1, 'repeat setup should reuse the verified runtime');
  store.installed[0].enabled = true;
  await assert.rejects(store.removeDependency('python-data-runtime', '3.12.14'), /Disable dependent extensions/);
  store.installed[0].enabled = false;
  const stale = join(dir, 'managed-dependencies', 'python-data-runtime', '3.12.13');
  await mkdir(stale, { recursive: true });
  await store.dependencies.load(store.catalog);
  assert.ok(store.view().managedDependencies.some(bundle => bundle.version === '3.12.13' && !bundle.verified));
  store.installed[0].enabled = true;
  await assert.rejects(store.removeDependency('python-data-runtime', '3.12.13'), /Disable dependent extensions/);
  store.installed[0].enabled = false;
  await store.removeDependency('python-data-runtime', '3.12.13');
  assert.equal(store.view().managedDependencies.length, 1, 'removing a stale version must preserve the verified version');
  await store.removeDependency('python-data-runtime', '3.12.14');
  assert.equal(store.view().managedDependencies.length, 0);
  await assert.rejects(lstat(join(dir, 'managed-dependencies', 'python-data-runtime')), { code: 'ENOENT' });
});

test('managed runtime installation rejects tampering and cancellation before files are activated', async () => {
  const bytes = managedArchive([{ path: 'runtime/python.exe', data: 'fixture-runtime' }]);
  const dependencyProbeRunner = async command => command.endsWith('python.exe')
    ? { available: true, version: '3.12.14' }
    : { available: false, reason: 'Executable not found' };
  const fixtureState = await fixture({ platform: 'win32', dependencyProbeRunner, kind: 'mcp' });
  const { dir, store, transport } = fixtureState;
  fixtureState.setManagedBytes(bytes);
  await store.refresh();
  const extension = store.catalog.entries[0];
  extension.platforms = ['win32'];
  extension.qualificationEvidence.forEach(record => { record.platform = 'win32'; });
  extension.dependencyIds = ['python'];
  store.catalog.managedDependencies = [qualifiedManagedPython('win32', bytes)];
  await store.dependencies.load(store.catalog);
  await store.install('tool');
  transport.asset = async id => id === 4 ? Buffer.from('tampered') : bytes;
  await assert.rejects(store.installDependencies('tool'), /integrity mismatch/);
  assert.equal(store.view().managedDependencies.length, 0);
  await assert.rejects(lstat(join(dir, 'managed-dependencies', 'python-data-runtime')), { code: 'ENOENT' });

  transport.asset = async (id, { signal } = {}) => id === 4 ? new Promise((resolve, reject) => {
    if (signal.aborted) reject(Error('download aborted'));
    else signal.addEventListener('abort', () => reject(Error('download aborted')), { once: true });
  }) : bytes;
  const pending = store.installDependencies('tool');
  await new Promise(resolve => setImmediate(resolve));
  const requestId = store.view().operations[0];
  assert.ok(requestId);
  assert.equal(store.cancel(requestId), true);
  await assert.rejects(pending, /abort|cancel/i);
  assert.equal(store.view().managedDependencies.length, 0);
  await assert.rejects(lstat(join(dir, 'managed-dependencies', 'python-data-runtime')), { code: 'ENOENT' });
});

test('managed runtime cancellation during version probing removes the staging tree', async () => {
  const bytes = managedArchive([{ path: 'runtime/python.exe', data: 'fixture-runtime' }]);
  const abort = new AbortController();
  const dependencyProbeRunner = async () => {
    abort.abort();
    return { available: true, version: '3.12.14' };
  };
  const { dir, store } = await fixture({ platform: 'win32', dependencyProbeRunner, initialManagedBytes: bytes });
  await store.refresh();
  await assert.rejects(store.dependencies.install(store.catalog.managedDependencies[0], abort.signal), /abort|cancel/i);
  assert.deepEqual(await readdir(join(dir, 'managed-dependencies')), []);
});

test('managed runtime archive links are refused before any runtime is activated', async () => {
  const malicious = managedArchive([{ path: 'runtime/python.exe', data: '', type: '2', link: '../../outside' }]);
  const dependencyProbeRunner = async command => command.endsWith('python.exe')
    ? { available: true, version: '3.12.14' }
    : { available: false, reason: 'Executable not found' };
  const { dir, store, setManagedBytes } = await fixture({ platform: 'win32', dependencyProbeRunner, kind: 'mcp' });
  setManagedBytes(malicious);
  await store.refresh();
  const extension = store.catalog.entries[0];
  extension.dependencyIds = ['python'];
  store.catalog.managedDependencies = [qualifiedManagedPython('win32', malicious)];
  await store.dependencies.load(store.catalog);
  await store.install('tool');
  await assert.rejects(store.installDependencies('tool'), /files and directories|unsafe|archive/i);
  assert.equal(store.view().managedDependencies.length, 0);
  await assert.rejects(lstat(join(dir, 'managed-dependencies', 'python-data-runtime')), { code: 'ENOENT' });
});

test('managed Windows archive rejects case collisions and unsafe path names', async () => {
  const cases = [
    [{ path: 'runtime/python.exe', data: 'fixture-runtime', mode: 0o755 }, { path: 'runtime/PYTHON.EXE', data: 'shadow', mode: 0o755 }],
    [{ path: 'runtime/dir/python.exe', data: 'fixture-runtime', mode: 0o755 }, { path: 'runtime/dir/CON.txt', data: 'reserved' }],
    [{ path: 'runtime/C:/outside.exe', data: 'escape', mode: 0o755 }],
  ];
  for (const entries of cases) {
    const bytes = managedArchive(entries);
    const dependencyProbeRunner = async command => command.endsWith('python.exe')
      ? { available: true, version: '3.12.14' }
      : { available: false, reason: 'Executable not found' };
    const { dir, store, setManagedBytes } = await fixture({ platform: 'win32', dependencyProbeRunner, kind: 'mcp' });
    setManagedBytes(bytes);
    await store.refresh();
    const extension = store.catalog.entries[0];
    extension.dependencyIds = ['python'];
    store.catalog.managedDependencies = [qualifiedManagedPython('win32', bytes)];
    await store.dependencies.load(store.catalog);
    await store.install('tool');
    await assert.rejects(store.installDependencies('tool'), /unsafe|duplicate|collision/i);
    assert.equal(store.view().managedDependencies.length, 0);
    await assert.rejects(lstat(join(dir, 'managed-dependencies', 'python-data-runtime', '3.12.14')), { code: 'ENOENT' });
  }
});

test('Linux restart reinstalls a package from reverified offline cache and clearCache removes that recovery path', async t => {
  const { dir, store, installs } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  store.options.manager.removeBundle = async () => ({ application: 'applied' });
  await store.refresh();
  await store.install('tool');
  await store.remove('tool');
  const offline = new ExtensionStore({ ...store.options, transport: {
    request: async () => { throw Error('offline'); }, asset: async () => { throw Error('offline'); },
  } });
  await offline.load();
  await offline.install('tool');
  assert.equal(installs.length, 2);
  assert.equal(offline.view().installed[0].enabled, false);
  await offline.remove('tool');
  await offline.clearCache();
  await assert.rejects(offline.install('tool'), /offline/);
  assert.equal(offline.view().installed.length, 0);
});

test('Linux cached package tampering never reaches the native manager', async t => {
  const { dir, store, installs } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await store.refresh();
  await store.install('tool');
  await writeFile(join(dir, 'archives', store.catalog.entries[0].artifact.sha256 + '.tgz'), 'tampered');
  store.options.transport.asset = async () => { throw Error('Network must not replace a tampered cache'); };
  await assert.rejects(store.install('tool'), /integrity/);
  assert.equal(installs.length, 1);
});

test('Linux managed runtime reinstalls from verified disk cache after restart and refuses cache tampering', async t => {
  const bytes = managedArchive();
  const dependencyProbeRunner = async () => ({ available: true, version: '3.12.14' });
  const { dir, store } = await fixture({ platform: 'linux', dependencyProbeRunner, initialManagedBytes: bytes });
  t.after(() => rm(dir, { recursive: true, force: true }));
  await store.refresh();
  const bundle = store.catalog.managedDependencies[0];
  await store.dependencies.install(bundle);
  await store.dependencies.remove(bundle.id, bundle.version);
  const offline = new ExtensionStore({ ...store.options, transport: {
    request: async () => { throw Error('offline'); }, asset: async () => { throw Error('offline'); },
  } });
  await offline.load();
  await offline.dependencies.install(offline.catalog.managedDependencies[0]);
  assert.equal(offline.view().managedDependencies[0].verified, true);
  await offline.dependencies.remove(bundle.id, bundle.version);
  await writeFile(join(dir, 'managed-dependency-cache', bundle.artifacts.linux.sha256 + '.tar.gz'), 'tampered');
  await assert.rejects(offline.dependencies.install(bundle), /integrity/);
  assert.equal(offline.view().managedDependencies.length, 0);
});

test('Linux declared upgrade preserves the previous descriptor and restart state while rollback remains unavailable', async t => {
  const { dir, store, transport, installs } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await store.refresh();
  await store.install('tool');
  const entry = store.catalog.entries[0];
  const upgrade = archive({ name: entry.packageName, version: '1.1.0' });
  entry.version = '1.1.0';
  entry.artifact = { ...entry.artifact, bytes: upgrade.length, sha256: createHash('sha256').update(upgrade).digest('hex') };
  entry.qualificationEvidence.forEach(record => { record.artifactSha256 = entry.artifact.sha256; });
  transport.asset = async () => upgrade;
  await assert.rejects(store.install('tool'), /migration declaration/);
  assert.equal(installs.length, 1);
  entry.updateFrom = ['1.0.0'];
  await store.install('tool');
  assert.equal(installs.length, 2);
  assert.equal(store.view().installed[0].descriptor.version, '1.1.0');
  assert.equal(store.view().installed[0].previous.version, '1.0.0');
  const reopened = new ExtensionStore(store.options);
  await reopened.load();
  assert.equal(reopened.view().installed[0].descriptor.version, '1.1.0');
  assert.equal(reopened.view().installed[0].enabled, false);
  await assert.rejects(reopened.rollback(), /reversible migration/);
});

test('Linux cancelled package download leaves no activation or installation and restart can retry', async t => {
  const { dir, store, transport, bytes, installs } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await store.refresh();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  transport.asset = async (_id, { signal }) => new Promise((_resolve, reject) => {
    started();
    signal.addEventListener('abort', () => reject(Error('download cancelled')), { once: true });
  });
  const pending = store.install('tool');
  await ready;
  const request = store.view().operations[0];
  assert.equal(store.cancel(request), true);
  await assert.rejects(pending, /cancel/);
  assert.equal(installs.length, 0);
  assert.equal(store.view().operations.length, 0);
  assert.equal(store.view().installed.length, 0);
  const reopened = new ExtensionStore(store.options);
  await reopened.load();
  transport.asset = async () => bytes;
  await reopened.install('tool');
  assert.equal(installs.length, 1);
  assert.equal(reopened.view().installed[0].enabled, false);
});
