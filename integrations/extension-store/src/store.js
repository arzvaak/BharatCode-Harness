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
    this.archives = [];
    this.queue = Promise.resolve();
    this.operations = new Map();
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
          if (e.code === "ENOENT") return;
          throw e;
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
            JSON.stringify({ bytes: bytes.toString("base64"), signature }),
          );
          this.catalog = value;
          this.verifiedHash = createHash("sha256").update(bytes).digest("hex");
          this.diagnostic = "Verified private preview catalog";
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
      await this.downloaded();
      return this.view();
    });
  }
  async dispose() {
    for (const x of this.operations.values()) x.abort();
    await this.queue;
  }
}
