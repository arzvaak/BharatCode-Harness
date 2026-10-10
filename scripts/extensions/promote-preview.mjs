import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { GithubTransport } from "../../integrations/extension-store/src/github.js";
import { qualifyPromotion, promoteVerified } from "./promotion.mjs";

const repository = "arzvaak/Bharatcode-Harness";
const revision = Number(process.env.BC_CATALOG_REVISION);
const runId = Number(process.env.BC_PREVIEW_RUN_ID);
if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(runId) || runId < 1)
  throw Error("Positive preview revision and original publication run ID required");
function api(path, patch) {
  const args = ["api", path];
  if (patch) args.push("--method", "PATCH", "--input", "-");
  const result = spawnSync("gh", args, { encoding: "utf8", input: patch ? JSON.stringify(patch) : undefined });
  if (result.status !== 0) throw Error("Private release API request failed; check repository access");
  return JSON.parse(result.stdout);
}
if (api(`repos/${repository}`).private !== true) throw Error("Promotion repository must remain private");
const release = api(`repos/${repository}/releases/tags/extensions-preview-${revision}`);
const run = api(`repos/${repository}/actions/runs/${runId}`);
const jobs = [];
for (let page = 1; ; page++) {
  const response = api(`repos/${repository}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
  jobs.push(...response.jobs);
  if (response.jobs.length < 100) break;
  if (page >= 10) throw Error("Publication job inventory exceeds the supported bound");
}
const transport = new GithubTransport(() => process.env.GH_TOKEN);
const verified = await qualifyPromotion({ release, run, jobs,
  publicKey: await readFile("integrations/extension-store/catalog-public-key.pem"),
  asset: (id, options) => transport.asset(id, options) });
await promoteVerified({ release, verified,
  getRelease: id => api(`repos/${repository}/releases/${id}`),
  patchRelease: (id, patch) => api(`repos/${repository}/releases/${id}`, patch) });
console.log(`Promoted private release ${release.tag_name}; catalog and package bytes retained.`);
