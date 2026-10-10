import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  signCatalog,
  promoteCatalog,
} from "../../../scripts/extensions/catalog-release.mjs";
import { verifyCatalog } from "../src/contracts.js";
const catalog = {
  schemaVersion: 1,
  revision: 4,
  channel: "preview",
  entries: [],
};
test("release signing preserves exact immutable catalog bytes", () => {
  const keys = generateKeyPairSync("ed25519");
  const bytes = Buffer.from(JSON.stringify(catalog));
  const result = signCatalog(bytes, keys.privateKey);
  assert.equal(result.bytes, bytes);
  assert.equal(
    verifyCatalog(result.bytes, result.signature, keys.publicKey).revision,
    4,
  );
});
test("promotion references original artifact hashes instead of rebuilding", () => {
  const manifest = {
    revision: 4,
    catalogSha256: "a".repeat(64),
    assets: [{ name: "tool.tgz", sha256: "b".repeat(64) }],
  };
  assert.deepEqual(promoteCatalog(manifest), {
    ...manifest,
    channel: "stable",
    sourceChannel: "preview",
  });
  assert.throws(() => promoteCatalog({ ...manifest, catalogSha256: "bad" }));
});
