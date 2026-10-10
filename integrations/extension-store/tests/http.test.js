import test from "node:test";
import assert from "node:assert/strict";
import { trustedRequest } from "../src/http.js";
const request = (headers = {}, remoteAddress = "127.0.0.1") => ({
  headers: { host: "127.0.0.1:19387", ...headers },
  socket: { remoteAddress },
});
test("rejects foreign origin, DNS rebinding and bare local control requests", () => {
  assert.equal(trustedRequest(request()), false);
  assert.equal(trustedRequest(request({ origin: "https://evil.test" })), false);
  assert.equal(
    trustedRequest(request({ host: "evil.test", origin: "https://evil.test" })),
    false,
  );
  assert.equal(
    trustedRequest(request({ origin: "http://127.0.0.1:19387" }, "10.0.0.2")),
    false,
  );
  assert.equal(
    trustedRequest(request({ origin: "http://127.0.0.1:19387" })),
    true,
  );
});
test("accepts first-party desktop forwarding marker and refuses cross-site", () => {
  assert.equal(
    trustedRequest(request({ cookie: "dsh-auth-test=host-owned" })),
    true,
  );
  assert.equal(
    trustedRequest(
      request({
        cookie: "dsh-auth-test=host-owned",
        "sec-fetch-site": "cross-site",
      }),
    ),
    false,
  );
});
