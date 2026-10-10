/** Controlled read-only account evidence using the installed distributable and native credentials. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const consumer = resolve(process.argv[2]);
let token = process.env.BC_QUALIFICATION_GITHUB_TOKEN;
delete process.env.BC_QUALIFICATION_GITHUB_TOKEN;
if (!token && process.argv.includes('--use-gh-session')) {
  token = (await promisify(execFile)('gh', ['auth', 'token'], { maxBuffer: 8192 })).stdout.trim();
}
if (!token) throw Error('Controlled GitHub qualification credential is required');
const load = relative => import(pathToFileURL(join(consumer, 'node_modules', relative)).href);
const { Context } = await load('@deepseek-ai/cordis/lib/index.js');
const { LocalCredentialProvider } = await load('@deepseek-ai/dsh-credentials-local/lib/index.js');
const { credentialRef } = await load('@deepseek-ai/dsh-credentials/lib/index.js');
const extension = await load('@bharatcode/ci-pipelines/src/host.js');
const home = await mkdtemp(join(tmpdir(), 'bc-packed-pipeline-account-'));
const ctx = new Context();
try {
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), dshHome: home, watch: false });
  await ctx.credentials.set(credentialRef('BC_QUAL_GITHUB_TOKEN'), token);
  token = undefined;
  const tools = new Map(), hooks = new Map();
  extension.apply({ credentials: ctx.credentials, tools: { register(tool) { tools.set(tool.name, tool); } },
    on(event, listener) { hooks.set(event, listener); } }, extension.Config({ githubCredential: 'BC_QUAL_GITHUB_TOKEN' }));
  const repository = 'arzvaak/Bharatcode-Harness', signal = AbortSignal.timeout(60000);
  const call = (name, args = {}) => tools.get(name).execute({ provider: 'github', project: repository, ...args }, { signal });
  const inventory = await call('pipeline_list');
  const run = inventory.workflow_runs.find(row => row.name === 'Core and packed extensions' && row.status === 'completed' && ['failure', 'success'].includes(row.conclusion));
  assert.ok(run, 'A completed controlled qualification run is required for log evidence');
  const inspected = await call('pipeline_inspect', { id: run.id });
  assert.equal(inspected.id, run.id);
  assert.equal(inspected.repository.full_name.toLowerCase(), repository.toLowerCase());
  const jobs = await call('pipeline_jobs', { id: run.id });
  const job = jobs.jobs.find(row => row.name === 'verdict' && row.status === 'completed');
  assert.ok(job, 'Completed aggregate job required');
  const log = await call('pipeline_log', { id: job.id });
  assert.equal(log.source, 'untrusted-pipeline-log');
  assert.ok(log.bytes > 0 && log.bytes <= 1024 * 1024);
  assert.equal((await hooks.get('tools/pre-execute')({ name: 'pipeline_rerun' }, () => { throw Error('Unexpected mutation permission'); })).kind, 'deny');
  console.log(JSON.stringify({ platform: process.platform, kind: 'packed-readonly-github-account', repository,
    runId: run.id, jobId: job.id, logBytes: log.bytes, operations: ['list', 'inspect', 'jobs', 'log'], rerun: 'disabled',
    limitations: ['GitLab account workflow pending', 'No remote mutations', 'Registration fixture; native lifecycle qualification separate'] }));
} finally {
  token = undefined;
  await ctx.fiber.dispose();
  await rm(home, { recursive: true, force: true });
}
