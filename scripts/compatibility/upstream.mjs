/** Accepted-upstream tracking and merge-forward candidate preparation. Git commands never use a shell. */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const baselinePath = 'scripts/compatibility/baseline.json'
const registerPath = 'scripts/compatibility/behaviors.json'

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function sha(root, ref) {
  if (ref.startsWith('-')) throw new Error('invalid Git ref')
  return git(root, 'rev-parse', '--verify', `${ref}^{commit}`)
}
function ancestor(root, earlier, later) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', earlier, later], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr || 'Git ancestry check failed')
  return result.status === 0
}
function lines(text) { return text === '' ? [] : text.split('\n') }
function jsonAt(root, ref, path) { return JSON.parse(git(root, 'show', `${ref}:${path}`)) }

/** Reject malformed records and acceptance of commits absent from the tested history. */
export function validateBaseline(root, baseline, head = 'HEAD') {
  if (baseline.schemaVersion !== 1) throw new Error('unsupported accepted-baseline version')
  for (const field of ['upstreamSha', 'forkSha']) {
    if (!/^[a-f0-9]{40}$/.test(baseline[field])) throw new Error(`invalid ${field}`)
    if (!ancestor(root, baseline[field], sha(root, head))) throw new Error(`${field} must be an ancestor of candidate HEAD`)
  }
}

/** Map upstream file/interface changes onto fork requirements; overlap alone is not compatibility evidence. */
export function computeDrift(root, upstreamRef, forkRef = 'HEAD') {
  const fork = sha(root, forkRef)
  const upstream = sha(root, upstreamRef)
  const baseline = jsonAt(root, fork, baselinePath)
  validateBaseline(root, baseline, fork)
  if (!ancestor(root, baseline.upstreamSha, upstream)) throw new Error('Upstream history changed; review required before changing the accepted baseline')
  const changedFiles = lines(git(root, 'diff', '--name-only', baseline.upstreamSha, upstream, '--'))
  const ours = new Set(lines(git(root, 'diff', '--name-only', baseline.upstreamSha, fork, '--')))
  const behaviors = jsonAt(root, fork, registerPath)
  return {
    acceptedUpstream: baseline.upstreamSha, upstreamSha: upstream, forkSha: fork,
    commitCount: Number(git(root, 'rev-list', '--count', `${baseline.upstreamSha}..${upstream}`)),
    commits: lines(git(root, 'log', '--format=%h %s', `${baseline.upstreamSha}..${upstream}`)),
    changedFiles, overlap: changedFiles.filter(path => ours.has(path)),
    affectedBehaviors: behaviors.filter(behavior => changedFiles.some(path =>
      behavior.upstreamPaths.some(prefix => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)),
    )).map(behavior => behavior.id),
    dependencyOrConfigChanges: changedFiles.filter(path => /(?:package\.json|pnpm-(?:lock|workspace)\.yaml|\.patch\.yml|tsconfig[^/]*\.json)$/.test(path)),
  }
}

/** Merge trunk and upstream into one candidate, abort conflicts, and never rewrite existing candidate commits. */
export function prepareCandidate(root, forkRef, upstreamRef) {
  if (git(root, 'status', '--porcelain') !== '') throw new Error('Candidate preparation requires a clean checkout')
  const report = computeDrift(root, upstreamRef, forkRef)
  if (report.commitCount === 0) return { ...report, status: 'unchanged' }
  const previous = spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/sync/upstream'], { cwd: root })
  if (previous.status === 0) git(root, 'checkout', 'sync/upstream')
  else git(root, 'checkout', '-b', 'sync/upstream', report.forkSha)
  const before = git(root, 'rev-parse', 'HEAD')
  for (const ref of [report.forkSha, report.upstreamSha]) {
    const merge = spawnSync('git', ['merge', '--no-edit', ref], { cwd: root, encoding: 'utf8' })
    if (merge.status === 0) continue
    const conflicts = lines(git(root, 'diff', '--name-only', '--diff-filter=U'))
    if (conflicts.length === 0) throw new Error(merge.stderr || merge.stdout || 'Merge failed')
    git(root, 'merge', '--abort')
    return { ...report, status: 'conflict', conflicts }
  }
  const path = join(root, baselinePath)
  const baseline = JSON.parse(readFileSync(path, 'utf8'))
  if (baseline.upstreamSha !== report.upstreamSha) {
    baseline.upstreamSha = report.upstreamSha
    baseline.forkSha = report.forkSha
    baseline.packageManager = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager
    baseline.lockfileSha256 = createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex')
    baseline.artifacts = []
    baseline.evidence = 'Candidate acceptance is pending all required checks and human PR review.'
    writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n')
    git(root, 'add', '--', baselinePath)
    git(root, 'commit', '-m', `compat: accept upstream ${report.upstreamSha.slice(0, 12)} after reviewed integration`)
  }
  validateBaseline(root, baseline)
  return { ...report, status: before === git(root, 'rev-parse', 'HEAD') ? 'unchanged' : 'ready', candidateSha: git(root, 'rev-parse', 'HEAD') }
}

/** Render review evidence and a bounded repair brief without interpreting commit text as executable input. */
export function reportMarkdown(report) {
  const list = values => values.length ? values.map(value => `- ${value.replaceAll('`', '')}`).join('\n') : '- None'
  return `## Upstream integration\n\nAccepted upstream: \`${report.acceptedUpstream}\`\n\nCandidate upstream: \`${report.upstreamSha}\`\n\nFork base: \`${report.forkSha}\`\n\nStatus: **${report.status ?? 'tracked'}**; upstream commits: **${report.commitCount}**.\n\n### Affected fork behaviors\n\n${list(report.affectedBehaviors)}\n\n### File overlap (risk signal)\n\n${list(report.overlap)}\n\n### Dependency and configuration changes\n\n${list(report.dependencyOrConfigChanges)}\n\n### Conflicts\n\n${list(report.conflicts ?? [])}\n\n### Commits\n\n${list(report.commits)}\n\nRequired evidence: build + unit + config, Linux replay + web + desktop, Windows unsigned runtime, and fork compatibility. Check results appear on this PR; tracking alone proves no runtime behavior.\n\nRepair one behavior at a time: read its entry in scripts/compatibility/behaviors.json, inspect the relevant upstream diff, reproduce its failing test, implement the smallest repair, and report exact commands/results. Classify the cause against the prior fork and upstream under equivalent conditions. Never refresh snapshots, delete tests, or add broad exclusions to obtain green CI.\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode = 'report', upstream = 'upstream/master', fork = 'HEAD', output] = process.argv.slice(2)
  const root = process.cwd()
  if (mode === 'validate') validateBaseline(root, JSON.parse(readFileSync(join(root, baselinePath), 'utf8')))
  else {
    if (!['report', 'prepare'].includes(mode)) throw new Error('Expected report, prepare, or validate')
    const report = mode === 'prepare' ? prepareCandidate(root, fork, upstream) : computeDrift(root, upstream, fork)
    if (output) {
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
      writeFileSync(`${output}.md`, reportMarkdown(report))
    }
    console.log(JSON.stringify(report, null, 2))
  }
}
