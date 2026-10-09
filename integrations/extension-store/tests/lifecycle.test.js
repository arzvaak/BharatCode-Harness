import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeManager } from "../src/runtime.js";
const entry = {
  id: "notebook",
  scope: "session",
  runtime: {},
  status: "qualified",
};
test("isolates workspaces/sessions and starts only on invocation", async () => {
  let started = 0;
  const r = new RuntimeManager(async () => ({
    invoke: async () => ++started,
    dispose: async () => {},
  }));
  r.enable("a", entry);
  await assert.rejects(r.invoke("b", "s", entry, "run", {}), /not enabled/);
  assert.equal(started, 0);
  assert.equal(await r.invoke("a", "s", entry, "run", {}), 1);
  assert.equal(r.snapshot().length, 1);
  await r.dispose();
});
test("shares concurrent startup and protects active work from idle disposal", async () => {
  let starts = 0,
    closed = 0,
    resolve;
  const r = new RuntimeManager(async () => {
    starts++;
    return {
      invoke: async () => await new Promise((x) => (resolve = x)),
      dispose: async () => closed++,
    };
  });
  r.enable("a", entry);
  const call = r.invoke("a", "s", entry, "run", {});
  await new Promise((x) => setImmediate(x));
  await r.sweep(Date.now() + 600000);
  assert.equal(closed, 0);
  await assert.rejects(r.disable("a", "notebook"), /active/);
  resolve("done");
  assert.equal(await call, "done");
  await r.sweep(Date.now() + 600000);
  assert.equal(closed, 1);
  assert.equal(starts, 1);
});
test("stateful kernels and schedule leases survive idle cleanup", async () => {
  let closed = 0;
  const r = new RuntimeManager(async () => ({
    invoke: async () => 1,
    dispose: async () => closed++,
    persistent: true,
  }));
  r.enable("a", entry);
  await r.invoke("a", "s", entry, "run", {});
  await r.sweep(Date.now() + 600000);
  assert.equal(closed, 0);
  await r.disable("a", "notebook");
  assert.equal(closed, 1);
});
test("profile-global plugins cannot claim workspace activation", () => {
  const r = new RuntimeManager(() => {});
  assert.throws(
    () => r.enable("a", { ...entry, scope: "profile" }),
    /profile-global/,
  );
});

test("waits for retiring runtime before another invocation starts", async () => {
  let starts = 0,
    finish;
  const r = new RuntimeManager(async () => ({
    invoke: async () => ++starts,
    dispose: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  }));
  r.enable("a", entry);
  await r.invoke("a", "s", entry, "run", {});
  const sweep = r.sweep(Date.now() + 600000);
  await new Promise((resolve) => setImmediate(resolve));
  const next = r.invoke("a", "s", entry, "run", {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 1);
  assert.equal(r.snapshot().length, 1);
  finish();
  await sweep;
  assert.equal(await next, 2);
});
