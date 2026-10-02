import assert from 'node:assert/strict'
import { test } from 'node:test'
import { providerInputs } from './live-provider.mjs'
import { verifyReleaseRun, verifyArtifactSet } from './release.mjs'

test('live inference cannot pass or self-skip without credentials', () => {
  assert.throws(() => providerInputs({}), /BHARATCODE_API_KEY is required/)
  assert.throws(() => providerInputs({ BHARATCODE_API_KEY: 'fixture', BHARATCODE_BASE_URL: 'http://example.invalid' }), /HTTPS/)
})
test('release requires a successful push workflow on the exact protected master commit', () => {
  const run = { conclusion: 'success', event: 'push', head_branch: 'master', head_sha: 'a'.repeat(40) }
  assert.doesNotThrow(() => verifyReleaseRun(run, 'a'.repeat(40)))
  for (const patch of [{ conclusion: 'failure' }, { conclusion: 'skipped' }, { event: 'pull_request' }, { head_sha: 'b'.repeat(40) }]) {
    assert.throws(() => verifyReleaseRun({ ...run, ...patch }, 'a'.repeat(40)))
  }
})
test('release refuses missing or expired platform artifacts', () => {
  const artifacts = ['unit', 'linux', 'windows'].map(lane => ({ id: lane, name: `compatibility-${lane}-${'a'.repeat(40)}`, expired: false }))
  assert.equal(verifyArtifactSet(artifacts, 'a'.repeat(40)).length, 3)
  assert.throws(() => verifyArtifactSet(artifacts.slice(0, 2), 'a'.repeat(40)), /windows/)
  assert.throws(() => verifyArtifactSet(artifacts.map(artifact => ({ ...artifact, expired: true })), 'a'.repeat(40)), /expired/)
})
