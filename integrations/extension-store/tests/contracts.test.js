import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  validateCatalog,
  verifyCatalog,
  canInstall,
} from "../src/contracts.js";
const entry = {
  id: "duckdb",
  packageName: "duckdb-mcp",
  name: "DuckDB",
  kind: "mcp",
  version: "1.0.0",
  sourceCommit: "a".repeat(40),
  source: "https://github.com/motherduckdb/mcp-server-motherduck",
  license: "MIT",
  scope: "session",
  platforms: ["linux", "win32"],
  bcVersion: "0.2.0-rc.2",
  status: "qualified",
  requirements: [],
  qualification: {
    linux: ["packed-install", "lifecycle", "workflow"],
    win32: ["packed-install", "lifecycle", "workflow"],
  },
  artifact: { assetId: 123, sha256: "a".repeat(64), bytes: 100 },
  tools: ["query"],
  runtime: {
    transport: "stdio",
    command: "python",
    args: ["-m", "duckdb_mcp"],
  },
};
entry.qualificationEvidence = entry.platforms.flatMap(platform => ['packed-install', 'lifecycle', 'workflow'].map(check => ({
  platform, check, sourceCommit: entry.sourceCommit, artifactSha256: entry.artifact.sha256,
  result: 'passed', evidence: 'https://github.com/arzvaak/Bharatcode-Harness/actions/runs/123',
})));
const catalog = () => ({
  schemaVersion: 1,
  revision: 1,
  channel: "preview",
  entries: [structuredClone(entry)],
});
test("requires exact artifact and per-platform evidence before install", () => {
  assert.equal(canInstall(entry, "linux", "0.2.0-rc.2"), true);
  const e = structuredClone(entry);
  delete e.qualification.win32;
  assert.equal(canInstall(e, "win32", "0.2.0-rc.2"), false);
  delete e.artifact;
  assert.equal(canInstall(e, "linux", "0.2.0-rc.2"), false);
});
test("rejects duplicates, unsafe identifiers and unknown schema", () => {
  for (const mutate of [
    (x) => x.entries.push(x.entries[0]),
    (x) => (x.entries[0].id = "../escape"),
    (x) => (x.schemaVersion = 2),
    (x) => (x.entries[0].artifact.sha256 = "bad"),
    (x) => (x.entries[0].runtime.args = [1]),
    (x) => (x.entries[0].dependencyIds = ["../outside"]),
    (x) => (x.entries[0].dependencyIds = ["python", "python"]),
    (x) => (x.entries[0].dependencyRanges = { outside: "*" }),
    (x) => { x.entries[0].dependencyIds = ["python"]; x.entries[0].dependencyRanges = { python: "invalid" }; },
  ]) {
    const x = catalog();
    mutate(x);
    assert.throws(() => validateCatalog(x));
  }
});
test("verifies signature over exact bytes and rejects tampering", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from(JSON.stringify(catalog()));
  const signature = sign(null, bytes, privateKey).toString("base64");
  assert.equal(verifyCatalog(bytes, signature, publicKey).revision, 1);
  assert.throws(() =>
    verifyCatalog(
      Buffer.from(bytes.toString().replace("DuckDB", "FakeDB")),
      signature,
      publicKey,
    ),
  );
});
test("non-installable candidates remain valid catalog records", () => {
  const x = catalog();
  x.entries[0].status = "needs-account";
  delete x.entries[0].artifact;
  assert.equal(validateCatalog(x).entries.length, 1);
  assert.equal(canInstall(x.entries[0], "linux", "0.2.0-rc.2"), false);
});

test("supports declared BC version ranges independently of extension version", () => {
  const e = { ...entry, bcVersion: ">=0.2.0-rc.2 <0.3.0" };
  assert.equal(canInstall(e, "linux", "0.2.0-rc.3"), true);
  assert.equal(canInstall(e, "linux", "0.3.0"), false);
});

function managedPythonBundle() {
  const bundle = {
    id: "python-data-runtime",
    version: "3.12.14",
    source: "https://github.com/astral-sh/python-build-standalone",
    sourceCommit: "b".repeat(40),
    license: "PSF-2.0",
    status: "qualified",
    provides: { python: "3.12.14" },
    platforms: ["linux"],
    artifacts: {
      linux: { assetName: "python-data-runtime-linux.tgz", assetId: 234, bytes: 1024, sha256: "c".repeat(64), format: "tar.gz", unpackedBytes: 4096 },
    },
    commands: { linux: { python: "bin/python3" } },
  };
  bundle.qualificationEvidence = ["archive-safety", "version-probe", "cancellation", "removal"].map(check => ({
    platform: "linux", check, sourceCommit: bundle.sourceCommit, artifactSha256: bundle.artifacts.linux.sha256,
    result: "passed", evidence: "https://github.com/arzvaak/Bharatcode-Harness/actions/runs/123",
  }));
  return bundle;
}
test("managed runtime bundles require a qualified, hash-bound artifact for each platform", () => {
  const x = catalog();
  x.managedDependencies = [managedPythonBundle()];
  assert.equal(validateCatalog(x).managedDependencies.length, 1);
  for (const mutate of [
    value => value.managedDependencies.push(value.managedDependencies[0]),
    value => value.managedDependencies.push({ ...value.managedDependencies[0], id: 'other-python-runtime' }),
    value => { value.managedDependencies[0].artifacts.linux.sha256 = "bad"; },
    value => { value.managedDependencies[0].commands.linux.python = "../outside"; },
    value => { value.managedDependencies[0].artifacts.linux.bytes = 0; },
    value => { value.managedDependencies[0].qualificationEvidence[0].artifactSha256 = "d".repeat(64); },
    value => { value.managedDependencies[0].qualificationEvidence.pop(); },
    value => { value.managedDependencies[0].status = "unqualified"; },
    value => {
      value.managedDependencies[0].provides = { duckdb: '1.5.6' };
      value.managedDependencies[0].commands.linux = { duckdb: 'bin/duckdb' };
    },
  ]) {
    const invalid = catalog();
    invalid.managedDependencies = [managedPythonBundle()];
    mutate(invalid);
    assert.throws(() => validateCatalog(invalid));
  }
});

test("installed state refuses corrupt flags, duplicate identity and orphan activation", async () => {
  const { validateInstalledState } = await import("../src/contracts.js");
  assert.throws(() =>
    validateInstalledState({
      schemaVersion: 1,
      records: [],
      workspaceEnabled: [["a", "missing"]],
    }),
  );
  assert.throws(() =>
    validateInstalledState({
      schemaVersion: 1,
      records: [{ id: "x", enabled: "yes", application: "applied" }],
    }),
  );
  assert.deepEqual(
    validateInstalledState({ schemaVersion: 1, records: [] }).workspaceEnabled,
    [],
  );
});

test("checked-in discovery catalog obeys scope boundaries and never qualifies unknown releases", async () => {
  const { readFile } = await import("node:fs/promises");
  const seed = validateCatalog(
    JSON.parse(await readFile(new URL("../catalog.json", import.meta.url))),
  );
  assert.equal(seed.entries.length, 58);
  const latex = seed.entries.find(entry => entry.id === 'bc-latex-documents');
  assert.equal(latex.status, 'bundled');
  assert.deepEqual(latex.dependencyIds, ['pdflatex', 'latexmk']);
  assert.ok(seed.entries.find(entry => entry.id === 'publishing-pack').components.includes(latex.id));
  assert.ok(seed.entries.every((entry) => entry.status !== "qualified"));
  const unsafe = { ...entry, credentialReference: "OPENAI_API_KEY" };
  assert.throws(
    () => validateCatalog({ ...catalog(), entries: [unsafe] }),
    /credential/,
  );
});
test('qualification must identify the exact source and immutable artifact for every advertised platform', () => {
  for (const mutate of [
    e => delete e.qualificationEvidence,
    e => { e.qualificationEvidence[0].artifactSha256 = 'b'.repeat(64); },
    e => { e.qualificationEvidence[0].sourceCommit = 'b'.repeat(40); },
    e => { e.qualificationEvidence[0].result = 'blocked'; },
    e => { e.qualificationEvidence = e.qualificationEvidence.filter(x => x.platform !== 'win32'); },
    e => { e.qualificationEvidence[0].evidence = 'javascript:untrusted'; },
    e => { e.qualificationEvidence[0].sourceCommit = [entry.sourceCommit]; },
    e => { e.qualificationEvidence.push({ ...e.qualificationEvidence[0] }); },
    e => { e.qualificationEvidence.push({ ...e.qualificationEvidence[0], platform: 'darwin' }); },
  ]) {
    const value = catalog();
    value.entries[0].qualificationEvidence = ['linux', 'win32'].flatMap(platform => ['packed-install', 'lifecycle', 'workflow'].map(check => ({
      platform, check, sourceCommit: entry.sourceCommit, artifactSha256: entry.artifact.sha256,
      result: 'passed', evidence: 'https://github.com/arzvaak/Bharatcode-Harness/actions/runs/123',
    })));
    mutate(value.entries[0]);
    assert.throws(() => validateCatalog(value), /qualification|incomplete/i);
    assert.equal(canInstall(value.entries[0], 'linux', '0.2.0-rc.2'), false);
  }
});
