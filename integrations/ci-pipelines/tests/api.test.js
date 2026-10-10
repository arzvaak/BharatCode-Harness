import test from 'node:test';
import assert from 'node:assert/strict';
import { PipelineApi } from '../src/api.js';
test('reads provider-specific run, job and bounded log routes without writes', async () => {
  const calls = [];
  const api = new PipelineApi(
    async () => 'secret',
    async (url, options) => {
      calls.push([url, options]);
      return new Response(options.method === 'GET' ? '{}' : '', { status: 200 });
    },
  );
  await api.inspect('github', 'owner/repo', 123);
  await api.inspect('gitlab', 'owner/project', 12);
  assert.ok(calls[0][0].endsWith('/repos/owner/repo/actions/runs/123'));
  assert.ok(calls[1][0].endsWith('/projects/owner%2Fproject/pipelines/12'));
  assert.ok(calls.every(([, o]) => o.method === 'GET' && o.redirect === 'manual'));
});
test('rejects unknown routes and unsafe IDs before resolving credentials', async () => {
  let reads = 0;
  const api = new PipelineApi(async () => {
    reads++;
    return 'secret';
  });
  for (const args of [
    ['github', '../escape', 1],
    ['other', 'owner/repo', 1],
    ['github', 'owner/repo', 0],
  ])
    await assert.rejects(api.inspect(...args));
  assert.equal(reads, 0);
});
test('refuses redirected credentials and oversize logs', async () => {
  const redirect = new PipelineApi(
    async () => 'secret',
    async () => new Response('', { status: 302, headers: { location: 'https://evil.example' } }),
  );
  await assert.rejects(redirect.log('github', 'o/r', 1), /redirect/);
  const large = new PipelineApi(
    async () => 'secret',
    async () => new Response('x'.repeat(1024 * 1024 + 1)),
  );
  await assert.rejects(large.log('gitlab', 'o/r', 1), /large/);
});
test('rerun uses the exact provider API with no debug logging enabled', async () => {
  let call;
  const api = new PipelineApi(
    async () => 'secret',
    async (url, options) => {
      call = [url, options];
      return new Response('', { status: 201 });
    },
  );
  await api.rerun('github', 'o/r', 8);
  assert.ok(call[0].endsWith('/actions/runs/8/rerun-failed-jobs'));
  assert.equal(call[1].method, 'POST');
  await api.rerun('gitlab', 'o/r', 9);
  assert.ok(call[0].endsWith('/pipelines/9/retry'));
});
