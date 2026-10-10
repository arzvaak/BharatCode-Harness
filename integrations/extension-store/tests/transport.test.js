import test from "node:test";
import assert from "node:assert/strict";
import { GithubTransport } from "../src/github.js";
test("keeps token on API request only across approved asset redirects", async () => {
  const calls = [];
  const client = new GithubTransport(
    async () => "secret",
    async (url, options) => {
      calls.push([url, options]);
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                "https://release-assets.githubusercontent.com/asset?signature=x",
            },
          })
        : new Response("package");
    },
  );
  assert.equal((await client.asset(7)).toString(), "package");
  assert.equal(calls[0][1].headers.Authorization, "Bearer secret");
  assert.equal(calls[1][1].headers.Authorization, undefined);
});
test("refuses off-domain and credential-bearing redirect destinations", async () => {
  for (const location of [
    "https://evil.test/file",
    "https://api.github.com.evil.test/file",
    "https://token@release-assets.githubusercontent.com/file",
  ]) {
    const client = new GithubTransport(
      async () => "secret",
      async () => new Response(null, { status: 302, headers: { location } }),
    );
    await assert.rejects(client.asset(1), /redirect/i);
  }
});
test("allows public downloads and refuses unauthorized or oversized responses", async () => {
  const publicClient = new GithubTransport(async () => undefined, async (url, options) => {
    assert.ok(url.startsWith('https://api.github.com/repos/arzvaak/BharatCode-Extensions/'));
    assert.equal(options.headers.Authorization, undefined);
    return new Response('public archive');
  });
  assert.equal((await publicClient.asset(1)).toString(), 'public archive');
  await assert.rejects(
    new GithubTransport(
      async () => "x",
      async () => new Response("private details", { status: 401 }),
    ).asset(1),
    /access denied/,
  );
  await assert.rejects(
    new GithubTransport(
      async () => "x",
      async () =>
        new Response("large", { headers: { "content-length": "999999999" } }),
    ).asset(1, { maxBytes: 10 }),
    /large/,
  );
});
