import semver from "semver";
import { verify } from "node:crypto";
import { DEPENDENCY_IDS } from './dependencies.js';
export const SCHEMA_VERSION = 1;
export const REQUIRED_EVIDENCE = ["packed-install", "lifecycle", "workflow"];
export const STATUSES = [
  "bundled",
  "qualified",
  "needs-qualification",
  "needs-account",
  "needs-adaptation",
  "license-review",
  "client-restricted",
  "web-only",
];
const text = (x) => typeof x === "string" && x.length > 0 && x.length <= 4096;
const strings = (x) => Array.isArray(x) && x.length <= 256 && x.every(text);
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
export function validateCatalog(value) {
  if (
    !object(value) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !["preview", "stable"].includes(value.channel) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 1000
  )
    throw Error("Invalid catalog header");
  const ids = new Set();
  for (const e of value.entries) {
    if (
      !object(e) ||
      !text(e.id) ||
      !/^[-a-z0-9]+$/.test(e.id) ||
      ids.has(e.id)
    )
      throw Error("Invalid or duplicate extension ID");
    ids.add(e.id);
    if (
      !text(e.name) ||
      !["native", "mcp", "skill", "pack"].includes(e.kind) ||
      !text(e.version) ||
      !text(e.source) ||
      !text(e.license) ||
      !["profile", "session"].includes(e.scope) ||
      !strings(e.platforms) ||
      !e.platforms.every((p) =>
        ["linux", "win32", "darwin", "web"].includes(p),
      ) ||
      !text(e.bcVersion) ||
      !semver.validRange(e.bcVersion) ||
      !STATUSES.includes(e.status) ||
      !strings(e.requirements) ||
      !strings(e.tools ?? [])
    )
      throw Error(`Invalid descriptor: ${e.id}`);
    if (e.dependencyIds !== undefined && (!Array.isArray(e.dependencyIds)
      || new Set(e.dependencyIds).size !== e.dependencyIds.length
      || e.dependencyIds.some(id => !DEPENDENCY_IDS.includes(id))))
      throw Error('Invalid dependency requirements');
    if (
      (e.kind === "native" && e.scope !== "profile") ||
      (e.kind === "mcp" && e.scope !== "session")
    )
      throw Error("Unsupported activation scope for extension kind");
    if (
      e.credentialReference !== undefined &&
      e.credentialReference !==
        `BC_EXT_${e.id.replaceAll("-", "_").toUpperCase()}_TOKEN`
    )
      throw Error("Connection credential must belong to this extension");
    if (
      e.status === "qualified" &&
      e.kind === "mcp" &&
      (!e.runtime || !e.tools?.length)
    )
      throw Error("Qualified connector requires runtime and selected tools");
    let source;
    try {
      source = new URL(e.source);
    } catch {
      throw Error("Invalid source URL");
    }
    if (source.protocol !== "https:" || source.username || source.password)
      throw Error("Invalid source URL");
    if (
      e.status === "qualified" &&
      (!semver.valid(e.version) ||
        !text(e.packageName) ||
        !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(e.packageName))
    )
      throw Error("Qualified package identity required");
    if (
      e.artifact &&
      (!object(e.artifact) ||
        !Number.isSafeInteger(e.artifact.assetId) ||
        e.artifact.assetId < 1 ||
        !Number.isSafeInteger(e.artifact.bytes) ||
        e.artifact.bytes < 1 ||
        e.artifact.bytes > 512 * 1024 * 1024 ||
        !/^\b[a-f0-9]{64}$/.test(e.artifact.sha256))
    )
      throw Error("Invalid artifact identity");
    if (
      e.status === "qualified" &&
      (!e.artifact ||
        !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(e.sourceCommit ?? "") ||
        e.license === "UNRESOLVED" ||
        !e.platforms.length ||
        e.platforms.some(
          (p) =>
            !REQUIRED_EVIDENCE.every((x) => e.qualification?.[p]?.includes(x)),
        ))
    )
      throw Error("Qualified release is incomplete");
    if (
      e.qualification !== undefined &&
      (!object(e.qualification) ||
        Object.entries(e.qualification).some(
          ([p, v]) => !e.platforms.includes(p) || !strings(v),
        ))
    )
      throw Error("Invalid qualification evidence");
    if (e.runtime) {
      const r = e.runtime;
      if (!object(r) || !["stdio", "streamable-http"].includes(r.transport))
        throw Error("Invalid runtime");
      if (
        r.transport === "stdio" &&
        (!text(r.command) || !strings(r.args ?? []))
      )
        throw Error("Invalid stdio runtime");
      if (r.transport === "streamable-http") {
        let u;
        try {
          u = new URL(r.url);
        } catch {
          throw Error("Invalid endpoint");
        }
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          u.hash ||
          u.search
        )
          throw Error("Invalid endpoint");
      }
    }
    if (e.updateFrom !== undefined && !strings(e.updateFrom))
      throw Error("Invalid migration declaration");
    if (
      e.components !== undefined &&
      (!strings(e.components) || e.kind !== "pack")
    )
      throw Error("Invalid pack components");
  }
  for (const e of value.entries)
    if (
      e.components?.some(
        (id) =>
          id === e.id ||
          !ids.has(id) ||
          value.entries.find((x) => x.id === id)?.kind === "pack",
      )
    )
      throw Error("Invalid pack dependency");
  return value;
}
export function canInstall(e, platform, bcVersion) {
  return (
    e.status === "qualified" &&
    semver.satisfies(bcVersion, e.bcVersion, { includePrerelease: true }) &&
    e.platforms.includes(platform) &&
    Boolean(e.artifact) &&
    REQUIRED_EVIDENCE.every((x) => e.qualification?.[platform]?.includes(x))
  );
}
export function verifyCatalog(bytes, signature, publicKey) {
  if (
    bytes.length > 4 * 1024 * 1024 ||
    !publicKey ||
    !/^[-A-Za-z0-9+/=]+$/.test(signature) ||
    !verify(null, bytes, publicKey, Buffer.from(signature, "base64"))
  )
    throw Error("Catalog signature verification failed");
  return validateCatalog(JSON.parse(bytes.toString("utf8")));
}

/** Validate persisted ownership before any activation is restored. */
export function validateInstalledState(value) {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > 1000
  )
    throw Error("Invalid installed state");
  const ids = new Map();
  for (const record of value.records) {
    if (
      !object(record) ||
      typeof record.enabled !== "boolean" ||
      !["applied", "restart-required"].includes(record.application)
    )
      throw Error("Invalid installed record");
    validateCatalog({
      schemaVersion: 1,
      revision: 1,
      channel: "preview",
      entries: [record.descriptor],
    });
    if (
      record.id !== record.descriptor.id ||
      ids.has(record.id) ||
      record.descriptor.status !== "qualified"
    )
      throw Error("Invalid installed identity");
    if (record.previous !== undefined) {
      validateCatalog({
        schemaVersion: 1,
        revision: 1,
        channel: "preview",
        entries: [record.previous],
      });
      if (
        record.previous.id !== record.id ||
        record.previous.packageName !== record.descriptor.packageName
      )
        throw Error("Invalid previous release");
    }
    ids.set(record.id, record);
  }
  const activations = value.workspaceEnabled ?? [];
  const seen = new Set();
  if (!Array.isArray(activations) || activations.length > 10000)
    throw Error("Invalid workspace activation");
  for (const pair of activations) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !pair.every(text) ||
      ids.get(pair[1])?.descriptor.scope !== "session" ||
      seen.has(JSON.stringify(pair))
    )
      throw Error("Invalid workspace activation");
    seen.add(JSON.stringify(pair));
  }
  return { ...value, workspaceEnabled: activations };
}
