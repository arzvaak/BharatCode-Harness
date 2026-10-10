// Settings controls use Ant Design without host-version-specific custom fallbacks for switches, tags, or tabs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const built = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
const source = await readFile(new URL("../src/client.ts", import.meta.url), "utf8");
assert.equal(built.includes("@deepseek-ai/dsh-client-ui-primitives"), false);
assert.equal(built.includes("dssm-fallback-tabs"), false);
assert.equal(built.includes("dssm-fallback-switch"), false);
assert.equal(built.includes("dssm-host-modal{"), false);
assert.ok(built.includes("data-ds-dark-theme"));
assert.ok(built.includes('require("react")'));
assert.ok(built.includes('require("react-dom")'));
assert.ok(built.includes('require("react-dom/client")'));
assert.ok(source.includes("block: true"));
console.log("Settings page no longer keeps host-control fallbacks");
