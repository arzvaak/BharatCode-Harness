import test, { after } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local';
const context = new Context();
await context.plugin(LocalSubprocessRuntime);
const subprocess = context.subprocess;
after(() => context.fiber.dispose());
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDependencies, probeCommand } from '../src/dependencies.js';

test('LaTeX inspection recognizes TeX Live and MiKTeX engines separately from latexmk', async () => {
  for (const output of ['pdfTeX 3.141592653-2.6-1.40.29 (TeX Live 2026)', 'MiKTeX-pdfTeX 4.21 (MiKTeX 25.4)']) {
    const [engine, builder] = await inspectDependencies(['pdflatex', 'latexmk'], { subprocess,
      runner: async (command, args, options) => {
        assert.equal(command, args[0] === '-v' ? 'latexmk' : 'pdflatex');
        return probeCommand(process.execPath, ['-e', `console.log(${JSON.stringify(command === 'latexmk' ? 'Latexmk, John Collins, 15 June 2025. Version 4.87' : output)})`], options);
      },
    });
    assert.equal(engine.available, true);
    assert.equal(engine.version, output.startsWith('pdfTeX') ? '1.40.29' : '4.21.0');
    assert.equal(builder.version, '4.87.0');
    assert.equal(engine.managedSetup, 'unavailable');
  }
});

test('local inspection uses an existing runtime and never downloads or injects tools', async () => {
  const result = await inspectDependencies(['node'], { subprocess });
  assert.equal(result[0].available, true);
  assert.equal(result[0].command, process.execPath);
  assert.match(result[0].version, /^\d+\.\d+\.\d+$/);
  assert.equal(result[0].managedSetup, 'unavailable');
});

test('a qualified store runtime path takes precedence during bounded version inspection', async () => {
  const [result] = await inspectDependencies(['python'], {
    platform: 'win32', commands: { python: process.execPath }, subprocess,
  });
  assert.equal(result.command, process.execPath);
  assert.equal(result.available, true);
  await assert.rejects(inspectDependencies(['python'], {
    runner: async () => ({ available: true, version: '3.12.0' }),
    commands: { outside: '/tmp/untrusted' },
  }), /executable map/);
  const [mismatch] = await inspectDependencies(['python'], {
    runner: async () => ({ available: true, version: '3.12.15' }),
    expectedVersions: { python: '3.12.14' },
  });
  assert.equal(mismatch.available, false);
  assert.match(mismatch.reason, /exactly 3\.12\.14/);
});

test('Python module probes use the selected interpreter for every requirement', async () => {
  const commands = [];
  const result = await inspectDependencies(['python', 'duckdb'], {
    commands: { python: '/managed/python' },
    runner: async (command, args) => {
      commands.push(command);
      return { available: true, version: args[0] === '--version' ? '3.12.14' : '1.5.6' };
    },
  });
  assert.deepEqual(commands, ['/managed/python', '/managed/python']);
  assert.deepEqual(result.map(item => item.available), [true, true]);
});

test('missing, incompatible and excessive-output probes produce bounded diagnostics', async () => {
  const missing = await probeCommand('bc-missing-fixture-runtime', ['--version'], { subprocess });
  assert.equal(missing.available, false);
  assert.equal(missing.reason, 'Executable not found');
  const incompatible = await inspectDependencies(['python'], { runner: async () => ({ available: true, version: '2.7.18' }) });
  assert.equal(incompatible[0].available, false);
  assert.match(incompatible[0].reason, /requires >=3.10.0/);
  const overflow = await probeCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(32768))"], { subprocess });
  assert.equal(overflow.available, false);
  assert.match(overflow.reason, /output limit/);
});

test('cancellation settles the owned version process without exposing process output', async () => {
  const abort = new AbortController();
  const pending = probeCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal, subprocess });
  abort.abort();
  const result = await pending;
  assert.equal(result.available, false);
  assert.equal(result.reason, 'Inspection cancelled');
});

test('only declared runtime IDs can trigger a probe; inspection stays explicit', async () => {
  let calls = 0;
  await assert.rejects(inspectDependencies(['../outside'], { runner: async () => { calls++; } }), /Unknown dependency/);
  assert.equal(calls, 0);
  assert.deepEqual(await inspectDependencies([], { runner: async () => { calls++; } }), []);
  assert.equal(calls, 0);
});

test('deadline closes a version process that ignores graceful termination', { timeout: 10_000 }, async () => {
  const result = await probeCommand(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { subprocess });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'Inspection deadline exceeded');
});


test('native version probes scrub provider, GitHub and host identity variables', async () => {
  const keys = ['BC_FIXTURE_TOKEN', 'Bc_fixture_pAsSwOrD', 'DSH_FIXTURE_VALUE'];
  const prior = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = 'owned-dummy-value';
    const source = `console.log(${JSON.stringify(keys)}.some(key=>process.env[key])?'v0.0.0':process.version)`;
    const result = await probeCommand(process.execPath, ['-e', source], { subprocess });
    assert.equal(result.version, process.versions.node);
  } finally { keys.forEach((key, i) => { if (prior[i] === undefined) delete process.env[key]; else process.env[key] = prior[i]; }); }
});

test('deadline reaches quiescence with a descendant retaining stdio', { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bc-probe-descendant-'));
  const file = join(directory, 'pid');
  let pid;
  try {
    const descendant = `require('node:fs').writeFileSync(${JSON.stringify(file)},String(process.pid));setInterval(()=>{},1000)`;
    const source = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
    const start = performance.now();
    const result = await probeCommand(process.execPath, ['-e', source], { subprocess });
    pid = Number(await readFile(file, 'utf8'));
    assert.equal(result.reason, 'Inspection deadline exceeded');
    assert.ok(performance.now() - start < 7000, 'native process range must stop, including inherited pipes');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'owned descendant must be gone after settlement');
    pid = undefined;
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});

test('signed candidate ranges supplement native minimums before availability is reported', async () => {
  const runner = async () => ({ available: true, version: '1.5.0' });
  const [duckdb] = await inspectDependencies(['duckdb'], { runner, ranges: { duckdb: '=1.5.6' } });
  assert.equal(duckdb.available, false);
  assert.match(duckdb.reason, /=1.5.6/);
  const [node] = await inspectDependencies(['node'], { runner, ranges: { node: '>=0.0.0' } });
  assert.equal(node.available, false, 'candidate ranges cannot relax BC runtime floors');
  let calls = 0;
  await assert.rejects(inspectDependencies(['python'], { runner: async () => { calls++; }, ranges: { outside: '*' } }));
  await assert.rejects(inspectDependencies(['python'], { runner: async () => { calls++; }, ranges: { python: 'invalid' } }));
  assert.equal(calls, 0);
});

test('native version parsing never turns development builds into pinned stable releases', async () => {
  for (const version of ['1.5.6', '1.5.6.dev42', '1.5.6_dev42', '1.5.6rc1', '1.5.6-rc.1']) {
    const runner = (_command, _args, options) => probeCommand(process.execPath, ['-e', `console.log(${JSON.stringify(version)})`], options);
    const [result] = await inspectDependencies(['duckdb'], { subprocess, runner, ranges: { duckdb: '=1.5.6' } });
    assert.equal(result.available, version === '1.5.6', version);
    if (version === '1.5.6-rc.1') assert.equal(result.version, version);
  }
  const runner = (_command, _args, options) => probeCommand(process.execPath, ['-e', 'console.log("jupyter core : 7.0.0.dev0")'], options);
  const [jupyter] = await inspectDependencies(['jupyter'], { subprocess, runner, ranges: { jupyter: '=7.0.0' } });
  assert.equal(jupyter.available, false);
});
