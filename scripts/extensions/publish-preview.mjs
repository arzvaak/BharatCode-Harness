import { verifyCatalog } from "../../integrations/extension-store/src/contracts.js";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import { signCatalog } from "./catalog-release.mjs";
const repository = "arzvaak/Bharatcode-Harness";
const key = process.env.BC_EXTENSION_CATALOG_KEY;
delete process.env.BC_EXTENSION_CATALOG_KEY;
const revision = Number(process.env.BC_CATALOG_REVISION);
const publicationRunId = Number(process.env.GITHUB_RUN_ID);
const publicationRunAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
if (
  !key ||
  !Number.isSafeInteger(revision) ||
  revision < 1 ||
  !process.env.GITHUB_SHA || !Number.isSafeInteger(publicationRunId) || publicationRunId < 1 ||
  !Number.isSafeInteger(publicationRunAttempt) || publicationRunAttempt < 1
)
  throw Error("Signing secret, positive revision and CI commit required");
function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0)
    throw Error(
      "GitHub publication failed; inspect release access and immutable tag",
    );
  return result.stdout;
}
const repo = JSON.parse(gh(["api", `repos/${repository}`]));
if (repo.private !== true)
  throw Error("Preview repository must remain private");
const tag = `extensions-preview-${revision}`;
const existing = spawnSync(
  "gh",
  ["release", "view", tag, "--repo", repository],
  {
    stdio: "ignore",
  },
);
if (existing.status === 0)
  throw Error("Immutable release already exists; allocate another revision");
const directory = resolve("dist/packed-core");
const inventory = JSON.parse(await readFile(join(directory, "inventory.json")));
if (
  inventory.platform !== "linux" ||
  !Array.isArray(inventory.assets) ||
  !inventory.assets.length
)
  throw Error("Qualified Linux inventory required");
const files = [];
const releaseAssets = [];
const names = new Set();
for (const asset of inventory.assets) {
  if (!/^[A-Za-z0-9._-]+\.tgz$/.test(asset.name))
    throw Error("Invalid archive filename");
  if (names.has(asset.name)) throw Error("Duplicate release asset filename");
  names.add(asset.name);
  const path = join(directory, asset.name);
  const bytes = await readFile(path);
  if (
    bytes.length !== asset.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw Error("Qualified archive bytes changed");
  if (!asset.license || asset.license === "UNRESOLVED")
    throw Error("Package licence inventory incomplete");
  files.push(path);
  releaseAssets.push(asset);
}
const catalog = JSON.parse(
  await readFile("integrations/extension-store/catalog.json"),
);
const qualifiedRuntimeNames = new Set((catalog.managedDependencies ?? []).flatMap(bundle =>
  bundle.status === "qualified" ? bundle.platforms.map(platform => bundle.artifacts[platform].assetName) : []));
const managedDirectory = resolve("dist/managed-dependencies");
let managedInventory = { assets: [] };
try {
  managedInventory = JSON.parse(await readFile(join(managedDirectory, "inventory.json")));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!Array.isArray(managedInventory.assets)) throw Error("Invalid managed dependency inventory");
for (const asset of managedInventory.assets) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(asset.name) || names.has(asset.name)
    || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 512 * 1024 * 1024
    || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "") || !asset.license || asset.license === "UNRESOLVED"
    || !/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(asset.sourceCommit ?? "")
    || !["linux", "win32", "darwin"].includes(asset.platform)
    || !/^[a-z0-9-]+$/.test(asset.bundleId ?? ""))
    throw Error("Invalid managed dependency asset inventory");
  if (!qualifiedRuntimeNames.has(asset.name)) throw Error("Unreferenced managed dependency asset refused");
  const path = join(managedDirectory, asset.name);
  const bytes = await readFile(path);
  if (bytes.length !== asset.bytes || createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
    throw Error("Managed dependency artifact bytes differ from its inventory");
  files.push(path);
  releaseAssets.push(asset);
  names.add(asset.name);
}
for (const bundle of catalog.managedDependencies ?? []) {
  if (bundle.status !== "qualified") continue;
  for (const platform of bundle.platforms) {
    const artifact = bundle.artifacts[platform];
    const matches = releaseAssets.filter(asset => asset.name === artifact.assetName);
    if (matches.length !== 1 || matches[0].platform !== platform || matches[0].bundleId !== bundle.id
      || matches[0].sourceCommit !== bundle.sourceCommit || matches[0].license !== bundle.license
      || matches[0].bytes !== artifact.bytes || matches[0].sha256 !== artifact.sha256)
      throw Error(`Managed dependency release evidence is missing for ${bundle.id} (${platform})`);
  }
}
catalog.revision = revision;
catalog.channel = "preview";
const signed = signCatalog(
  Buffer.from(JSON.stringify(catalog, null, 2) + "\n"),
  key,
);
verifyCatalog(
  signed.bytes,
  signed.signature,
  await readFile("integrations/extension-store/catalog-public-key.pem"),
);
await mkdir("dist/catalog", { recursive: true });
await writeFile("dist/catalog/catalog.json", signed.bytes);
await writeFile("dist/catalog/catalog.sig", signed.signature + "\n");
await writeFile(
  "dist/catalog/release-manifest.json",
  JSON.stringify(
    {
      schemaVersion: 1,
      revision,
      channel: "preview",
      commit: process.env.GITHUB_SHA,
      publicationRunId,
      publicationRunAttempt,
      catalogSha256: signed.sha256,
      assets: releaseAssets,
    },
    null,
    2,
  ),
);
await writeFile(
  "dist/catalog/release-manifest.sig",
  sign(null, await readFile("dist/catalog/release-manifest.json"), key).toString("base64") + "\n",
);
await writeFile(
  "dist/catalog/SHA256SUMS",
  `${signed.sha256}  catalog.json\n` +
    releaseAssets.map((a) => `${a.sha256}  ${a.name}\n`).join(""),
);
await writeFile(
  "dist/catalog/RELEASE.md",
  "BC private engineering preview. Optional candidates remain unavailable until their release-specific and platform-specific qualification passes. Native OS installer signing and authenticated account evidence are separate requirements.\n",
);
gh([
  "release",
  "create",
  tag,
  ...files,
  ...(await readdir("dist/catalog")).map((f) => resolve("dist/catalog", f)),
  "--repo",
  repository,
  "--target",
  process.env.GITHUB_SHA,
  "--prerelease",
  "--title",
  `BC extension preview ${revision}`,
  "--notes-file",
  "dist/catalog/RELEASE.md",
]);
console.log(`Published private immutable catalog revision ${revision}.`);
