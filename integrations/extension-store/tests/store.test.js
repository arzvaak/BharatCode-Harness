import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { ExtensionStore } from "../src/store.js";
import { archive } from "./fixtures.js";
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "bc-store-"));
  const bytes = archive({ name: "test-tool", version: "1.0.0" });
  const e = {
    id: "tool",
    name: "Tool",
    kind: "native",
    version: "1.0.0",
    sourceCommit: "a".repeat(40),
    source: "https://github.com/test/tool",
    license: "MIT",
    scope: "profile",
    platforms: ["linux"],
    bcVersion: "0.2.0-rc.2",
    status: "qualified",
    requirements: [],
    packageName: "test-tool",
    qualification: { linux: ["packed-install", "lifecycle", "workflow"] },
    artifact: {
      assetId: 3,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
  const cat = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      revision: 2,
      channel: "preview",
      entries: [e],
    }),
  );
  const keys = generateKeyPairSync("ed25519");
  const signature = sign(null, cat, keys.privateKey).toString("base64");
  const installs = [];
  const transport = {
    request: async () =>
      Buffer.from(
        JSON.stringify([
          {
            tag_name: "extensions-preview-2",
            assets: [
              { name: "catalog.json", id: 1 },
              { name: "catalog.sig", id: 2 },
            ],
          },
        ]),
      ),
    asset: async (id) =>
      id === 1 ? cat : id === 2 ? Buffer.from(signature) : bytes,
  };
  const manager = {
    installBundle: async (path, options) => {
      installs.push({ path, options });
      return { application: "applied" };
    },
    listBundles: () => [],
    setBundleEnabled: async () => ({ application: "applied" }),
  };
  const store = new ExtensionStore({
    directory: dir,
    transport,
    publicKey: keys.publicKey,
    manager,
    platform: "linux",
    bcVersion: "0.2.0-rc.2",
  });
  return { dir, store, installs, transport, bytes };
}
test("verifies release, caches signed bytes, installs exact package disabled", async () => {
  const { store, installs, bytes } = await fixture();
  await store.refresh();
  await store.install("tool");
  assert.equal(installs.length, 1);
  assert.equal(installs[0].options.enabled, false);
  assert.deepEqual(await readFile(installs[0].path), bytes);
  assert.equal(store.view().installed[0].id, "tool");
});
test("offline reads reverify signatures and tampered archives never reach installer", async () => {
  const { store, transport } = await fixture();
  await store.refresh();
  transport.asset = async () => Buffer.from("tampered");
  await assert.rejects(store.install("tool"), /integrity/);
  assert.equal(store.view().installed.length, 0);
  const offline = new ExtensionStore({
    ...store.options,
    transport: {
      request: async () => {
        throw Error("offline");
      },
    },
  });
  await offline.load();
  assert.equal(offline.view().catalog.revision, 2);
});
test("failed manager operation does not claim installation", async () => {
  const { store } = await fixture();
  await store.refresh();
  store.options.manager.installBundle = async () => ({
    application: "failed",
    error: { message: "failed" },
  });
  await assert.rejects(store.install("tool"), /failed/);
  assert.equal(store.view().installed.length, 0);
});
test("workspace activation persists without starting runtimes", async () => {
  const { store } = await fixture();
  await store.refresh();
  await store.install("tool");
  Object.assign(store.installed[0].descriptor, {
    scope: "session",
    kind: "mcp",
    tools: ["run"],
    runtime: { transport: "stdio", command: "node", args: ["fixture-only"] },
  });
  await store.activation("workspace-a", "tool", true);
  const reopened = new ExtensionStore(store.options);
  await reopened.load();
  assert.deepEqual(reopened.view().workspaceEnabled, [["workspace-a", "tool"]]);
  assert.equal(reopened.view().operations.length, 0);
});
test("declines downgrades and updates of enabled packages", async () => {
  const { store } = await fixture();
  await store.refresh();
  await store.install("tool");
  store.catalog.entries[0].version = "0.9.0";
  await assert.rejects(store.install("tool"), /downgrade/);
  store.catalog.entries[0].version = "1.1.0";
  store.installed[0].enabled = true;
  await assert.rejects(store.install("tool"), /Disable/);
});
test("awaits native persistence acknowledgement before completing activation", async () => {
  const { store } = await fixture();
  await store.refresh();
  await store.install("tool");
  Object.assign(store.installed[0].descriptor, {
    scope: "session",
    kind: "mcp",
    tools: ["run"],
    runtime: { transport: "stdio", command: "node", args: ["fixture-only"] },
  });
  let finish;
  let written = false;
  store.options.persistence = {
    write: async () => {
      await new Promise((r) => (finish = r));
      written = true;
    },
    read: async () => undefined,
  };
  const pending = store.activation("a", "tool", true);
  await new Promise((r) => setImmediate(r));
  assert.equal(written, false);
  finish();
  await pending;
  assert.equal(written, true);
});
