/** Record successful lane identity; GitHub artifact names/IDs are retained with the workflow run. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const lane = process.argv[2]
if (!['unit', 'linux', 'windows', 'live-provider'].includes(lane)) throw new Error('Expected a successful compatibility lane name')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const output = '.artifacts/compatibility'
mkdirSync(output, { recursive: true })
writeFileSync(join(output, `${lane}.json`), JSON.stringify({ schemaVersion: 1, forkSha: sha,
  acceptedUpstreamSha: JSON.parse(readFileSync('scripts/compatibility/baseline.json', 'utf8')).upstreamSha,
  node: process.version, packageManager: JSON.parse(readFileSync('package.json', 'utf8')).packageManager,
  lockfileSha256: createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
  lane, evidence: lane === 'live-provider' ? 'credentialed inference' : 'keyless deterministic checks',
  runId: process.env.GITHUB_RUN_ID ?? null, artifactName: `compatibility-${lane}-${process.env.GITHUB_SHA ?? sha}`,
  runUrl: process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
}, null, 2) + '\n')
