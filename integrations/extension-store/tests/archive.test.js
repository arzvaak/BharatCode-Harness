import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { validateArchive } from "../src/archive.js";
import { archive } from "./fixtures.js";
test("archive identity must agree with the signed descriptor", () => {
  const bytes = archive({ name: "test-tool", version: "1.0.0" });
  assert.equal(
    validateArchive(bytes, { packageName: "test-tool", version: "1.0.0" }).name,
    "test-tool",
  );
  assert.throws(
    () => validateArchive(bytes, { packageName: "another", version: "1.0.0" }),
    /identity/,
  );
  assert.throws(
    () =>
      validateArchive(bytes, { packageName: "test-tool", version: "2.0.0" }),
    /identity/,
  );
});
test("malformed and overflowing archives are rejected", () => {
  assert.throws(() => validateArchive(Buffer.from("bad"), {}));
  assert.throws(() => validateArchive(gzipSync(Buffer.alloc(512, 65)), {}));
});
