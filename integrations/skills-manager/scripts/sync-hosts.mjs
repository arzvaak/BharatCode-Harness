// Validation is the default; --write syncs release metadata and the current README from the version manifest. Historical CHANGELOG files are not generated.
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  supportedHosts,
  peerRange,
  developmentHost,
  assertHostPeers,
} from "./hosts.mjs";
const manifestUrl = new URL("../package.json", import.meta.url);
const original = await readFile(manifestUrl, "utf8");
const manifest = JSON.parse(original);
assertHostPeers(manifest.peerDependencies);
assert.equal(new Set(supportedHosts).size, supportedHosts.length);
assert(supportedHosts.includes(developmentHost));
for (const [field, value] of [
  ["peerDependencies", peerRange],
  ["devDependencies", developmentHost],
]) {
  for (const name of Object.keys(manifest[field])) {
    if (name.startsWith("@deepseek-ai/dsh-")) manifest[field][name] = value;
  }
}
const expected = JSON.stringify(manifest, null, 2) + "\n";
const write = process.argv.includes("--write");
if (write) await writeFile(manifestUrl, expected);
else
  assert.deepEqual(
    JSON.parse(original),
    manifest,
    "package.json does not match hosts.mjs; run node scripts/sync-hosts.mjs --write",
  );
for (const [file, pattern, line] of [
  [
    "README.md",
    /^- Plugin `[^`]+` is tested with DeepSeek Harness .*$/m,
    `- Plugin \`${manifest.version}\` is tested with DeepSeek Harness ${supportedHosts.map((v) => "`" + v + "`").join(", ")}.`,
  ],
  [
    "README.zh-CN.md",
    /^- Plugin `[^`]+` is tested with DeepSeek Harness .*$/m,
    `- Plugin \`${manifest.version}\` is tested with DeepSeek Harness ${supportedHosts.map((v) => "`" + v + "`").join(", ")}.`,
  ],
]) {
  const url = new URL("../" + file, import.meta.url);
  const content = await readFile(url, "utf8");
  assert(pattern.test(content), `${file} is missing the host compatibility statement`);
  if (write) await writeFile(url, content.replace(pattern, line));
  else
    assert.equal(content.match(pattern)[0], line, `${file} compatibility statement is out of sync`);
}
