import semver from 'semver';
import { tmpdir } from 'node:os';

// Known version-only probes. Catalog content cannot introduce arbitrary commands
// or shell fragments. These do not qualify a package, kernel or document workflow.
export const DEPENDENCY_IDS = ['node', 'python', 'jupyter', 'duckdb', 'typst', 'tinymist', 'ffmpeg'];
const versionProbe = (id, platform) => {
  const python = platform === 'win32' ? 'python' : 'python3';
  const probes = {
    node: { title: 'BC Node runtime', command: process.execPath, args: ['--version'], range: '>=24.0.0' },
    python: { title: 'Local Python interpreter', command: python, args: ['--version'], range: '>=3.10.0' },
    jupyter: { title: 'Local Jupyter core', command: python, args: ['-m', 'jupyter', '--version'], range: '>=0.0.0', pattern: /jupyter core\s*:\s*(\d+\.\d+\.\d+)/i },
    duckdb: { title: 'Local DuckDB Python module', command: python, args: ['-c', 'import duckdb; print(duckdb.__version__)'], range: '>=0.0.0' },
    typst: { title: 'Local Typst compiler', command: 'typst', args: ['--version'], range: '>=0.0.0' },
    tinymist: { title: 'Local Tinymist server', command: 'tinymist', args: ['--version'], range: '>=0.0.0' },
    ffmpeg: { title: 'Local FFmpeg', command: 'ffmpeg', args: ['-version'], range: '>=0.0.0' },
  };
  return probes[id];
};

/** Run one version probe with no shell, bounded output and a five-second deadline. */
export async function probeCommand(command, args, { signal, pattern, subprocess } = {}) {
  if (!subprocess) throw Error('Native subprocess service required for dependency inspection');
  if (signal?.aborted) return { available: false, reason: 'Inspection cancelled' };
  const abort = new AbortController();
  let reason, child, output = '', bytes = 0;
  const stop = message => { reason ??= message; abort.abort(); };
  const deadline = setTimeout(() => stop('Inspection deadline exceeded'), 5000);
  const cancelled = () => stop('Inspection cancelled');
  signal?.addEventListener('abort', cancelled, { once: true });
  if (signal?.aborted) cancelled();
  try {
    const executable = await subprocess.resolveExecutable(command, undefined, abort.signal);
    child = subprocess.spawn({ argv: [executable, ...args], cwd: tmpdir(),
      env: { PYTHONDONTWRITEBYTECODE: '1' },
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 500, signal: abort.signal });
    const read = chunk => {
      bytes += chunk.length;
      if (bytes > 8192) { stop('Inspection output limit exceeded'); return; }
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    const outcome = await child.done;
    // Native termination and quiescence cover the same process range, including
    // descendants retaining pipes. Never drop ownership at parent exit alone.
    child.terminate();
    await child.waitForExit();
    if (reason || outcome.exitCode !== 0) return { available: false, reason: reason ?? 'Version probe failed' };
    const version = pattern ? pattern.exec(output)?.[1] : semver.coerce(output)?.version;
    return version ? { available: true, version } : { available: false, reason: 'Version could not be identified' };
  } catch (error) {
    if (child) { child.terminate(); await child.waitForExit(); }
    return { available: false, reason: reason ?? (error.name === 'SubprocessExecutableNotFoundError' || error.code === 'ENOENT' ? 'Executable not found' : 'Version probe failed') };
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', cancelled);
  }
}

/** Explicit read-only requirement inspection; no download, installation or runtime activation. */
export async function inspectDependencies(ids, { platform = process.platform, runner = probeCommand, signal, subprocess } = {}) {
  if (!Array.isArray(ids) || ids.length > DEPENDENCY_IDS.length || new Set(ids).size !== ids.length || ids.some(id => !DEPENDENCY_IDS.includes(id)))
    throw Error('Unknown dependency inspection request');
  const results = [];
  for (const id of ids) {
    const probe = versionProbe(id, platform);
    const result = await runner(probe.command, probe.args, { signal, pattern: probe.pattern, subprocess });
    const compatible = result.available && semver.valid(result.version) && semver.satisfies(result.version, probe.range);
    results.push({ id, title: probe.title, command: probe.command, platform,
      ...result, available: Boolean(compatible),
      ...(result.available && !compatible ? { reason: `${probe.title} requires ${probe.range}` } : {}),
      managedSetup: 'unavailable',
      note: 'Local version inspection only. Remaining package and workflow prerequisites still apply; no qualified managed runtime release is available.',
    });
  }
  return results;
}
