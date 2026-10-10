import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { relative, resolve, sep, join } from 'node:path';
import { x as extractTar } from 'tar';
import semver from 'semver';
import { canInstallManagedDependency } from './contracts.js';
import { inspectDependencies } from './dependencies.js';
import { isPythonDependency } from './dependency-groups.js';

const MAX_FILES = 50000;
const abortError = () => Object.assign(new Error('Managed dependency setup cancelled'), { name: 'AbortError' });

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? abortError();
}

async function atomicWrite(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Managed dependency path is not an owned directory');
}

function normalizedArchivePath(path) {
  const clean = path.replace(/\/+$/u, '');
  const parts = clean.split('/');
  const unsafeWindowsName = part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part);
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/')
    || parts.some(part => !part || part === '..' || part === '.' || !/^[A-Za-z0-9_+.-]+$/u.test(part)
      || part.endsWith('.') || unsafeWindowsName(part)))
    throw Error('Managed dependency archive contains an unsafe path');
  if (clean !== 'runtime' && !clean.startsWith('runtime/'))
    throw Error('Managed dependency archive must contain only runtime/ files');
  return clean === 'runtime' ? '' : clean.slice('runtime/'.length);
}

function rangeFor(ranges, id) {
  return ranges[id] ?? '*';
}

/** Verify and install immutable runtime bundles from the signed private catalog. */
export class ManagedDependencyStore {
  constructor({ directory, transport, platform, subprocess, probeRunner, assetResolver }) {
    this.directory = directory;
    this.root = join(directory, 'managed-dependencies');
    this.cache = join(directory, 'managed-dependency-cache');
    this.transport = transport;
    this.platform = platform;
    this.subprocess = subprocess;
    this.probeRunner = probeRunner;
    this.assetResolver = assetResolver;
    this.catalog = { managedDependencies: [] };
    this.records = [];
  }

  async load(catalog = this.catalog) {
    await ensureDirectory(this.root);
    this.catalog = catalog;
    this.records = [];
    let folders;
    try { folders = await readdir(this.root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const folder of folders) {
      if (!folder.isDirectory() || folder.isSymbolicLink() || !/^[-a-z0-9]+$/u.test(folder.name)) continue;
      const base = join(this.root, folder.name);
      let versions;
      try { versions = await readdir(base, { withFileTypes: true }); }
      catch { continue; }
      for (const version of versions) {
        if (!version.isDirectory() || version.isSymbolicLink()) continue;
        const directory = join(base, version.name);
        let metadata;
        try {
          const marker = join(directory, 'managed.json');
          const markerInfo = await lstat(marker);
          if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.size > 256 * 1024)
            throw Error('Managed runtime marker is unsafe');
          metadata = JSON.parse(await readFile(marker, 'utf8'));
        }
        catch {
          if (!folder.name.startsWith('.stage-')) this.records.push({ id: folder.name, version: version.name, directory, verified: false });
          continue;
        }
        const bundle = (catalog.managedDependencies ?? []).find(candidate => candidate.id === folder.name
          && candidate.version === version.name && candidate.status === 'qualified'
          && (candidate.architecture === undefined || candidate.architecture === process.arch)
          && candidate.platforms.includes(this.platform));
        if (!bundle || metadata.schemaVersion !== 1 || metadata.platform !== this.platform
          || !isDeepStrictEqual(metadata.bundle, bundle)) {
          if (!folder.name.startsWith('.stage-')) this.records.push({ id: folder.name, version: version.name, directory, verified: false });
          continue;
        }
        const artifact = bundle.artifacts[this.platform];
        if (metadata.artifactSha256 !== artifact.sha256) {
          this.records.push({ id: folder.name, version: version.name, directory, verified: false });
          continue;
        }
        const record = { bundle, directory, verified: true };
        try {
          for (const command of Object.values(bundle.commands[this.platform]))
            await this.commandPath(record, command);
        } catch {
          this.records.push({ id: folder.name, version: version.name, directory, verified: false });
          continue;
        }
        record.id = bundle.id;
        record.version = bundle.version;
        this.records.push(record);
      }
    }
  }

  view() {
    return this.records.map(record => record.verified ? ({
      id: record.bundle.id,
      version: record.bundle.version,
      provides: structuredClone(record.bundle.provides),
      platform: this.platform,
      source: record.bundle.source,
      sourceCommit: record.bundle.sourceCommit,
      license: record.bundle.license,
      artifactSha256: record.bundle.artifacts[this.platform].sha256,
      bytes: record.bundle.artifacts[this.platform].bytes,
      verified: true,
    }) : ({ id: record.id, version: record.version, provides: {}, platform: this.platform,
      source: '', sourceCommit: '', license: 'Unverified', artifactSha256: '', bytes: 0, verified: false }));
  }

  installedBundle(dependencyId, range = '*') {
    return this.records
      .filter(record => record.verified && canInstallManagedDependency(record.bundle, this.platform, dependencyId, range))
      .sort((a, b) => semver.rcompare(a.bundle.provides[dependencyId], b.bundle.provides[dependencyId])
        || a.bundle.id.localeCompare(b.bundle.id))[0];
  }

  hasQualifiedBundle(dependencyId, range = '*') {
    return (this.catalog.managedDependencies ?? []).some(bundle =>
      canInstallManagedDependency(bundle, this.platform, dependencyId, range));
  }

  pythonBundleFor(ids, ranges = {}, installedOnly = false) {
    const pythonIds = ids.filter(isPythonDependency);
    if (!pythonIds.length) return undefined;
    const supports = bundle => pythonIds.every(id =>
      canInstallManagedDependency(bundle, this.platform, id, rangeFor(ranges, id)));
    const bundles = installedOnly
      ? this.records.filter(record => record.verified).map(record => record.bundle)
      : (this.catalog.managedDependencies ?? []).filter(bundle => bundle.status === 'qualified');
    return bundles.filter(supports)
      .sort((a, b) => semver.rcompare(a.version, b.version) || a.id.localeCompare(b.id))[0];
  }

  async resolvePythonFor(ids, ranges = {}) {
    const bundle = this.pythonBundleFor(ids, ranges, true);
    if (!bundle) return undefined;
    const record = this.records.find(item => item.verified && item.bundle.id === bundle.id && item.bundle.version === bundle.version);
    const relativePath = bundle.commands[this.platform]?.python;
    return record && relativePath ? this.commandPath(record, relativePath) : undefined;
  }

  plan(ids, ranges = {}) {
    const remaining = new Set(ids.filter(id => !this.installedBundle(id, rangeFor(ranges, id))));
    const result = [];
    const bundles = (this.catalog.managedDependencies ?? []).filter(bundle =>
      bundle.platforms.includes(this.platform) && bundle.status === 'qualified');
    while (remaining.size) {
      const candidates = bundles.map(bundle => {
        const covers = [...remaining].filter(id => canInstallManagedDependency(bundle, this.platform, id, rangeFor(ranges, id)));
        return { bundle, covers };
      }).filter(candidate => candidate.covers.length)
        .sort((a, b) => b.covers.length - a.covers.length
          || semver.rcompare(a.bundle.version, b.bundle.version)
          || a.bundle.id.localeCompare(b.bundle.id));
      const selected = candidates[0];
      if (!selected) throw Error(`No qualified managed runtime is available for ${[...remaining].join(', ')}`);
      result.push(selected.bundle);
      for (const id of selected.covers) remaining.delete(id);
    }
    return result;
  }

  async commandPath(record, relativePath) {
    const path = resolve(record.directory, ...relativePath.split('/'));
    const rel = relative(record.directory, path);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(path) !== path)
      throw Error('Managed command path is outside its runtime directory');
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw Error('Managed command is missing or unsafe');
    if (this.platform !== 'win32' && (info.mode & 0o111) === 0)
      throw Error('Managed command is not executable');
    const real = await realpath(path);
    const realDirectory = await realpath(record.directory);
    const realRel = relative(realDirectory, real);
    if (!realRel || realRel === '..' || realRel.startsWith(`..${sep}`))
      throw Error('Managed command resolves outside its runtime directory');
    return real;
  }

  async resolveCommand(dependencyId, range = '*') {
    const record = this.installedBundle(dependencyId, range);
    const relativePath = record?.bundle.commands[this.platform]?.[dependencyId];
    return record && relativePath ? this.commandPath(record, relativePath) : undefined;
  }

  async commandsFor(ids, ranges = {}) {
    const commands = {};
    const pythonCommand = await this.resolvePythonFor(ids, ranges);
    if (pythonCommand) commands.python = pythonCommand;
    for (const id of ids) {
      if (isPythonDependency(id)) continue;
      const direct = await this.resolveCommand(id, rangeFor(ranges, id));
      if (direct) commands[id] = direct;
    }
    return commands;
  }

  async install(bundle, signal) {
    if (!canInstallManagedDependency(bundle, this.platform, Object.keys(bundle.provides)[0], '*'))
      throw Error('Managed runtime is not qualified for this platform');
    checkAbort(signal);
    const artifact = bundle.artifacts[this.platform];
    const releaseAsset = this.assetResolver?.(artifact.assetName);
    if (!releaseAsset || releaseAsset.size !== artifact.bytes || !Number.isSafeInteger(releaseAsset.id)
      || releaseAsset.id < 1 || (artifact.assetId !== undefined && artifact.assetId !== releaseAsset.id))
      throw Error('Managed runtime asset is not present in the verified release inventory');
    const root = join(this.root, bundle.id, bundle.version);
    try {
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Existing managed runtime is unsafe');
      const prior = this.records.find(record => record.verified && record.bundle.id === bundle.id && record.bundle.version === bundle.version);
      if (prior && prior.bundle.artifacts[this.platform].sha256 === artifact.sha256) return prior;
      throw Error('Existing managed runtime is not verified; preserve it for recovery');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }

    checkAbort(signal);
    const downloaded = await this.transport.asset(releaseAsset.id, { signal, maxBytes: artifact.bytes });
    checkAbort(signal);
    if (!Buffer.isBuffer(downloaded) || downloaded.length !== artifact.bytes
      || createHash('sha256').update(downloaded).digest('hex') !== artifact.sha256)
      throw Error('Managed dependency artifact integrity mismatch');
    await ensureDirectory(this.cache);
    const archivePath = join(this.cache, `${artifact.sha256}.tar.gz`);
    try {
      const existing = await readFile(archivePath);
      if (createHash('sha256').update(existing).digest('hex') !== artifact.sha256)
        throw Error('Cached managed dependency artifact integrity mismatch');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomicWrite(archivePath, downloaded);
    }
    checkAbort(signal);
    await ensureDirectory(this.root);
    const staging = join(this.root, `.stage-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    const seen = new Map();
    const files = new Set();
    let expandedBytes = 0;
    let invalidArchive;
    try {
      await extractTar({
        file: archivePath,
        cwd: staging,
        strip: 1,
        strict: true,
        preserveOwner: false,
        preservePaths: false,
        unlink: true,
        noMtime: true,
        maxDepth: 64,
        maxDecompressionRatio: 1000,
        filter: (path, entry) => {
          try {
            checkAbort(signal);
            const relativePath = normalizedArchivePath(path);
            if (!relativePath) {
              if (entry.type !== 'Directory') throw Error('Managed dependency archive root must be a directory');
              return true;
            }
            const kind = entry.type === 'Directory' ? 'directory' : entry.type === 'File' ? 'file' : undefined;
            if (!kind) throw Error('Managed dependency archives may contain only files and directories');
            const keyFor = value => this.platform === 'win32' ? value.toLowerCase() : value;
            const key = keyFor(relativePath);
            if (seen.has(key)) throw Error('Managed dependency archive contains duplicate or case-colliding paths');
            const parts = relativePath.split('/');
            for (let index = 1; index < parts.length; index++)
              if (seen.get(keyFor(parts.slice(0, index).join('/'))) === 'file') throw Error('Managed dependency archive has a file/directory collision');
            if (kind === 'file' && [...seen.keys()].some(existing => existing.startsWith(`${key}/`)))
              throw Error('Managed dependency archive has a file/directory collision');
            seen.set(key, kind);
            if (kind === 'file') {
              if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw Error('Managed dependency archive has an invalid file size');
              expandedBytes += entry.size;
              if (expandedBytes > artifact.unpackedBytes || seen.size > MAX_FILES)
                throw Error('Managed dependency archive exceeds its signed extraction limits');
              files.add(relativePath);
            } else if (seen.size > MAX_FILES) throw Error('Managed dependency archive has too many files');
            return true;
          } catch (error) {
            invalidArchive ??= error;
            return false;
          }
        },
      });
      if (invalidArchive) throw invalidArchive;
      checkAbort(signal);
      const absoluteCommands = {};
      for (const [id, command] of Object.entries(bundle.commands[this.platform])) {
        if (!files.has(command)) throw Error(`Managed dependency command is absent from its archive: ${id}`);
        absoluteCommands[id] = await this.commandPath({ directory: staging }, command);
      }
      const checks = await inspectDependencies(Object.keys(bundle.provides), {
        platform: this.platform,
        commands: absoluteCommands,
        ranges: bundle.provides,
        runner: this.probeRunner,
        subprocess: this.subprocess,
        signal,
      });
      if (checks.some(check => !check.available || check.version !== bundle.provides[check.id]))
        throw Error('Managed runtime version probe did not match its signed provision list');
      checkAbort(signal);
      const metadata = {
        schemaVersion: 1,
        platform: this.platform,
        artifactSha256: artifact.sha256,
        bundle,
      };
      await atomicWrite(join(staging, 'managed.json'), Buffer.from(JSON.stringify(metadata, null, 2)));
      await ensureDirectory(join(this.root, bundle.id));
      checkAbort(signal);
      await rename(staging, root);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (signal?.aborted) throw signal.reason ?? abortError();
      throw error;
    }
    await this.load(this.catalog);
    const installed = this.records.find(record => record.verified && record.bundle.id === bundle.id && record.bundle.version === bundle.version);
    if (!installed) throw Error('Managed runtime installation did not pass post-install validation');
    return installed;
  }

  async remove(bundleId, version) {
    if (typeof bundleId !== 'string' || !/^[-a-z0-9]+$/u.test(bundleId)
      || typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/u.test(version))
      throw Error('Invalid managed runtime identity');
    const rootInfo = await lstat(this.root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw Error('Managed runtime store is unsafe');
    const parent = join(this.root, bundleId);
    const path = join(parent, version);
    try {
      const parentInfo = await lstat(parent);
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw Error('Managed runtime directory is unsafe');
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Managed runtime version directory is unsafe');
      await rm(path, { recursive: true, force: false });
      try { await rmdir(parent); }
      catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this.load(this.catalog);
  }

  async clearCache() {
    await rm(this.cache, { recursive: true, force: true });
  }
}
