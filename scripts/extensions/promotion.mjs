import { createHash, verify } from "node:crypto";
import { verifyCatalog } from "../../integrations/extension-store/src/contracts.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** Read-only qualification. Stability metadata changes separately; no artifact is rebuilt or uploaded. */
export async function qualifyPromotion({ release, run, jobs, publicKey, asset }) {
  if (!Number.isSafeInteger(release.id) || release.id < 1 || release.draft || !release.prerelease ||
      !/^extensions-preview-[1-9][0-9]*$/.test(release.tag_name))
    throw Error("Published private preview release required");
  const assets = new Map();
  for (const item of release.assets ?? []) {
    if (assets.has(item.name) || !Number.isSafeInteger(item.id) || item.id < 1 ||
        !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 256 * 1024 * 1024)
      throw Error("Invalid or duplicate published asset");
    assets.set(item.name, item);
  }
  async function read(name, limit = 4 * 1024 * 1024) {
    const item = assets.get(name);
    if (!item || item.size > limit) throw Error(`Missing or oversized release asset: ${name}`);
    const bytes = await asset(item.id, { maxBytes: item.size });
    if (bytes.length !== item.size) throw Error("Published asset size changed");
    return bytes;
  }
  const bytes = await read("catalog.json");
  const catalog = verifyCatalog(bytes, (await read("catalog.sig", 1024)).toString().trim(), publicKey);
  const manifestBytes = await read("release-manifest.json");
  if (!verify(null, manifestBytes, publicKey, Buffer.from((await read("release-manifest.sig", 1024)).toString().trim(), "base64")))
    throw Error("Published package inventory signature is invalid");
  const manifest = JSON.parse(manifestBytes.toString());
  if (manifest.schemaVersion !== 1 || manifest.channel !== "preview" || catalog.channel !== "preview" ||
      manifest.revision !== catalog.revision || release.tag_name !== `extensions-preview-${catalog.revision}` ||
      !/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.catalogSha256 !== hash(bytes) ||
      !Array.isArray(manifest.assets) || !manifest.assets.length)
    throw Error("Preview manifest and signed catalog disagree");
  if (!Number.isSafeInteger(manifest.publicationRunId) || manifest.publicationRunId < 1 ||
      !Number.isSafeInteger(manifest.publicationRunAttempt) || manifest.publicationRunAttempt < 1 ||
      run.id !== manifest.publicationRunId || run.run_attempt !== manifest.publicationRunAttempt || run.head_sha !== manifest.commit || run.status !== "completed" || run.conclusion !== "success" ||
      run.path !== ".github/workflows/extensions-preview.yml")
    throw Error("Successful original preview publication run required");
  for (const name of ["qualification / native (ubuntu-latest)", "qualification / native (windows-latest)", "qualification / verdict", "publish"]) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1 || matches[0].run_attempt !== manifest.publicationRunAttempt || matches[0].status !== "completed" || matches[0].conclusion !== "success")
      throw Error(`Required publication evidence missing: ${name}`);
  }
  const names = new Set();
  for (const item of manifest.assets) {
    if (!/^[A-Za-z0-9._-]+\.tgz$/.test(item.name) || names.has(item.name) ||
        !/^[a-f0-9]{64}$/.test(item.sha256) || !item.license || item.license === "UNRESOLVED" ||
        !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes !== assets.get(item.name)?.size)
      throw Error("Invalid preview package inventory");
    names.add(item.name);
    if (hash(await read(item.name, 256 * 1024 * 1024)) !== item.sha256)
      throw Error("Published package hash changed");
  }
  for (const item of catalog.entries) {
    if (item.status === "qualified" && (!item.qualification?.linux || !item.qualification?.win32))
      throw Error("Stable optional releases require separate Linux and Windows qualification");
    if (item.status === "qualified") {
      const published = release.assets.find(a => a.id === item.artifact.assetId);
      const owned = manifest.assets.find(a => a.name === published?.name);
      if (!owned || owned.bytes !== item.artifact.bytes || owned.sha256 !== item.artifact.sha256)
        throw Error("Qualified catalog artifact is absent from its signed release inventory");
    }
  }
  if ([...assets.keys()].some(name => name.endsWith(".tgz") && !names.has(name)))
    throw Error("Published archive is absent from the signed package inventory");
  return { releaseId: release.id, patch: { prerelease: false }, catalogSha256: manifest.catalogSha256,
    assets: release.assets.map(item => ({ id: item.id, name: item.name, size: item.size })) };
}

const identity = release => JSON.stringify({ tag: release.tag_name, draft: release.draft,
  assets: release.assets.map(a => ({ id: a.id, name: a.name, size: a.size })).sort((a,b) => a.id-b.id) });
/** Recheck immediately before mutation; restore preview status when a concurrent change is detected. */
export async function promoteVerified({ release, verified, getRelease, patchRelease }) {
  const expected = identity(release);
  const current = await getRelease(verified.releaseId);
  if (!current.prerelease || identity(current) !== expected)
    throw Error("Release changed during verification; promotion refused");
  try {
    const promoted = await patchRelease(verified.releaseId, verified.patch);
    const final = await getRelease(verified.releaseId);
    if (promoted.prerelease || final.prerelease || identity(promoted) !== expected || identity(final) !== expected)
      throw Error("Release changed concurrently");
    return final;
  } catch {
    try {
      await patchRelease(verified.releaseId, { prerelease: true });
      if (!(await getRelease(verified.releaseId)).prerelease) throw Error("Restore not confirmed");
    } catch {
      throw Error("Promotion outcome unverified; restoring preview status could not be confirmed; manual recovery required");
    }
    throw Error("Promotion verification failed; preview status restored");
  }
}
