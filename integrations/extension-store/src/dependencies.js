import semver from 'semver';
import { tmpdir } from 'node:os';

// Known version-only probes. Catalog content cannot introduce arbitrary commands
// or shell fragments. These do not qualify a package, kernel or document workflow.
export const DEPENDENCY_IDS = ['node', 'python', 'jupyter', 'duckdb', 'typst', 'tinymist', 'ffmpeg', 'pdflatex', 'latexmk'];
const versionProbe = (id, platform, commands = {}) => {
  const python = commands.python ?? (platform === 'win32' ? 'python' : 'python3');
  const probes = {
    node: { title: 'Node runtime', command: commands.node ?? process.execPath, args: ['--version'], range: '>=24.0.0' },
    python: { title: 'Local Python interpreter', command: python, args: ['--version'], range: '>=3.10.0' },
    jupyter: { title: 'Local Jupyter core', command: python, args: ['-m', 'jupyter', '--version'], range: '>=0.0.0', pattern: /jupyter core\s*:\s*(\S+)/i },
    duckdb: { title: 'Local DuckDB Python module', command: python, args: ['-c', 'import duckdb; print(duckdb.__version__)'], range: '>=0.0.0' },
    typst: { title: 'Local Typst compiler', command: commands.typst ?? 'typst', args: ['--version'], range: '>=0.0.0' },
    tinymist: { title: 'Local Tinymist server', command: commands.tinymist ?? 'tinymist', args: ['--version'], range: '>=0.0.0' },
    ffmpeg: { title: 'Local FFmpeg', command: commands.ffmpeg ?? 'ffmpeg', args: ['-version'], range: '>=0.0.0' },
    pdflatex: { title: 'Local LaTeX PDF engine', command: commands.pdflatex ?? 'pdflatex', args: ['--version'], range: '>=0.0.0', pattern: /(?:pdfTeX\s+\S+-\S+-|MiKTeX-pdfTeX\s+)(\d+\.\d+(?:\.\d+)?)/i },
    latexmk: { title: 'Local LaTeX build runner', command: commands.latexmk ?? 'latexmk', args: ['-v'], range: '>=0.0.0', pattern: /Version\s+(\d+\.\d+(?:\.\d+)?)/i },
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
    // Keep the complete token: coerce() alone would convert a Python
    // development build such as 1.5.6.dev42 into the pinned stable 1.5.6.
    const token = pattern ? pattern.exec(output)?.[1] : output.match(/\b[vV]?(\d+\.\d+(?:\.\d+)?(?:[-+._][0-9A-Za-z._-]+|[A-Za-z][0-9A-Za-z._-]*)?)(?![0-9A-Za-z._+-])/)?.[1];
    const version = token && (semver.valid(token) ?? (/^\d+\.\d+(?:\.\d+)?$/.test(token) ? semver.coerce(token)?.version : undefined));
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
export async function inspectDependencies(ids, { platform = process.platform, runner = probeCommand, signal, subprocess, ranges = {}, commands = {}, managed = {}, expectedVersions = {} } = {}) {
  if (!Array.isArray(ids) || ids.length > DEPENDENCY_IDS.length || new Set(ids).size !== ids.length || ids.some(id => !DEPENDENCY_IDS.includes(id)))
    throw Error('Unknown dependency inspection request');
  if (!ranges || typeof ranges !== 'object' || Array.isArray(ranges) || Object.entries(ranges).some(([id, range]) =>
    !ids.includes(id) || typeof range !== 'string' || range.length > 256 || !semver.validRange(range)))
    throw Error('Invalid dependency version requirements');
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)
    || Object.entries(commands).some(([id, command]) => !DEPENDENCY_IDS.includes(id)
      || typeof command !== 'string' || !command || command.length > 4096))
    throw Error('Invalid dependency executable map');
  if (!managed || typeof managed !== 'object' || Array.isArray(managed)
    || Object.entries(managed).some(([id, status]) => !ids.includes(id)
      || !['installed', 'available', 'unavailable'].includes(status)))
    throw Error('Invalid managed dependency status map');
  if (!expectedVersions || typeof expectedVersions !== 'object' || Array.isArray(expectedVersions)
    || Object.entries(expectedVersions).some(([id, version]) => !ids.includes(id) || !semver.valid(version)))
    throw Error('Invalid expected dependency version map');
  const results = [];
  for (const id of ids) {
    const probe = versionProbe(id, platform, commands);
    const result = await runner(probe.command, probe.args, { signal, pattern: probe.pattern, subprocess });
    const compatible = result.available && semver.valid(result.version) && semver.satisfies(result.version, probe.range)
      && (!ranges[id] || semver.satisfies(result.version, ranges[id]))
      && (!expectedVersions[id] || result.version === expectedVersions[id]);
    results.push({ id, title: probe.title, command: probe.command, platform,
      ...result, available: Boolean(compatible),
      ...(result.available && !compatible ? { reason: expectedVersions[id] && result.version !== expectedVersions[id]
        ? `Managed ${probe.title} must report exactly ${expectedVersions[id]}`
        : `${probe.title} requires ${probe.range}${ranges[id] ? " and " + ranges[id] : ""}` } : {}),
      managedSetup: managed[id] ?? 'unavailable',
      note: managed[id] === 'installed'
        ? 'A verified managed runtime is installed. Extension and workflow qualification still apply.'
        : managed[id] === 'available'
          ? 'A signed, platform-qualified runtime is available after explicit setup; nothing was downloaded.'
          : 'Local version inspection only. No qualified managed runtime release is available.',
    });
  }
  return results;
}
