// Language follows the HTML lang. Switching languages during an update changes copy without sending another update request.
import assert from "node:assert/strict";
import { createUpdateFlow, pluginUpdateCopy } from "../src/plugin-update-model.ts";

const payload = { packageName: "test-plugin", currentVersion: "1.0.0", latestVersion: "1.0.1", updateAvailable: true, profileName: "web", canAutoUpdate: true, latestCheckFailed: false };
let resolveUpdate;
let posts = 0;
const flow = createUpdateFlow(async (method) => {
  if (method === "POST") {
    posts += 1;
    await new Promise((resolve) => { resolveUpdate = resolve; });
  }
  return payload;
});

assert.equal(pluginUpdateCopy("zh-CN").check, "Check for updates", "Page text must not override the host's explicit language selection");
assert.equal(pluginUpdateCopy("en-US").check, "Check for updates");

await flow.check();
assert.match(flow.view("zh-CN").message, /New version available/);
assert.match(flow.view("en-US").message, /New version available/);
assert.equal(flow.view("zh-CN").disabled, false);

const pending = flow.update();
assert.equal(flow.view("zh-CN").updateLabel, "Updating…");
assert.equal(flow.view("zh-CN").message, "Updating…");
assert.equal(flow.view("zh-CN").loading, true);
assert.equal(flow.view("en-US").updateLabel, "Updating…");
assert.equal(flow.view("en-US").message, "Updating…");
assert.equal(flow.posts, 1, "Changing the language does not submit the update again");
assert.equal(posts, 1);
void flow.update();
assert.equal(flow.posts, 1);
assert.equal(posts, 1);
resolveUpdate();
await pending;
assert.equal(flow.view("zh-CN").message, "Update complete. Restart DSH Web.");
assert.equal(flow.view("en").message, "Update complete. Restart DSH Web.");
assert.equal(flow.view("en").updateLabel, "Update automatically");
assert.equal(flow.view("zh-CN").loading, false);
console.log("Plugin update locale regression passed");
