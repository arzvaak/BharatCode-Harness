import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { qualifyPromotion, promoteVerified } from "../../../scripts/extensions/promotion.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const catalog = Buffer.from(JSON.stringify({ schemaVersion: 1, revision: 7, channel: "preview", entries: [] }));
  const archive = Buffer.from("fixture archive bytes");
  const manifest = {
    schemaVersion: 1, revision: 7, channel: "preview", commit: "a".repeat(40), publicationRunId: 91, publicationRunAttempt: 1,
    catalogSha256: hash(catalog),
    assets: [{ name: "fixture-1.0.0.tgz", bytes: archive.length, sha256: hash(archive), license: "MIT" }],
  };
  const values = new Map([
    ["catalog.json", catalog], ["catalog.sig", Buffer.from(sign(null, catalog, privateKey).toString("base64"))],
    ["release-manifest.json", Buffer.from(JSON.stringify(manifest))],
    ["release-manifest.sig", Buffer.from(sign(null, Buffer.from(JSON.stringify(manifest)), privateKey).toString("base64"))],
    ["fixture-1.0.0.tgz", archive],
  ]);
  return {
    publicKey, manifest, values,
    release: { id: 42, tag_name: "extensions-preview-7", draft: false, prerelease: true,
      assets: [...values].map(([name, bytes], i) => ({ id: i + 1, name, size: bytes.length })) },
    run: { id: 91, run_attempt: 1, head_sha: manifest.commit, status: "completed", conclusion: "success", path: ".github/workflows/extensions-preview.yml" },
    jobs: ["qualification / native (ubuntu-latest)", "qualification / native (windows-latest)", "qualification / verdict", "publish"].map(name => ({ name, run_attempt: 1, status: "completed", conclusion: "success" })),
    asset(id) { const name = this.release.assets.find(a => a.id === id).name; return Promise.resolve(this.values.get(name)); },
  };
}
test("promotion retains every published byte and returns only a release stability change", async () => {
  const f = fixture();
  const before = structuredClone(f.release);
  const result = await qualifyPromotion({ ...f, asset: f.asset.bind(f) });
  assert.deepEqual(result.patch, { prerelease: false });
  assert.equal(result.releaseId, 42);
  assert.deepEqual(f.release, before);
  assert.equal(result.catalogSha256, f.manifest.catalogSha256);
});
test("promotion refuses tampering, mismatched source and incomplete native evidence", async () => {
  for (const mutate of [
    f => f.values.set("fixture-1.0.0.tgz", Buffer.from("tampered archive bytes")),
    f => f.values.set("catalog.json", Buffer.from("{}")),
    f => f.values.set("release-manifest.json", Buffer.from(JSON.stringify({ ...f.manifest, commit: "b".repeat(40) }))),
    f => f.run.head_sha = "b".repeat(40),
    f => f.run.id = 92,
    f => f.run.run_attempt = 2,
    f => f.jobs[1].run_attempt = 2,
    f => f.run.path = ".github/workflows/ci.yml",
    f => f.jobs[1].conclusion = "skipped",
    f => f.jobs.pop(),
    f => f.release.assets.push({ ...f.release.assets[0], id: 88 }),
    f => f.release.assets.push({ id: 88, name: "untracked.tgz", size: 100 }),
    f => f.release.draft = true,
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(qualifyPromotion({ ...f, asset: f.asset.bind(f) }));
  }
});

test("a concurrent mutation refuses promotion or restores preview status after the write", async () => {
  for (const when of ["before", "during"]) {
    const f = fixture();
    const verified = await qualifyPromotion({ ...f, asset: f.asset.bind(f) });
    let state = structuredClone(f.release); const patches = [];
    if (when === "before") state.assets.push({ id: 88, name: "extra.tgz", size: 1 });
    await assert.rejects(promoteVerified({ release: f.release, verified,
      getRelease: async () => structuredClone(state),
      patchRelease: async (_id, patch) => { patches.push(patch); Object.assign(state, patch);
        if (patch.prerelease === false) state.assets.push({ id: 88, name: "extra.tgz", size: 1 });
        return structuredClone(state); },
    }));
    assert.equal(state.prerelease, true);
    assert.deepEqual(patches, when === "before" ? [] : [{ prerelease: false }, { prerelease: true }]);
  }
});

test("lost mutation responses and failed post-write reads attempt preview recovery", async () => {
  for (const failure of ["patch-response", "confirmation-read"]) {
    const f = fixture(); const verified = await qualifyPromotion({ ...f, asset: f.asset.bind(f) });
    let state = structuredClone(f.release); let reads = 0; const patches = [];
    await assert.rejects(promoteVerified({ release: f.release, verified,
      getRelease: async () => { if (++reads === 2 && failure === "confirmation-read") throw Error("offline"); return structuredClone(state); },
      patchRelease: async (_id, patch) => { patches.push(patch); Object.assign(state, patch);
        if (!patch.prerelease && failure === "patch-response") throw Error("response lost"); return structuredClone(state); },
    }), /preview status restored/);
    assert.equal(state.prerelease, true);
    assert.deepEqual(patches, [{ prerelease: false }, { prerelease: true }]);
  }
});
