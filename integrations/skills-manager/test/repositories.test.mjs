// Verify repository sources, installation, and failure boundaries with deterministic network responses and isolated directories.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { promises as fileSystem } from "node:fs";

const sandbox = await mkdtemp(join(tmpdir(), "dssm-repository-test-"));
process.env.DSH_HOME = join(sandbox, "home");
process.env.USERPROFILE = join(sandbox, "user");
const { parseRepositoryInput, decodeRepositoryArchive, createRepositoryManager } = await import("../lib/repositories.js");
let sha = "a".repeat(40);
const doc = (name, description = "Test skill") => strToU8(`---\nname: ${name}\ndescription: ${description}\n---\nSkill body\n`);
let archive = zipSync({ "repo-main/skills/pdf/SKILL.md": doc("pdf", "Use when: reviewing files"), "repo-main/skills/pdf/references/help.txt": strToU8("Reference material"), "repo-main/skills/docx/SKILL.md": doc("docx") });
let broken = false;
const requested = [];
const fetchImpl = async (url, options) => {
  requested.push(url);
  assert.equal(options.redirect, "error", "Network redirects are not followed");
  if (broken === "timeout") throw new DOMException("Request timed out", "TimeoutError");
  if (broken) return new Response("", { status: 403 });
  if (url.startsWith("https://codeload.github.com/")) return new Response(archive);
  if (url.includes("/commits/")) return Response.json({ sha });
  return Response.json({ default_branch: "main", private: false });
};
try {
  assert.deepEqual(parseRepositoryInput({ url: "https://github.com/Example/Skills/tree/main/skills" }), { owner: "example", name: "skills", ref: "main", subdirectory: "skills" });
  assert.equal(parseRepositoryInput({ url: "https://github.com/Example/Skills/tree/main/skills", ref: "", subdirectory: "" }).subdirectory, "skills", "Leaving the form field empty preserves the subdirectory from the URL");
  assert.equal(parseRepositoryInput({ url: "example/skills", ref: "feature/ui" }).ref, "feature/ui");
  for (const url of ["http://github.com/a/b", "https://github.com.evil/a/b", "https://user:pass@github.com/a/b", "https://github.com/a/b?token=secret", "https://github.com/a/b/tree/main/%2e%2e"]) {
    assert.throws(() => parseRepositoryInput({ url }), /repository|path/i);
  }
  for (const subdirectory of ["../skills", "C:/skills", "skills/CON", "skills/a.", "skills\\pdf"]) assert.throws(() => parseRepositoryInput({ url: "a/b", subdirectory }));
  assert.throws(() => decodeRepositoryArchive(zipSync({ "root/../escape/SKILL.md": doc("escape") })), /path/i);
  assert.throws(() => decodeRepositoryArchive(zipSync({ "root/A.txt": strToU8("a"), "root/a.txt": strToU8("b") })), /duplicate paths/i);
  assert.throws(() => decodeRepositoryArchive(new Uint8Array((32 << 20) + 1)), error => error.code === "error.repo.tooLarge", "Oversized repositories use a dedicated bilingual error code");
  const manager = createRepositoryManager({ fetchImpl });
  const added = await manager.add({ url: "example/skills", subdirectory: "skills" });
  await assert.rejects(manager.add({ url: "https://github.com/example/skills", subdirectory: "skills" }), /already been added/);
  assert.equal((await manager.list()).repositories.length, 1);
  await manager.refresh({ id: added.id });
  let list = await manager.list();
  assert.equal(list.repositories[0].skills.length, 2);
  assert.match(list.repositories[0].commit, /^[a-f0-9]{64}$/, "The archive is locked by content digest without querying the commits API");
  assert.equal(list.repositories[0].skills.find((s) => s.name === "pdf").status, "available");
  assert.equal((await manager.detail({ id: added.id, path: "skills/pdf" })).body, "Skill body");
  const originalArchive = archive;
  archive = zipSync({ "repo-main/skills/pdf/SKILL.md": doc("impostor") });
  const requestsBeforeInstall = requested.length;
  const installed = await manager.install({ id: added.id, path: "skills/pdf" });
  assert.equal(requested.length, requestsBeforeInstall, "Installation reuses the verified cache instead of redownloading a moving branch");
  const enabledPolicy = JSON.parse(await readFile(join(process.env.DSH_HOME, "skills-manager/state.json"), "utf8"));
  assert.ok(enabledPolicy.enabledSkills.dsh.includes("pdf"), "Repository installation writes an explicit enabled policy instead of only showing the skill as enabled in the UI");
  const { listProviderCandidates } = await import("../lib/core.js");
  const installedCandidate = (await listProviderCandidates()).find((candidate) => candidate.name === "pdf");
  assert.equal(installedCandidate?.invocation.userInvocable, true, "The installed skill appears in the slash-menu overrides");
  assert.equal(installedCandidate?.invocation.modelInvocable, true, "The installed skill is also available for model invocation");
  archive = originalArchive;
  const restartManager = createRepositoryManager({ fetchImpl: async () => { throw new Error("Unexpected network request"); } });
  const cacheFile = join(process.env.DSH_HOME, "skills-manager/repository-cache", `${added.id}-${list.repositories[0].commit}.zip`);
  await writeFile(cacheFile, "corrupted cache", "utf8");
  await assert.rejects(restartManager.install({ id: added.id, path: "skills/docx" }), /cache/i, "Cache digest is still checked when read after restart");
  await writeFile(cacheFile, originalArchive);
  const originalRename = fileSystem.rename;
  fileSystem.rename = async (from, to) => {
    if (to.endsWith("repositories.json")) {
      const pending = JSON.parse(await readFile(from, "utf8"));
      if (pending.installs.some(record => record.name === "docx" && record.complete)) throw new Error("Simulated failure while confirming the installation write");
    }
    return originalRename(from, to);
  };
  try { await assert.rejects(manager.install({ id: added.id, path: "skills/docx" }), /installation|state/i); }
  finally { fileSystem.rename = originalRename; }
  const statePath = join(process.env.DSH_HOME, "skills-manager/repositories.json");
  const extraRepo = await restartManager.add({ url: "example/other" });
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).installs.find(record => record.name === "docx").complete, false, "Adding a subscription does not trigger unrelated skill-directory recovery");
  await restartManager.remove({ id: extraRepo.id });
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).installs.find(record => record.name === "docx").complete, false, "Removing a subscription does not trigger unrelated recovery");
  assert.equal((await restartManager.preview({ id: added.id, path: "skills/docx" })).localModified, false, "Calling preview directly can recover the installation record without opening the list first");
  assert.equal((await restartManager.list()).repositories[0].skills.find(skill => skill.name === "docx").status, "installed", "After restart, recover the unconfirmed installation only after validating all files");
  const recoveredStateFile = join(process.env.DSH_HOME, "skills-manager/repositories.json");
  const recoveredState = JSON.parse(await readFile(recoveredStateFile, "utf8"));
  assert.equal(recoveredState.installs.find(record => record.name === "docx").complete, true, "The recovery result must be persisted");
  assert.equal((await restartManager.preview({ id: added.id, path: "skills/docx" })).localModified, false, "After recovery, the normal update preview is available");
  recoveredState.installs.find(record => record.name === "docx").complete = false;
  await writeFile(recoveredStateFile, JSON.stringify(recoveredState), "utf8");
  await writeFile(join(process.env.DSH_HOME, "skills/docx/SKILL.md"), "User edit", "utf8");
  assert.equal((await restartManager.list()).repositories[0].skills.find(skill => skill.name === "docx").status, "conflict", "Do not claim an unconfirmed installation that has been modified");
  await writeFile(join(process.env.DSH_HOME, "skills/docx/SKILL.md"), doc("docx"));
  await restartManager.list();
  await assert.rejects(restartManager.install({ id: added.id, path: "skills/docx" }), /already exists/i, "A recovered installation cannot be overwritten again");
  assert.equal(installed.name, "pdf");
  assert.equal(await readFile(join(process.env.DSH_HOME, "skills/pdf/references/help.txt"), "utf8"), "Reference material");
  assert.equal((await manager.list()).repositories[0].skills.find((s) => s.name === "pdf").status, "installed");
  await assert.rejects(manager.install({ id: added.id, path: "skills/pdf" }), /already exists|installation/i);
  sha = "b".repeat(40);
  archive = zipSync({ "repo-main/skills/pdf/SKILL.md": doc("pdf", "Use when: reviewing files"), "repo-main/skills/pdf/references/help.txt": strToU8("Updated reference material"), "repo-main/skills/docx/SKILL.md": doc("docx") });
  await manager.refresh({ id: added.id });
  assert.equal((await manager.list()).repositories[0].skills.find(s => s.name === "pdf").status, "update", "Changes to bundled resources also indicate an available update");
  const preview = await manager.preview({ id: added.id, path: "skills/pdf" });
  assert.deepEqual(preview.changes, [{ path: "references/help.txt", kind: "modified" }]);
  await writeFile(join(process.env.DSH_HOME, "skills/pdf/extra.txt"), "User file", "utf8");
  await assert.rejects(manager.update({ id: added.id, path: "skills/pdf", token: preview.token }), /changed|edits/i);
  const changed = await manager.preview({ id: added.id, path: "skills/pdf" });
  assert.equal(changed.localModified, true, "Additional files also count as local edits");
  await assert.rejects(manager.update({ id: added.id, path: "skills/pdf", token: changed.token }), /Local edits/i);
  await manager.update({ id: added.id, path: "skills/pdf", token: changed.token, overwrite: true });
  assert.equal(await readFile(join(process.env.DSH_HOME, "skills/pdf/references/help.txt"), "utf8"), "Updated reference material");
  const rollback = await manager.preview({ id: added.id, path: "skills/pdf", rollback: true });
  const { createRepositoryUpdater } = await import("../lib/repository-updates.js");
  const failingWriter = createRepositoryUpdater({
    read: async () => JSON.parse(await readFile(join(process.env.DSH_HOME, "skills-manager/repositories.json"), "utf8")),
    write: async () => { throw new Error("Simulated state write failure"); },
    serialize: task => task(), parseRepositoryInput,
  });
  await assert.rejects(failingWriter.rollback({ id: added.id, path: "skills/pdf", token: rollback.token }), /Simulated state write failure/);
  assert.equal(await readFile(join(process.env.DSH_HOME, "skills/pdf/references/help.txt"), "utf8"), "Updated reference material", "Automatically restore the pre-replacement content when writing state fails");
  await manager.rollback({ id: added.id, path: "skills/pdf", token: rollback.token });
  assert.equal(await readFile(join(process.env.DSH_HOME, "skills/pdf/extra.txt"), "utf8"), "User file", "Rollback fully restores original local files");
  assert.equal(await readFile(join(process.env.DSH_HOME, "skills/pdf/references/help.txt"), "utf8"), "Reference material");
  await rm(join(process.env.DSH_HOME, "skills/pdf/extra.txt"));
  const clean = await manager.preview({ id: added.id, path: "skills/pdf" });
  broken = true;
  const requestsBeforeUpdate = requested.length;
  await manager.update({ id: added.id, path: "skills/pdf", token: clean.token });
  assert.equal(requested.length, requestsBeforeUpdate, "Offline updates reuse the scan cache");
  broken = false;
  sha = "c".repeat(40);
  await manager.refresh({ id: added.id });
  assert.equal((await manager.list()).repositories[0].skills.find(s => s.name === "pdf").status, "installed", "A commit-only change does not indicate an available update");
  await writeFile(join(process.env.DSH_HOME, "skills/pdf/SKILL.md"), "User local edit", "utf8");
  assert.equal((await manager.list()).repositories[0].skills.find((s) => s.name === "pdf").status, "conflict", "Locally modified files are not misidentified as unchanged installed copies");
  await assert.rejects(manager.install({ id: added.id, path: "skills/pdf" }), /already exists|installation/i);
  assert.equal(await readFile(join(process.env.DSH_HOME, "skills/pdf/SKILL.md"), "utf8"), "User local edit");
  broken = true;
  await manager.refresh({ id: added.id });
  list = await manager.list();
  assert.equal(list.repositories[0].skills.length, 2, "The previous catalog is retained when refresh fails");
  assert.equal(list.repositories[0].error.code, "error.repo.network");
  broken = "timeout";
  assert.equal((await manager.refresh({ id: added.id })).error.code, "error.repo.network", "A numeric error code does not cause a secondary exception");
  broken = false;
  await assert.rejects(manager.install({ id: added.id, path: "../escape" }), /Skill not found/i);
  await manager.remove({ id: added.id });
  assert.equal((await manager.sources()).pdf.owner, "example", "Removing a subscription preserves the installation source");
  assert.equal((await manager.list()).repositories.length, 0);
  assert.equal(await readFile(join(process.env.DSH_HOME, "skills/pdf/SKILL.md"), "utf8"), "User local edit", "Removing a repository does not delete installed skills");
  const concurrent = await Promise.allSettled([manager.add({ url: "a/concurrent" }), manager.add({ url: "a/concurrent" })]);
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1, "Concurrent additions do not lose state or create duplicate sources");
  assert.ok(requested.every(url => url.startsWith("https://codeload.github.com/")), "Does not consume GitHub REST API quota");
  const branchRequests = [];
  const branchManager = createRepositoryManager({ fetchImpl: async url => { branchRequests.push(url); return url.includes("/refs/heads/") ? new Response("", { status: 404 }) : new Response(archive); } });
  const tagged = await branchManager.add({ url: "example/tagged", ref: "v1" });
  assert.equal((await branchManager.refresh({ id: tagged.id })).error, null);
  assert.equal(branchRequests.length, 2);
  assert.ok(branchRequests[1].endsWith("/refs/tags/v1"), "The matching tag is tried only after the branch returns 404");
  const deniedRequests = [];
  const denied = createRepositoryManager({ fetchImpl: async url => { deniedRequests.push(url); return new Response("", { status: 403 }); } });
  await denied.refresh({ id: tagged.id });
  assert.equal(deniedRequests.length, 1, "A 403 does not trigger blind retries against other branches");
  await mkdir(join(process.env.DSH_HOME, "skills-manager"), { recursive: true });
  await writeFile(join(process.env.DSH_HOME, "skills-manager/repositories.json"), JSON.stringify({ version: 1, repositories: [], installs: [null] }), "utf8");
  await assert.rejects(manager.add({ url: "a/b" }), /state/i, "Corrupted repository records with invalid structure are also protected from overwrite");
  await writeFile(join(process.env.DSH_HOME, "skills-manager/repositories.json"), "invalid data", "utf8");
  await assert.rejects(manager.add({ url: "a/b" }), /state/i);
  assert.equal(await readFile(join(process.env.DSH_HOME, "skills-manager/repositories.json"), "utf8"), "invalid data", "Corrupted state must not be overwritten");
  console.log("Repository source, archive validation, installation, conflict, persistence, and failure-protection checks passed");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
