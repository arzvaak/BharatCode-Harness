/** Retain an internal unsigned release candidate only after exact-commit platform and live-provider checks. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Reject stale commits, skipped checks and runs that did not test protected trunk. */
export function verifyReleaseRun(run, sha) {
  assert.equal(run.head_sha, sha, 'Release check must match exact commit')
  assert.equal(run.head_branch, 'master', 'Release check must test protected master')
  assert.equal(run.event, 'push', 'Release check must be a trunk push')
  assert.equal(run.conclusion, 'success', 'Release compatibility workflow must succeed')
}
/** Require retained, non-expired evidence from every required platform lane. */
export function verifyArtifactSet(artifacts, sha) {
  return ['unit', 'linux', 'windows'].map(lane => {
    const artifact = artifacts.find(candidate => candidate.name === `compatibility-${lane}-${sha}`)
    assert.ok(artifact, `Missing ${lane} artifact`)
    assert.equal(artifact.expired, false, `${lane} artifact expired; rerun exact-commit checks`)
    return artifact
  })
}

function retainReleaseCandidate() {
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Release candidate retention runs only through the trusted manual workflow')
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const live = JSON.parse(readFileSync('.artifacts/compatibility/live-provider.json', 'utf8'))
  assert.equal(live.forkSha, sha, 'Live-provider evidence must match this candidate')
  assert.equal(live.evidence, 'credentialed inference')
  const runs = JSON.parse(gh('api', `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=master&event=push&per_page=100`)).workflow_runs
  const run = runs.find(candidate => candidate.conclusion === 'success')
  assert.ok(run, 'No successful protected-trunk compatibility workflow for this commit')
  verifyReleaseRun(run, sha)
  const checkRuns = JSON.parse(gh('api', `repos/${repository}/commits/${sha}/check-runs?per_page=100`)).check_runs
  assert.ok(checkRuns.some(check => check.name === 'fork compatibility' && check.conclusion === 'success' && check.app?.slug === 'github-actions'), 'Required aggregate check did not pass')
  const artifacts = verifyArtifactSet(JSON.parse(gh('api', `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`)).artifacts, sha)
  const output = '.artifacts/release-candidate'
  mkdirSync(output, { recursive: true })
  const attachments = []
  for (const artifact of artifacts) {
    const path = join(output, `${artifact.name}.zip`)
    const descriptor = openSync(path, 'wx')
    try { execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { stdio: ['ignore', descriptor, 'pipe'] }) }
    finally { closeSync(descriptor) }
    attachments.push(path)
    artifact.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  const manifest = join(output, 'release-evidence.json')
  writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, forkSha: sha,
    baseline: JSON.parse(readFileSync('scripts/compatibility/baseline.json', 'utf8')), compatibilityRunId: run.id,
    artifactIdentifiers: artifacts, liveProvider: live, classification: 'internal unsigned candidate; signing and installer verification required before public release',
  }, null, 2) + '\n')
  attachments.push(manifest)
  const notes = join(output, 'notes.md')
  writeFileSync(notes, `Internal compatibility candidate for ${sha}.\n\nLinux, Windows and web checks passed in workflow ${run.id}; credentialed inference passed in this manual workflow.\n\nThe Windows payload is unsigned. Linux retains the tested source, dependency closure, Electron and pinned runtime archive, not a distributable installer. Public release still requires native release packaging, signing and upgrade verification. Session/data migrations may prevent application-only rollback.\n`)
  gh('release', 'create', `compat-rc-${sha.slice(0, 12)}`, '--repo', repository, '--target', sha,
    '--prerelease', '--title', `Compatibility candidate ${sha.slice(0, 12)}`, '--notes-file', notes, ...attachments)
  console.log('Tagged internal compatibility candidate and retained exact-run artifacts; no public release.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) retainReleaseCandidate()
