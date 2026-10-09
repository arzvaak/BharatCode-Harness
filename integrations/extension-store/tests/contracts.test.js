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
  assert.equal(seed.entries.length, 57);
  assert.ok(seed.entries.every((entry) => entry.status !== "qualified"));
  const unsafe = { ...entry, credentialReference: "OPENAI_API_KEY" };
  assert.throws(
    () => validateCatalog({ ...catalog(), entries: [unsafe] }),
    /credential/,
  );
});
