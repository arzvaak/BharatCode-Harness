/** Run only on a disposable trusted runner; App-authorized pushes trigger normal PR checks. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeDrift, prepareCandidate, reportMarkdown } from './upstream.mjs'

const repository = process.env.GITHUB_REPOSITORY
if (!repository || !process.env.GH_TOKEN || process.env.GITHUB_ACTIONS !== 'true') throw new Error('Candidate automation requires a trusted GitHub Actions runner and App token')
const root = process.cwd()
const run = (command, ...args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
run('git', 'fetch', '--prune', 'origin', '+refs/heads/master:refs/remotes/origin/master')
const report = computeDrift(root, 'upstream/master', 'origin/master')
if (report.commitCount === 0) { console.log('No upstream drift; candidate PR unchanged.'); process.exit(0) }
const branch = spawnSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', 'sync/upstream'], { encoding: 'utf8' })
if (branch.status === 0) {
  run('git', 'fetch', 'origin', 'refs/heads/sync/upstream:refs/remotes/origin/sync/upstream')
  run('git', 'checkout', '-b', 'sync/upstream', 'origin/sync/upstream')
} else if (branch.status !== 2) throw new Error('Could not inspect remote candidate branch')
const result = prepareCandidate(root, 'origin/master', 'upstream/master')
const temporary = mkdtempSync(join(tmpdir(), 'bharat-upstream-body-'))
try {
  const body = join(temporary, 'body.md')
  writeFileSync(body, reportMarkdown(result))
  if (result.status === 'conflict') {
    const title = 'Upstream integration blocked by conflicts'
    const issues = JSON.parse(run('gh', 'issue', 'list', '--repo', repository, '--state', 'open', '--json', 'number,title'))
    const existing = issues.find(issue => issue.title === title)
    if (existing) run('gh', 'issue', 'edit', String(existing.number), '--repo', repository, '--body-file', body)
    else run('gh', 'issue', 'create', '--repo', repository, '--title', title, '--body-file', body)
    console.error(`Upstream merge stopped: ${result.conflicts.join(', ')}`)
    process.exitCode = 1
  } else {
    if (result.status === 'ready') run('git', 'push', 'origin', 'HEAD:refs/heads/sync/upstream')
    const prs = JSON.parse(run('gh', 'pr', 'list', '--repo', repository, '--state', 'open', '--head', 'sync/upstream', '--json', 'number'))
    if (prs[0]) run('gh', 'pr', 'edit', String(prs[0].number), '--repo', repository, '--body-file', body)
    else run('gh', 'pr', 'create', '--repo', repository, '--base', 'master', '--head', 'sync/upstream', '--title', 'Integrate upstream DeepSeek Harness', '--body-file', body)
    console.log('Candidate PR prepared. Human approval and all required checks are required; no auto-merge.')
  }
} finally { rmSync(temporary, { recursive: true, force: true }) }
