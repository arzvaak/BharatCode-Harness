// Verify new sources, project isolation, policy persistence, and real content loading in isolated directories.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "dssm-project-sources-"));
process.env.HOME = join(temp, "home");
process.env.USERPROFILE = join(temp, "home");
for (const key of [
  "DSH_HOME",
  "DSH_AGENTS_HOME",
  "DSH_CODEX_HOME",
  "DSH_CLAUDE_HOME",
  "DSH_GEMINI_HOME",
  "DSH_OPENCODE_HOME",
  "DSH_CURSOR_HOME",
  "DSH_COPILOT_HOME",
  "DSH_WINDSURF_HOME",
  "DSH_WINDSURF_USER_HOME",
  "DSH_TRAE_HOME",
  "DSH_TRAE_CN_HOME",
  "DSH_OPENCLAW_HOME",
  "DSH_CLAWDBOT_HOME",
  "DSH_ROO_HOME",
  "DSH_CODEBUDDY_HOME",
  "DSH_WORKBUDDY_HOME",
  "DSH_QODER_HOME",
  "DSH_QODER_CN_HOME",
  "DSH_LINGMA_HOME",
])
  process.env[key] = join(temp, key);
const core = await import("../lib/core.js");
async function skill(path, name) {
  await mkdir(path, { recursive: true });
  const file = join(path, "SKILL.md");
  await writeFile(file, `---\nname: ${name}\ndescription: project regression skill\n---\n${name} body`, "utf8");
  return file;
}
try {
  const source = await readFile(new URL("../lib/core.js", import.meta.url), "utf8");
  const rankSources = new Function(source.slice(source.indexOf("const EXTERNAL_SOURCE_ORDER"), source.indexOf("const PROJECT_SOURCES")) + "; return rankSources;")();
  assert.throws(() => rankSources([{ key: "newcomer" }], 210), /newcomer/, "a single unknown source must produce an explicit error");
  assert.throws(() => rankSources([{ key: "codex" }, { key: "newcomer" }], 210), /newcomer/, "unknown sources must not silently become highest priority");
  const firstTierUserKeys = [
    "copilot",
    "windsurf",
    "windsurf-user",
    "trae",
    "trae-cn",
    "openclaw",
    "clawdbot",
    "roo",
    "codebuddy",
    "workbuddy",
    "qoder",
    "qoder-cn",
    "lingma",
  ];
  for (const key of firstTierUserKeys)
    assert.ok(core.userRoots().some((root) => root.key === key), `register global ${key} source`);
  const copilot = core.userRoots().find((root) => root.key === "copilot");
  await skill(join(copilot.path, "global"), "global-copilot");
  const oldState = (await core.readManagerState()).state;
  for (const key of ["copilot", "windsurf", "windsurf-user", "trae", "trae-cn", "openclaw", "clawdbot", "roo", "codebuddy", "workbuddy", "qoder", "qoder-cn", "lingma"]) {
    delete oldState.sources[key];
    delete oldState.disabledSkills[key];
    delete oldState.enabledSkills[key];
  }
  await mkdir(join(process.env.DSH_HOME, "skills-manager"), { recursive: true });
  await writeFile(core.managerStatePath(), JSON.stringify(oldState), "utf8");
  const migrated = await core.readManagerState();
  assert.equal(migrated.writable, true, "legacy state is compatible with new sources");
  assert.equal(migrated.state.sources["windsurf-user"], true, "migration fills in the Windsurf main directory");
  assert.equal(migrated.state.sources["trae-cn"], true, "migration fills in Trae CN");
  assert.equal(migrated.state.sources.clawdbot, true, "migration fills in the legacy OpenClaw directory");
  assert.equal(migrated.state.sources.codebuddy, true, "migration fills in CodeBuddy");
  assert.equal(migrated.state.sources.workbuddy, true, "migration fills in WorkBuddy");
  assert.equal(migrated.state.sources.qoder, true, "migration fills in Qoder");
  assert.equal(migrated.state.sources["qoder-cn"], true, "migration fills in Qoder CN CLI");
  assert.equal(migrated.state.sources.lingma, true, "migration fills in Qoder CN IDE");
  for (const field of ["sources", "disabledSkills"]) {
    const broken = structuredClone(migrated.state);
    delete broken[field].agents;
    await writeFile(core.managerStatePath(), JSON.stringify(broken), "utf8");
    assert.equal((await core.readManagerState()).writable, false, `missing legacy ${field} must fail closed`);
    assert.equal(await readFile(core.managerStatePath(), "utf8"), JSON.stringify(broken), "reading must not overwrite corrupted state");
  }
  await writeFile(core.managerStatePath(), JSON.stringify(migrated.state), "utf8");
  const project = join(temp, "project"), other = join(temp, "other");
  // Without Git, use only the current cwd; do not guess other ordinary workspaces by walking upward.
  const plain = join(temp, "plain"), nested = join(plain, "nested");
  await mkdir(nested, { recursive: true });
  for (const directory of [".dsh", ".agents", ".github"]) {
    await skill(join(plain, directory, "skills", "plain-skill"), "plain-skill");
  }
  await skill(join(copilot.path, "plain-skill"), "plain-skill");
  const canonicalPlain = await realpath(plain), canonicalNested = await realpath(nested);
  const plainRoots = await core.projectRoots([plain]);
  assert.deepEqual(plainRoots.map((r) => r.kind), ["project-dsh", "project-agents", "project-copilot"], "non-Git workspaces discover native and external sources");
  assert.ok(plainRoots.every((r) => r.projectRoot === canonicalPlain));
  assert.ok((await core.projectRoots([nested])).every((r) => r.projectRoot === canonicalNested), "a non-Git subdirectory independently uses its own cwd");
  const plainView = await core.state({ projectCwds: [plain] });
  assert.equal(plainView.roots.filter((r) => r.scope === "project").flatMap((r) => r.skills).length, 3, "the manager UI shows all project copies");
  for (const r of plainRoots) await core.setSkillEnabled(r, "plain-skill", false);
  const fallback = (await core.listProviderCandidates({ cwd: plain })).find((c) => c.name === "plain-skill");
  assert.equal(fallback.locator.rootKey, copilot.key, "disabling project copies falls back to the global copy");
  await core.setSkillEnabled(plainRoots[2], "plain-skill", true);
  const restored = (await core.listProviderCandidates({ cwd: plain })).find((c) => c.name === "plain-skill");
  assert.equal(restored.locator.rootKey, plainRoots[2].key);
  assert.equal((await core.getProviderSkill(restored, { cwd: plain })).content, "plain-skill body");
  assert.equal(await core.getProviderSkill(restored, { cwd: nested }), undefined, "a non-Git workspace cannot be read across cwd boundaries");
  await mkdir(join(project, ".git"), { recursive: true });
  await mkdir(join(other, ".git"), { recursive: true });
  const sources = {
    copilot: ".github",
    codex: ".codex",
    claude: ".claude",
    gemini: ".gemini",
    opencode: ".opencode",
    cursor: ".cursor",
    windsurf: ".windsurf",
    trae: ".trae",
    "trae-cn": ".trae-cn",
    openclaw: "",
    roo: ".roo",
    codebuddy: ".codebuddy",
    workbuddy: ".workbuddy",
    qoder: ".qoder",
    lingma: ".lingma",
  };
  for (const [key, directory] of Object.entries(sources)) {
    const file = await skill(join(project, directory, "skills", "group", key), `project-${key}`);
    const before = await readFile(file, "utf8");
    const root = (await core.projectRoots([project])).find((r) => r.kind === `project-${key}`);
    assert.ok(root, `register project ${key}`);
    const candidate = (await core.listProviderCandidates({ cwd: project })).find((c) => c.name === `project-${key}`);
    assert.equal((await core.getProviderSkill(candidate, { cwd: project })).content, `project-${key} body`);
    assert.equal(await core.getProviderSkill(candidate, { cwd: other }), undefined, "content cannot be read across projects");
    await core.setSkillEnabled(root, `group/${key}`, false);
    assert.ok((await core.readManagerState()).state.disabledSkills[root.key].includes(`group/${key}`));
    assert.equal((await core.listProviderCandidates({ cwd: project })).find((c) => c.name === `project-${key}`).invocation.modelInvocable, false);
    assert.equal((await core.deleteSkill(root, `group/${key}`)).code, "error.root.readonly");
    assert.equal(await readFile(file, "utf8"), before, "enable/disable operations do not modify source content");
    await core.setSkillEnabled(root, `group/${key}`, true);
  }
  const bare = join(temp, "bare");
  await mkdir(join(bare, ".git"), { recursive: true });
  assert.deepEqual(
    (await core.projectRoots([bare])).map((root) => root.kind),
    ["project-dsh"],
    "read-only project sources without directories are excluded from projectRoots",
  );
  const dsh = core.userRoots().find((root) => root.key === "dsh");
  await skill(join(dsh.path, "shared"), "shared");
  await skill(join(project, ".github", "skills", "shared"), "shared");
  const dshWinner = (await core.listProviderCandidates({ cwd: project })).find((c) => c.name === "shared");
  assert.equal(dshWinner.source, "project-copilot", "project Agent takes priority over a same-name user DSH skill");
  await skill(join(copilot.path, "same"), "same-name");
  await skill(join(project, ".github", "skills", "same"), "same-name");
  const winner = (await core.listProviderCandidates({ cwd: project })).find((c) => c.name === "same-name");
  assert.equal(winner.source, "project-copilot", "project Agent takes priority over global sources");
  const root = (await core.projectRoots([project])).find((r) => r.kind === "project-copilot");
  const projectSources = (await core.projectRoots([project])).filter((r) => !r.native);
  const userRanks = core.userRoots().map((r) => r.rank);
  assert.equal(new Set(projectSources.map((r) => r.rank)).size, projectSources.length, "project source ranks are unique");
  assert.ok(projectSources.every((r) => r.rank < Math.min(...userRanks)), "all new project sources rank ahead of user sources");
  // Cover same-name competition across all project and user sources, including 10 cross-Agent ties from earlier.
  for (const userRoot of core.userRoots()) {
    const name = `collision-${userRoot.key}`;
    await skill(join(userRoot.path, name), name);
    for (const projectRoot of projectSources) await skill(join(projectRoot.path, name), name);
  }
  const collisionState = await core.state({ projectCwds: [project] });
  const candidates = await core.listProviderCandidates({ cwd: project });
  for (const userRoot of core.userRoots()) {
    const name = `collision-${userRoot.key}`;
    const candidate = candidates.find((c) => c.name === name);
    assert.equal(candidate.locator.rootKey, projectSources[0].key, "provider selects the highest-priority project copy");
    for (const projectRoot of projectSources) {
      const view = collisionState.roots.find((r) => r.key === projectRoot.key).skills.find((s) => s.name === name);
      if (projectRoot.key === candidate.locator.rootKey) assert.equal(view.winner, true);
      else {
        assert.equal(view.shadowedBy.root, candidate.locator.rootKey, "project UI and provider agree on the winner");
        assert.notEqual(view.winner, true, "a shadowed project copy must not be marked as the winner");
      }
    }
    await core.setSkillEnabled(userRoot, name, false);
    const disabled = (await core.listProviderCandidates({ cwd: project })).find((c) => c.name === name);
    assert.equal(disabled.locator.rootKey, projectSources[0].key, "disabling a global copy does not affect the project winner");
    assert.equal(disabled.invocation.modelInvocable, true);
    await core.setSkillEnabled(userRoot, name, true);
  }
  // Disable project copies one by one to fall back through the priority chain to the global copy; invocation is blocked only when all copies are disabled.
  const cascadeName = "collision-codex";
  const globalCodex = core.userRoots().find((r) => r.key === "codex");
  for (let i = 0; i < projectSources.length; i++) {
    const disabledRoot = projectSources[i];
    await core.setSkillEnabled(disabledRoot, cascadeName, false);
    const next = (await core.listProviderCandidates({ cwd: project })).find((c) => c.name === cascadeName);
    assert.equal(next.locator.rootKey, projectSources[i + 1]?.key ?? globalCodex.key);
    assert.equal(next.invocation.modelInvocable, true);
    const view = (await core.state({ projectCwds: [project] })).roots.find((r) => r.key === disabledRoot.key).skills.find((s) => s.name === cascadeName);
    assert.equal(view.enabled, false, "a disabled copy remains disabled");
    assert.equal(view.shadowedBy, undefined, "a disabled copy is not marked as shadowed");
    assert.notEqual(view.winner, true);
    assert.deepEqual(view.fallbackTo, { root: next.locator.rootKey, name: cascadeName, scope: i + 1 < projectSources.length ? "project" : "user" }, "the fallback hint reflects the current project's actual winner");
  }
  await core.setSkillEnabled(globalCodex, cascadeName, false);
  assert.equal((await core.listProviderCandidates({ cwd: project })).find((c) => c.name === cascadeName).invocation.modelInvocable, false);
  for (const r of (await core.state({ projectCwds: [project] })).roots) {
    for (const skill of r.skills.filter((s) => s.name === cascadeName)) assert.equal(skill.fallbackTo, undefined, "no takeover hint appears when all copies are disabled");
  }
  await core.setSkillEnabled(globalCodex, cascadeName, true);
  assert.equal((await core.listProviderCandidates({ cwd: project })).find((c) => c.name === cascadeName).locator.rootKey, globalCodex.key);
  const restrictedPath = join(globalCodex.path, cascadeName, "SKILL.md");
  const originalCopy = await readFile(restrictedPath, "utf8");
  await writeFile(restrictedPath, "---\nname: " + cascadeName + "\ndescription: restricted copy\ndisable-model-invocation: true\nuser-invocable: false\n---\nRestricted body", "utf8");
  const currentPolicy = (await core.readManagerState()).state;
  currentPolicy.enabledSkills[globalCodex.key] = currentPolicy.enabledSkills[globalCodex.key].filter((name) => name !== cascadeName);
  await writeFile(core.managerStatePath(), JSON.stringify(currentPolicy), "utf8");
  const restricted = await core.state({ projectCwds: [project] });
  assert.equal(restricted.roots.find((r) => r.key === projectSources[0].key).skills.find((s) => s.name === cascadeName).fallbackTo, undefined, "do not show a takeover hint when the fallback target is not callable");
  await writeFile(restrictedPath, originalCopy, "utf8");
  await core.setSkillEnabled(projectSources[0], cascadeName, true);
  assert.equal((await core.listProviderCandidates({ cwd: project })).find((c) => c.name === cascadeName).locator.rootKey, projectSources[0].key);
  assert.equal((await core.state({ projectCwds: [project] })).roots.find((r) => r.key === projectSources[0].key).skills.find((s) => s.name === cascadeName).fallbackTo, undefined, "remove the old takeover hint after the project copy is restored");
  await core.setSkillEnabled(root, "same", false);
  assert.equal((await core.listProviderCandidates({ cwd: project })).find((c) => c.name === "same-name").invocation.modelInvocable, true, "the global copy remains active after disabling the project copy");
  assert.equal((await core.listProviderCandidates({ cwd: other })).find((c) => c.name === "same-name").invocation.modelInvocable, true);
  await core.setSkillEnabled(root, "same", true);
  assert.equal((await core.setSourceEnabled(root.key, false, undefined, { projectCwds: [project] })).enabled, false);
  assert.equal((await core.readManagerState()).state.sources[root.key], false);
  assert.equal((await core.listProviderCandidates({ cwd: project })).find((c) => c.name === "project-copilot").invocation.modelInvocable, false, "the project source toggle is persisted in manager state");
  const validState = (await core.readManagerState()).state;
  for (const invalid of ["false", 0, null, {}, []]) {
    const broken = structuredClone(validState);
    broken.sources[root.key] = invalid;
    await writeFile(core.managerStatePath(), JSON.stringify(broken), "utf8");
    assert.equal((await core.readManagerState()).writable, false, "an invalid project source toggle fails closed");
    assert.equal((await core.listProviderCandidates({ cwd: project })).find((c) => c.name === "project-copilot").invocation.modelInvocable, false);
    assert.equal((await core.setSourceEnabled(root.key, true, undefined, { projectCwds: [project] })).code, "error.state.invalid");
  }
  await writeFile(core.managerStatePath(), JSON.stringify(validState), "utf8");
  const afterDisable = await core.state({ projectCwds: [project] });
  assert.equal(afterDisable.roots.find((item) => item.key === root.key).enabled, false);
  assert.equal(afterDisable.summary.total, afterDisable.roots.reduce((count, r) => count + r.skills.length, 0));
  assert.equal(afterDisable.summary.enabled, afterDisable.roots.flatMap((r) => r.skills).filter((skill) => skill.enabled === true).length);
  assert.equal(typeof afterDisable.summary.disabled, "number");
  assert.equal(typeof afterDisable.summary.issues, "number");
  const openclawRoot = afterDisable.roots.find((r) => r.kind === "project-openclaw");
  assert.equal(openclawRoot.path, await realpath(join(project, "skills")), "generic project Skills retain the workspace/skills directory");
  assert.equal(openclawRoot.localeKey, "projectSkills", "root skills use a neutral display name while preserving policy key compatibility");
  console.log("Project sources, Copilot migration, and loading regression checks passed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
