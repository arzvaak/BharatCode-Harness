import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { c as createTar } from 'tar';
import { validateCatalog, REQUIRED_MANAGED_EVIDENCE } from '../../integrations/extension-store/src/contracts.js';

/** Package executable and licence files with deterministic tar metadata. */
export async function packageRuntime(files) {
  if (!files.LICENSE?.length || !files.NOTICE?.length) throw Error('Runtime licence and notices are required');
  for (const [path, bytes] of Object.entries(files)) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || !/^[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(path)
      || path.split('/').some(part => ['.', '..'].includes(part) || part.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
      throw Error('Invalid runtime file path or bytes');
  }
  const directory = await mkdtemp(join(tmpdir(), 'bc-runtime-pack-'));
  try {
    for (const [path, bytes] of Object.entries(files)) {
      const target = join(directory, 'runtime', path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, bytes);
      await chmod(target, path.startsWith('bin/') ? 0o755 : 0o644);
    }
    const archive = join(directory, 'runtime.tgz');
    await createTar({ cwd: directory, file: archive, gzip: true, portable: true, noMtime: true }, ['runtime']);
    return { bytes: await readFile(archive), unpackedBytes: Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Assemble descriptors only for the explicitly selected native release platforms. */
export function assembleManagedRelease(reports, platforms = ['linux', 'win32']) {
  if (!Array.isArray(platforms) || !platforms.length || new Set(platforms).size !== platforms.length
    || platforms.some(platform => !['linux', 'win32'].includes(platform))) throw Error('Invalid native release platforms');
  const bundles = [];
  const grouped = Map.groupBy(reports, report => report.id);
  for (const records of grouped.values()) {
    const selected = platforms.map(platform => records.find(record => record.platform === platform));
    if (records.length !== platforms.length || selected.some(record => !record))
      throw Error('Native runtime qualification requires exactly the selected platforms');
    const first = selected[0];
    const bundle = { id: first.id, version: first.version, architecture: first.architecture,
      source: first.source, sourceCommit: first.sourceCommit, license: first.license,
      provides: first.provides, status: 'qualified', platforms: [...platforms], artifacts: {}, commands: {}, qualificationEvidence: [] };
    for (const record of selected) {
      for (const field of ['id', 'version', 'architecture', 'source', 'sourceCommit', 'license', 'provides'])
        if (JSON.stringify(record[field]) !== JSON.stringify(bundle[field])) throw Error('Native runtime qualification identities differ');
      if (!Array.isArray(record.checks) || [...REQUIRED_MANAGED_EVIDENCE, 'document-workflow'].some(check => !record.checks.includes(check)))
        throw Error('Native runtime qualification checks incomplete');
      bundle.artifacts[record.platform] = record.artifact;
      bundle.commands[record.platform] = record.commands;
      for (const check of REQUIRED_MANAGED_EVIDENCE) bundle.qualificationEvidence.push({ platform: record.platform,
        sourceCommit: bundle.sourceCommit, artifactSha256: record.artifact.sha256, check, result: 'passed', evidence: record.evidence });
    }
    try { validateCatalog({ schemaVersion: 1, revision: 1, channel: 'preview', entries: [], managedDependencies: [bundle] }); }
    catch (error) { throw Error('Native runtime qualification descriptor invalid', { cause: error }); }
    bundles.push(bundle);
  }
  if (!bundles.length) throw Error('Native runtime qualification reports missing');
  return bundles;
}
