import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { packageRuntime, assembleManagedRelease } from '../../../scripts/extensions/managed-release.mjs';
import { canInstallManagedDependency, validateCatalog } from '../src/contracts.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('managed runtime packaging retains licence bytes and has deterministic archive identity', async () => {
  const files = { 'bin/typst': Buffer.from('executable'), LICENSE: Buffer.from('Apache licence'), NOTICE: Buffer.from('third party notices') };
  const first = await packageRuntime(files);
  const second = await packageRuntime(files);
  assert.equal(sha(first.bytes), sha(second.bytes));
  assert.equal(first.unpackedBytes, Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0));
  await assert.rejects(packageRuntime({ ...files, '../escape': Buffer.from('bad') }), /path/);
  await assert.rejects(packageRuntime({ 'bin/typst': files['bin/typst'] }), /licence/);
});

function report(platform, overrides = {}) {
  return { id: 'typst-runtime', version: '0.15.1', architecture: 'x64', source: 'https://github.com/typst/typst', sourceCommit: 'a'.repeat(40), license: 'Apache-2.0', provides: { typst: '0.15.1' }, platform,
    artifact: { assetName: `typst-${platform}.tgz`, bytes: 50, sha256: (platform === 'linux' ? 'b' : 'c').repeat(64), format: 'tar.gz', unpackedBytes: 100 },
    commands: { typst: platform === 'linux' ? 'bin/typst' : 'bin/typst.exe' },
    checks: ['archive-safety', 'version-probe', 'cancellation', 'removal', 'document-workflow'],
    evidence: 'https://github.com/arzvaak/Bharatcode-Harness/actions/runs/123', ...overrides };
}
test('catalog assembly requires both exact native runtime reports and the document workflow', () => {
  const reports = [report('linux'), report('win32')];
  const bundle = assembleManagedRelease(reports)[0];
  assert.equal(bundle.status, 'qualified');
  assert.deepEqual(bundle.platforms, ['linux', 'win32']);
  for (const invalid of [reports.slice(0, 1), [reports[0], reports[0]], [reports[0], report('win32', { sourceCommit: 'd'.repeat(40) })], [reports[0], report('win32', { checks: ['archive-safety', 'version-probe', 'cancellation', 'removal'] })]])
    assert.throws(() => assembleManagedRelease(invalid), /qualification/);
});

test('signed architecture restricts runtime setup and refuses unknown architecture values', () => {
  const bundle = assembleManagedRelease([report('linux'), report('win32')])[0];
  assert.equal(canInstallManagedDependency(bundle, 'linux', 'typst', '*', 'x64'), true);
  assert.equal(canInstallManagedDependency(bundle, 'linux', 'typst', '*', 'arm64'), false);
  assert.throws(() => validateCatalog({ schemaVersion: 1, revision: 1, channel: 'preview', entries: [], managedDependencies: [{ ...bundle, architecture: 'anything' }] }), /architecture/);
});

test('an explicit Linux release advertises only its verified native platform', () => {
  const bundle = assembleManagedRelease([report('linux')], ['linux'])[0];
  assert.deepEqual(bundle.platforms, ['linux']);
  assert.deepEqual(Object.keys(bundle.artifacts), ['linux']);
  assert.equal(canInstallManagedDependency(bundle, 'linux', 'typst', '*', 'x64'), true);
  assert.equal(canInstallManagedDependency(bundle, 'win32', 'typst', '*', 'x64'), false);
  for (const platforms of [[], ['darwin'], ['linux', 'linux']])
    assert.throws(() => assembleManagedRelease([report('linux')], platforms), /platform|qualification/);
  assert.throws(() => assembleManagedRelease([report('win32')], ['linux']), /qualification/);
  assert.throws(() => assembleManagedRelease([report('linux'), report('win32')], ['linux']), /qualification/);
});
