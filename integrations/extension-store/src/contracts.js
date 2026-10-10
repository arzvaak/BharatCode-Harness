import semver from "semver";
import { verify } from "node:crypto";
import { DEPENDENCY_IDS } from './dependencies.js';
export const SCHEMA_VERSION = 1;
export const REQUIRED_EVIDENCE = ["packed-install", "lifecycle", "workflow"];
export const REQUIRED_MANAGED_EVIDENCE = ["archive-safety", "version-probe", "cancellation", "removal"];
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
function validEvidence(record) {
  if (!object(record) || !['linux', 'win32', 'darwin', 'web'].includes(record.platform)
    || !REQUIRED_EVIDENCE.includes(record.check) || !['passed', 'failed', 'blocked'].includes(record.result)
    || typeof record.sourceCommit !== 'string' || !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(record.sourceCommit)
    || typeof record.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.artifactSha256) || !text(record.evidence)) return false;
  try { const url = new URL(record.evidence); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
function exactQualification(entry) {
  const records = entry.qualificationEvidence;
  return Array.isArray(records) && records.length <= 12 && records.every(record => validEvidence(record) && entry.platforms.includes(record.platform))
    && new Set(records.map(r => r.platform + '/' + r.check)).size === records.length
    && entry.platforms.every(platform => REQUIRED_EVIDENCE.every(check => records.some(record =>
      record.platform === platform && record.check === check && record.result === 'passed'
      && record.sourceCommit === entry.sourceCommit && record.artifactSha256 === entry.artifact?.sha256)));
}
function validManagedEvidence(record, bundle) {
  if (!object(record) || !bundle.platforms.includes(record.platform)
    || !REQUIRED_MANAGED_EVIDENCE.includes(record.check)
    || !["passed", "failed", "blocked"].includes(record.result)
    || record.sourceCommit !== bundle.sourceCommit
    || record.artifactSha256 !== bundle.artifacts?.[record.platform]?.sha256
    || !text(record.evidence)) return false;
  try { const url = new URL(record.evidence); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}
function validManagedPath(path) {
  return typeof path === "string" && path.length <= 512 && !path.includes("\\")
    && !path.startsWith("/") && !path.includes("\0")
    && path.split("/").every(part => part && part !== "." && part !== ".." && /^[A-Za-z0-9_+.-]+$/.test(part));
}
function validateManagedDependencies(bundles) {
  if (bundles === undefined) return;
  if (!Array.isArray(bundles) || bundles.length > 128) throw Error("Invalid managed dependency catalog");
  const ids = new Set();
  const assetNames = new Set();
  for (const bundle of bundles) {
    if (!object(bundle) || !text(bundle.id) || !/^[-a-z0-9]+$/.test(bundle.id) || ids.has(bundle.id)
      || !semver.valid(bundle.version) || !text(bundle.source) || !text(bundle.license)
      || bundle.license === "UNRESOLVED" || !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(bundle.sourceCommit ?? "")
      || !["qualified", "needs-qualification"].includes(bundle.status)
      || !strings(bundle.platforms) || !bundle.platforms.length
      || new Set(bundle.platforms).size !== bundle.platforms.length
      || !bundle.platforms.every(platform => ["linux", "win32", "darwin"].includes(platform))
      || !object(bundle.provides) || !Object.keys(bundle.provides).length
      || Object.entries(bundle.provides).some(([id, version]) => !DEPENDENCY_IDS.includes(id) || !semver.valid(version)))
      throw Error("Invalid managed dependency descriptor");
    ids.add(bundle.id);
    if (bundle.architecture !== undefined && !['x64', 'arm64'].includes(bundle.architecture))
      throw Error('Invalid managed dependency architecture');
    let source;
    try { source = new URL(bundle.source); } catch { throw Error("Invalid managed dependency source"); }
    if (source.protocol !== "https:" || source.username || source.password) throw Error("Invalid managed dependency source");
    if (!object(bundle.artifacts) || !object(bundle.commands)
      || Object.keys(bundle.artifacts).some(platform => !bundle.platforms.includes(platform))
      || Object.keys(bundle.commands).some(platform => !bundle.platforms.includes(platform)))
      throw Error("Invalid managed dependency platform artifacts");
    for (const platform of bundle.platforms) {
      const artifact = bundle.artifacts[platform];
      const commands = bundle.commands[platform];
      if (artifact !== undefined && (!object(artifact)
        || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(artifact.assetName ?? "")
        || (artifact.assetId !== undefined && (!Number.isSafeInteger(artifact.assetId) || artifact.assetId < 1))
        || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 512 * 1024 * 1024
        || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "") || artifact.format !== "tar.gz"
        || !Number.isSafeInteger(artifact.unpackedBytes) || artifact.unpackedBytes < 1 || artifact.unpackedBytes > 1024 * 1024 * 1024))
        throw Error("Invalid managed dependency artifact");
      if (artifact && assetNames.has(artifact.assetName))
        throw Error("Managed dependency artifact names must be unique");
      if (artifact) assetNames.add(artifact.assetName);
      if (commands !== undefined && (!object(commands) || !Object.keys(commands).length
        || Object.entries(commands).some(([id, path]) => !Object.hasOwn(bundle.provides, id) || !validManagedPath(path))))
        throw Error("Invalid managed dependency command map");
      if (bundle.status === "qualified" && (!artifact || !commands))
        throw Error("Qualified managed dependency requires a platform artifact and command map");
      if (bundle.status === "qualified" && (Object.keys(bundle.provides).some(id =>
        id !== "jupyter" && id !== "duckdb" && !Object.hasOwn(commands, id))
        || Object.keys(bundle.provides).some(id => ["jupyter", "duckdb"].includes(id)
          && (!Object.hasOwn(bundle.provides, "python") || !Object.hasOwn(commands, "python")))))
        throw Error("Qualified managed dependency is missing an executable for a provided runtime");
    }
    if (bundle.qualificationEvidence !== undefined) {
      const records = bundle.qualificationEvidence;
      if (!Array.isArray(records) || records.length > 36 || !records.every(record => validManagedEvidence(record, bundle))
        || new Set(records.map(record => record.platform + "/" + record.check)).size !== records.length)
        throw Error("Invalid managed dependency qualification evidence");
    }
    if (bundle.status === "qualified" && (!Array.isArray(bundle.qualificationEvidence)
      || bundle.platforms.some(platform => REQUIRED_MANAGED_EVIDENCE.some(check => !bundle.qualificationEvidence.some(record =>
        record.platform === platform && record.check === check && record.result === "passed")))))
      throw Error("Qualified managed dependency is missing platform evidence");
  }
}
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
  validateManagedDependencies(value.managedDependencies);
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
    if (e.dependencyRanges !== undefined && (!object(e.dependencyRanges)
      || Object.entries(e.dependencyRanges).some(([id, range]) => !(e.dependencyIds ?? []).includes(id)
        || typeof range !== 'string' || range.length > 256 || !semver.validRange(range))))
      throw Error(`Invalid dependency version requirements: ${e.id}`);

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
        !exactQualification(e) ||
        e.platforms.some(
          (p) =>
            !REQUIRED_EVIDENCE.every((x) => e.qualification?.[p]?.includes(x)),
        ))
    )
      throw Error("Qualified release is incomplete");
    if (e.qualificationEvidence !== undefined && (!Array.isArray(e.qualificationEvidence)
      || e.qualificationEvidence.length > 12 || !e.qualificationEvidence.every(validEvidence)
      || e.qualificationEvidence.some(record => !e.platforms.includes(record.platform))
      || new Set(e.qualificationEvidence.map(r => r.platform + '/' + r.check)).size !== e.qualificationEvidence.length))
      throw Error('Invalid qualification evidence records');
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
    exactQualification(e) &&
    REQUIRED_EVIDENCE.every((x) => e.qualification?.[platform]?.includes(x))
  );
}
export function canInstallManagedDependency(bundle, platform, dependencyId, range = "*", architecture = process.arch) {
  if (!bundle || bundle.status !== "qualified" || !bundle.platforms.includes(platform)
    || (bundle.architecture !== undefined && bundle.architecture !== architecture)
    || !bundle.artifacts?.[platform] || !bundle.commands?.[platform]
    || !Object.hasOwn(bundle.provides ?? {}, dependencyId)
    || !semver.validRange(range)) return false;
  const expected = bundle.artifacts[platform].sha256;
  return REQUIRED_MANAGED_EVIDENCE.every(check => bundle.qualificationEvidence?.some(record =>
    record.platform === platform && record.check === check && record.result === "passed"
      && record.sourceCommit === bundle.sourceCommit && record.artifactSha256 === expected))
    && semver.satisfies(bundle.provides[dependencyId], range);
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
