import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { computeDrift, prepareCandidate, validateBaseline } from './upstream.mjs'

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'bharat-upstream-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'master')
  git('config', 'user.name', 'Compatibility test')
  git('config', 'user.email', 'compatibility@example.invalid')
  writeFileSync(join(root, 'shared.txt'), 'base\n')
  git('add', '.')
  git('commit', '-m', 'upstream base')
  const base = git('rev-parse', 'HEAD')
  mkdirSync(join(root, 'scripts/compatibility'), { recursive: true })
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lock\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.7.0' }))
  writeFileSync(join(root, 'scripts/compatibility/baseline.json'), JSON.stringify({ schemaVersion: 1, upstreamSha: base, forkSha: base }))
  writeFileSync(join(root, 'scripts/compatibility/behaviors.json'), JSON.stringify([
    { id: 'shared', upstreamPaths: ['shared.txt'], tests: [] },
    { id: 'model', upstreamPaths: ['packages/llm/'], tests: [] },
  ]))
  git('add', '.')
  git('commit', '-m', 'fork metadata')
  const fork = git('rev-parse', 'HEAD')
  git('branch', 'fork-base', fork)
  git('checkout', '-b', 'upstream-head', base)
  writeFileSync(join(root, 'shared.txt'), 'upstream changed\n')
  mkdirSync(join(root, 'packages/llm'), { recursive: true })
  writeFileSync(join(root, 'packages/llm/provider.txt'), 'changed interface\n')
  git('add', '.')
  git('commit', '-m', 'upstream update')
  const upstream = git('rev-parse', 'HEAD')
  git('checkout', 'master')
  return { root, git, base, fork, upstream }
}

test('drift starts at accepted upstream and maps interface changes without file overlap', t => {
  const r = repository(t)
  const report = computeDrift(r.root, 'upstream-head')
  assert.equal(report.acceptedUpstream, r.base)
  assert.equal(report.commitCount, 1)
  assert.deepEqual(report.affectedBehaviors, ['shared', 'model'])
  assert.equal(report.overlap.includes('packages/llm/provider.txt'), false)
})

test('candidate preserves upstream history, records acceptance and can be updated without rewriting', t => {
  const r = repository(t)
  assert.equal(prepareCandidate(r.root, 'fork-base', 'upstream-head').status, 'ready')
  assert.equal(r.git('branch', '--show-current'), 'sync/upstream')
  r.git('merge-base', '--is-ancestor', r.upstream, 'HEAD')
  const accepted = JSON.parse(readFileSync(join(r.root, 'scripts/compatibility/baseline.json'), 'utf8'))
  assert.equal(accepted.upstreamSha, r.upstream)
  assert.equal(accepted.forkSha, r.fork)
  const first = r.git('rev-parse', 'HEAD')
  assert.equal(prepareCandidate(r.root, 'fork-base', 'upstream-head').status, 'unchanged')
  assert.equal(r.git('rev-parse', 'HEAD'), first)
})

test('conflicts are reported and merge state is aborted without changing accepted metadata', t => {
  const r = repository(t)
  writeFileSync(join(r.root, 'shared.txt'), 'fork changed\n')
  r.git('add', '.')
  r.git('commit', '-m', 'fork behavior')
  r.git('branch', '-f', 'fork-base', 'HEAD')
  const result = prepareCandidate(r.root, 'fork-base', 'upstream-head')
  assert.equal(result.status, 'conflict')
  assert.deepEqual(result.conflicts, ['shared.txt'])
  assert.equal(JSON.parse(readFileSync(join(r.root, 'scripts/compatibility/baseline.json'), 'utf8')).upstreamSha, r.base)
  assert.throws(() => r.git('rev-parse', '--verify', 'MERGE_HEAD'))
})

test('baseline rejects an upstream commit absent from candidate history', t => {
  const r = repository(t)
  assert.throws(() => validateBaseline(r.root, { schemaVersion: 1, upstreamSha: r.upstream, forkSha: r.fork }), /ancestor/)
})

test('candidate refuses a dirty checkout', t => {
  const r = repository(t)
  writeFileSync(join(r.root, 'shared.txt'), 'work in progress\n')
  assert.throws(() => prepareCandidate(r.root, 'fork-base', 'upstream-head'), /clean/)
})
