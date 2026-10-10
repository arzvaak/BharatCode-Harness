import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_LINUX_GATES, validateLocalRelease } from './local-release.mjs';

const commit = 'a'.repeat(40);
const artifact = { path: 'dist/app.AppImage', bytes: 123, sha256: 'b'.repeat(64) };
const receipt = () => ({ schemaVersion: 1, execution: 'local', platform: 'linux', arch: 'x64',
  commit, result: 'passed', gates: LOCAL_LINUX_GATES.map(id => ({ id, exitCode: 0 })), artifacts: [artifact] });

test('complete local evidence admits the exact tested source and artifact', () => {
  assert.equal(validateLocalRelease(receipt(), commit, () => artifact).result, 'passed');
});
test('failed, missing and duplicated release gates refuse publication', () => {
  for (const change of [r => { r.gates[0].exitCode = 1; }, r => { r.gates.pop(); }, r => { r.gates.push(r.gates[0]); }]) {
    const report = receipt(); change(report);
    assert.throws(() => validateLocalRelease(report, commit, () => artifact), /gate did not pass/);
  }
});
test('other source revisions and hosted reports cannot substitute for local gates', () => {
  assert.throws(() => validateLocalRelease(receipt(), 'c'.repeat(40), () => artifact), /stale/);
  assert.throws(() => validateLocalRelease({ ...receipt(), execution: 'github' }, commit, () => artifact), /stale/);
});
test('changed artifact bytes or hashes refuse publication', () => {
  for (const actual of [{ ...artifact, bytes: 124 }, { ...artifact, sha256: 'c'.repeat(64) }])
    assert.throws(() => validateLocalRelease(receipt(), commit, () => actual), /artifact changed/);
});
test('missing artifacts and paths outside the checkout refuse publication', () => {
  assert.throws(() => validateLocalRelease({ ...receipt(), artifacts: [] }, commit, () => artifact), /missing/);
  for (const path of ['/tmp/app', '../app'])
    assert.throws(() => validateLocalRelease({ ...receipt(), artifacts: [{ ...artifact, path }] }, commit, () => artifact), /path/);
});
