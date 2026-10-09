import test from "node:test";
import assert from "node:assert/strict";
import { configureConnection } from "../src/connections.js";
test("explicit tokens use owned native credential reference and active work blocks changes", async () => {
  const writes = [];
  const options = {
    credentials: {
      set: async (...args) => writes.push(args),
      unset: async (ref) => writes.push([ref]),
    },
    installed: [
      {
        id: "test",
        descriptor: {
          id: "test",
          kind: "mcp",
          status: "qualified",
          credentialReference: "BC_EXT_TEST_TOKEN",
        },
      },
    ],
    runtime: { hasWork: () => false },
  };
  await configureConnection(options, {
    action: "connect-extension",
    id: "test",
    token: "fixture-only",
  });
  assert.equal(writes.length, 1);
  await configureConnection(options, {
    action: "disconnect-extension",
    id: "test",
  });
  assert.equal(writes.length, 2);
  await assert.rejects(
    configureConnection(
      { ...options, runtime: { hasWork: () => true } },
      { action: "disconnect-extension", id: "test" },
    ),
    /Stop connector/,
  );
  options.installed[0].descriptor.credentialReference = "OPENAI_API_KEY";
  await assert.rejects(
    configureConnection(options, {
      action: "connect-extension",
      id: "test",
      token: "fixture-only",
    }),
    /owned credential/,
  );
  assert.equal(writes.length, 2);
});
