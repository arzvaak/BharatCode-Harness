import semver from "semver";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { validateArchive } from "./archive.js";
import { ManagedDependencyStore } from './managed-dependencies.js';
import { inspectDependencies } from './dependencies.js';
import { isPythonDependency } from './dependency-groups.js';
import {
  verifyCatalog,
  canInstall,
  validateCatalog,
  validateInstalledState,
} from "./contracts.js";
async function atomic(path, bytes) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { mode: 0o600 });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
const ok = (result) => {
  if (
    result?.error ||
    !["applied", "restart-required"].includes(result?.application)
  )
    throw Error(
      "Package operation failed; inspect native plugin-manager diagnostics",
    );
  return result;
};
function releaseAssetMap(rows) {
  if (!Array.isArray(rows)) throw Error('Invalid release asset inventory');
  const assets = new Map();
  const ids = new Set();
  for (const asset of rows) {
    if (!asset || typeof asset.name !== 'string' || !asset.name || asset.name.length > 512
      || !Number.isSafeInteger(asset.id) || asset.id < 1 || ids.has(asset.id)
      || !Number.isSafeInteger(asset.size) || asset.size < 1 || assets.has(asset.name))
      throw Error('Invalid or duplicate release asset inventory');
    assets.set(asset.name, { id: asset.id, size: asset.size });
    ids.add(asset.id);
  }
  return assets;
}
function validateManagedReleaseAssets(catalog, assets) {
  for (const bundle of catalog.managedDependencies ?? []) {
    if (bundle.status !== 'qualified') continue;
    for (const platform of bundle.platforms) {
      const artifact = bundle.artifacts[platform];
      const asset = assets.get(artifact.assetName);
      if (!asset || asset.size !== artifact.bytes || (artifact.assetId !== undefined && asset.id !== artifact.assetId))
        throw Error('Managed dependency artifact differs from the signed release inventory');
    }
  }
}
export class ExtensionStore {
  constructor(options) {
    this.options = options;
    this.catalog = validateCatalog(
      options.seed ?? {
        schemaVersion: 1,
        revision: 1,
        channel: "preview",
        entries: [],
      },
    );
    this.installed = [];
    this.workspaceEnabled = [];
    this.releaseAssets = new Map();
    this.archives = [];
    this.queue = Promise.resolve();
    this.operations = new Map();
    this.dependencies = new ManagedDependencyStore({
      directory: options.directory,
      transport: options.transport,
      platform: options.platform,
      subprocess: options.subprocess,
      probeRunner: options.dependencyProbeRunner,
      assetResolver: name => this.releaseAssets.get(name),
    });
    this.diagnostic = "No signed catalog fetched yet";
  }
  exclusive(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }
  async load() {
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    try {
      const envelope = JSON.parse(
        await readFile(
          join(this.options.directory, "catalog-envelope.json"),
          "utf8",
        ),
      );
      const bytes = Buffer.from(envelope.bytes, "base64");
      this.catalog = verifyCatalog(
        bytes,
        envelope.signature,
        this.options.publicKey,
      );
      try {
        this.releaseAssets = releaseAssetMap(envelope.assets ?? []);
        validateManagedReleaseAssets(this.catalog, this.releaseAssets);
      } catch {
        this.releaseAssets = new Map();
      }
      this.verifiedHash = createHash("sha256").update(bytes).digest("hex");
      this.diagnostic = "Verified cached catalog";
    } catch (error) {
      if (error.code !== "ENOENT")
        this.diagnostic = "Cached catalog unavailable or invalid";
    }
    try {
      const native = this.options.persistence
        ? await this.options.persistence.read()
        : undefined;
      let x = native;
      if (x === undefined) {
        try {
          x = JSON.parse(
            await readFile(
              join(this.options.directory, "installed.json"),
              "utf8",
            ),
          );
        } catch (e) {
          if (e.code === "ENOENT") x = { schemaVersion: 1, records: [], workspaceEnabled: [] };
          else throw e;
        }
      }
      const state = validateInstalledState(x);
      this.installed = state.records;
      this.workspaceEnabled = state.workspaceEnabled;
    } catch (error) {
      if (error.code !== "ENOENT")
        throw Error(
          "Installed extension state is invalid; preserve it for recovery",
      );
    }
    await this.dependencies.load(this.catalog);
  }
  async downloaded() {
    const directory = join(this.options.directory, "archives");
    try {
      this.archives = await Promise.all(
        (await readdir(directory))
          .filter((f) => /^[a-f0-9]{64}\.tgz$/.test(f))
          .map(async (f) => ({
            sha256: f.slice(0, -4),
            bytes: (await stat(join(directory, f))).size,
          })),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.archives = [];
    }
  }
  async save() {
    if (this.options.persistence) {
      await this.options.persistence.write({
        schemaVersion: 1,
        records: this.installed,
        workspaceEnabled: this.workspaceEnabled,
      });
      return;
    }
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    await atomic(
      join(this.options.directory, "installed.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          records: this.installed,
          workspaceEnabled: this.workspaceEnabled,
        },
        null,
        2,
      ),
    );
  }
  view() {
    return structuredClone({
      catalog: this.catalog,
      installed: this.installed,
      workspaceEnabled: this.workspaceEnabled,
      diagnostic: this.diagnostic,
      platform: this.options.platform,
      bcVersion: this.options.bcVersion,
      archives: this.archives,
      operations: [...this.operations.keys()],
      managedDependencies: this.dependencies.view(),
    });
  }
  refresh(signal) {
    return this.exclusive(async () => {
      const releases = JSON.parse(
        (
          await this.options.transport.request("/releases", { signal })
        ).toString(),
      );
      if (!Array.isArray(releases)) throw Error("Invalid release inventory");
      const candidates = releases
        .filter((x) => /^extensions-preview-[0-9]+$/.test(x.tag_name))
        .sort(
          (a, b) =>
            Number(b.tag_name.split("-").at(-1)) -
            Number(a.tag_name.split("-").at(-1)),
        );
      let last;
      for (const r of candidates) {
        try {
          const json = r.assets.find((a) => a.name === "catalog.json"),
            sig = r.assets.find((a) => a.name === "catalog.sig");
          if (!json || !sig) continue;
          const bytes = await this.options.transport.asset(json.id, { signal });
          const signature = (
            await this.options.transport.asset(sig.id, {
              signal,
              maxBytes: 512,
            })
          )
            .toString()
            .trim();
          const value = verifyCatalog(bytes, signature, this.options.publicKey);
          if (
            value.channel !== "preview" ||
            value.revision !== Number(r.tag_name.split("-").at(-1)) ||
            value.revision < this.catalog.revision
          )
            throw Error("Catalog revision or channel mismatch");
          const releaseAssets = releaseAssetMap(r.assets);
          validateManagedReleaseAssets(value, releaseAssets);
          const prior = this.catalog;
          if (
            value.revision === prior.revision &&
            this.verifiedHash &&
            this.verifiedHash !==
              createHash("sha256").update(bytes).digest("hex")
          )
            throw Error("Published catalog revision was replaced");
          await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
          await atomic(
            join(this.options.directory, "catalog-envelope.json"),
            JSON.stringify({ bytes: bytes.toString("base64"), signature,
              assets: [...releaseAssets].map(([name, asset]) => ({ name, ...asset })) }),
          );
          this.catalog = value;
          this.releaseAssets = releaseAssets;
          this.verifiedHash = createHash("sha256").update(bytes).digest("hex");
          this.diagnostic = "Verified public preview catalog";
          await this.dependencies.load(value);
          return this.view();
        } catch (e) {
          if (signal?.aborted) throw e;
          last = e;
        }
      }
      throw last ?? Error("No signed extension catalog release is available");
    });
  }
  install(id, signal) {
    return this.exclusive(async () => {
      const entry = this.catalog.entries.find((e) => e.id === id);
      if (
        !entry ||
        !canInstall(entry, this.options.platform, this.options.bcVersion)
      )
        throw Error(
          "Extension is not qualified for this BC version and platform",
        );
      if (!entry.packageName)
        throw Error("Extension package identity is missing");
      const previous = this.installed.find((r) => r.id === id);
      if (previous) {
        if (previous.descriptor.packageName !== entry.packageName)
          throw Error("Package identity changes require a qualified migration");
        if (semver.lt(entry.version, previous.descriptor.version))
          throw Error("Unsafe downgrade refused; no qualified rollback route");
        if (previous.enabled || this.workspaceEnabled.some(([, i]) => i === id))
          throw Error("Disable this extension in every scope before updating");
        if (
          entry.version === previous.descriptor.version &&
          entry.artifact.sha256 !== previous.descriptor.artifact.sha256
        )
          throw Error("Immutable package version was replaced");
        if (
          entry.version !== previous.descriptor.version &&
          !entry.updateFrom?.includes(previous.descriptor.version)
        )
          throw Error("This update has no qualified migration declaration");
      }
      const requestId = randomUUID();
      const abort = new AbortController();
      const cancel = signal
        ? AbortSignal.any([signal, abort.signal])
        : abort.signal;
      this.operations.set(requestId, abort);
      try {
        const bytes = await this.options.transport.asset(
          entry.artifact.assetId,
          {
            signal: cancel,
            maxBytes: entry.artifact.bytes,
          },
        );
        cancel.throwIfAborted();
        if (
          bytes.length !== entry.artifact.bytes ||
          createHash("sha256").update(bytes).digest("hex") !==
            entry.artifact.sha256
        )
          throw Error("Extension artifact integrity mismatch");
        validateArchive(bytes, entry);
        const directory = join(this.options.directory, "archives");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = join(directory, entry.artifact.sha256 + ".tgz");
        await atomic(path, bytes);
        await this.downloaded();
        cancel.throwIfAborted();
        const cancelManager = () =>
          void this.options.manager.cancelInstall?.(requestId);
        cancel.addEventListener("abort", cancelManager, { once: true });
        let result;
        try {
          result = ok(
            await this.options.manager.installBundle(path, {
              enabled: false,
              requestId,
            }),
          );
        } finally {
          cancel.removeEventListener("abort", cancelManager);
        }
        const prior = this.installed.find((x) => x.id === id);
        this.installed = this.installed.filter((x) => x.id !== id);
        this.installed.push({
          id,
          descriptor: structuredClone(entry),
          previous: prior?.descriptor,
          enabled: false,
          application: result.application,
        });
        await this.save();
        return this.view();
      } finally {
        this.operations.delete(requestId);
      }
    });
  }
  cancel(requestId) {
    const operation = this.operations.get(requestId);
    if (!operation) return false;
    operation.abort();
    return true;
  }
  async installDependencies(id, signal) {
    return this.exclusive(async () => {
      const entry = this.catalog.entries.find(candidate => candidate.id === id);
      if (!entry || entry.kind !== 'mcp' || !canInstall(entry, this.options.platform, this.options.bcVersion)
        || !this.installed.some(record => record.id === id))
        throw Error('Install a qualified MCP extension before setting up its managed dependencies');
      const requestId = randomUUID();
      const abort = new AbortController();
      const cancel = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
      this.operations.set(requestId, abort);
      try {
        const inspected = await this.inspectEntryDependencies(entry, cancel);
        cancel.throwIfAborted();
        const missing = (entry.dependencyIds ?? []).filter(id => !inspected.find(result => result.id === id)?.available);
        const pythonIds = (entry.dependencyIds ?? []).filter(isPythonDependency);
        const missingPython = missing.filter(id => pythonIds.includes(id));
        const installedNonPythonInvalid = missing.filter(dependencyId => !pythonIds.includes(dependencyId)
          && this.dependencies.installedBundle(dependencyId, entry.dependencyRanges?.[dependencyId] ?? '*'));
        if (installedNonPythonInvalid.length)
          throw Error(`Remove the existing managed runtime before setting it up again: ${installedNonPythonInvalid.join(', ')}`);
        const plan = [];
        if (missingPython.length) {
          if (this.dependencies.pythonBundleFor(pythonIds, entry.dependencyRanges ?? {}, true))
            throw Error(`Remove the existing managed Python runtime before setting it up again: ${pythonIds.join(', ')}`);
          const bundle = this.dependencies.pythonBundleFor(pythonIds, entry.dependencyRanges ?? {});
          if (!bundle)
            throw Error(`No single qualified managed runtime covers the Python requirements: ${pythonIds.join(', ')}`);
          plan.push(bundle);
        }
        plan.push(...this.dependencies.plan(missing.filter(id => !pythonIds.includes(id)), entry.dependencyRanges ?? {}));
        for (const bundle of plan) {
          cancel.throwIfAborted();
          await this.dependencies.install(bundle, cancel);
        }
        await this.dependencies.load(this.catalog);
        return this.view();
      } finally {
        this.operations.delete(requestId);
      }
    });
  }
  async inspectEntryDependencies(entry, signal, { managed = true } = {}) {
    const ids = entry.dependencyIds ?? [];
    const ranges = entry.dependencyRanges ?? {};
    const installed = new Map(ids.map(dependencyId => [dependencyId,
      managed ? this.dependencies.installedBundle(dependencyId, ranges[dependencyId] ?? '*') : undefined]));
    const commands = managed ? await this.dependencies.commandsFor(ids, ranges) : {};
    const pythonIds = ids.filter(isPythonDependency);
    const pythonBundle = managed ? this.dependencies.pythonBundleFor(pythonIds, ranges, true) : undefined;
    const availablePythonBundle = managed ? this.dependencies.pythonBundleFor(pythonIds, ranges) : undefined;
    const managedStatus = Object.fromEntries(ids.map(dependencyId => {
      const pythonDependency = pythonIds.includes(dependencyId);
      return [dependencyId, !managed ? 'unavailable'
        : pythonDependency ? pythonBundle ? 'installed' : availablePythonBundle ? 'available' : 'unavailable'
          : installed.get(dependencyId) ? 'installed'
            : this.dependencies.hasQualifiedBundle(dependencyId, ranges[dependencyId] ?? '*') ? 'available' : 'unavailable'];
    }));
    const expectedVersions = Object.fromEntries(ids.flatMap(dependencyId => {
      if (pythonIds.includes(dependencyId))
        return pythonBundle && Object.hasOwn(pythonBundle.provides, dependencyId)
          ? [[dependencyId, pythonBundle.provides[dependencyId]]] : [];
      const record = installed.get(dependencyId);
      return record ? [[dependencyId, record.bundle.provides[dependencyId]]] : [];
    }));
    const results = await inspectDependencies(entry.dependencyIds ?? [], {
      platform: this.options.platform,
      commands,
      ranges,
      managed: managedStatus,
      expectedVersions,
      runner: this.options.dependencyProbeRunner,
      subprocess: this.options.subprocess,
      signal,
    });
    return results;
  }
  async resolveRuntimeCommand(entry, command) {
    const dependencyIds = entry.dependencyIds ?? [];
    if (command === 'python' || command === 'python3') {
      return this.dependencies.resolvePythonFor(dependencyIds, entry.dependencyRanges ?? {});
    }
    if (!dependencyIds.includes(command)) return undefined;
    return this.dependencies.resolveCommand(command, entry.dependencyRanges?.[command] ?? '*');
  }
  async removeDependency(bundleId, version) {
    return this.exclusive(async () => {
      const record = this.dependencies.records.find(item => item.id === bundleId && item.version === version);
      if (!record) throw Error('Managed runtime is not installed');
      const provided = record.verified ? new Set(Object.keys(record.bundle.provides)) : undefined;
      for (const installed of this.installed) {
        const active = installed.enabled || this.workspaceEnabled.some(([, id]) => id === installed.id);
        const dependencies = installed.descriptor.dependencyIds ?? [];
        if (active && (provided ? dependencies.some(id => provided.has(id)) : dependencies.length > 0))
          throw Error('Disable dependent extensions in every scope before removing this runtime');
      }
      await this.dependencies.remove(bundleId, version);
      return this.view();
    });
  }
  async activation(workspace, id, enabled) {
    return this.exclusive(async () => {
      const record = this.installed.find((r) => r.id === id);
      if (!record || record.descriptor.scope !== "session")
        throw Error("Workspace-scoped installed extension required");
      this.workspaceEnabled = this.workspaceEnabled.filter(
        ([w, i]) => w !== workspace || i !== id,
      );
      if (enabled) this.workspaceEnabled.push([workspace, id]);
      await this.save();
      return this.view();
    });
  }
  async profileEnabled(id, enabled) {
    return this.exclusive(async () => {
      const record = this.installed.find((r) => r.id === id);
      if (!record || record.descriptor.scope !== "profile")
        throw Error("Not a profile-global installed extension");
      ok(
        await this.options.manager.setBundleEnabled(
          record.descriptor.packageName,
          enabled,
        ),
      );
      record.enabled = enabled;
      await this.save();
      return this.view();
    });
  }
  async remove(id) {
    return this.exclusive(async () => {
      const record = this.installed.find((r) => r.id === id);
      if (!record) throw Error("Extension not installed");
      ok(
        await this.options.manager.removeBundle(record.descriptor.packageName),
      );
      this.installed = this.installed.filter((r) => r.id !== id);
      this.workspaceEnabled = this.workspaceEnabled.filter(([, i]) => i !== id);
      await this.save();
      return this.view();
    });
  }
  async rollback() {
    throw Error(
      "No released extension declares a qualified reversible migration; downgrade is unavailable",
    );
  }
  async clearCache() {
    return this.exclusive(async () => {
      await rm(join(this.options.directory, "archives"), {
        recursive: true,
        force: true,
      });
      await this.dependencies.clearCache();
      await this.downloaded();
      return this.view();
    });
  }
  async dispose() {
    for (const x of this.operations.values()) x.abort();
    await this.queue;
  }
}
