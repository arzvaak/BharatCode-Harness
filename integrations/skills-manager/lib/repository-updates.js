import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { managerHomePath, userRoots } from "./core.js";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileIndex = (entries) => Object.entries(entries).map(([path, bytes]) => ({ path, hash: hash(bytes) })).sort((a, b) => a.path.localeCompare(b.path, "en"));
const signature = (files) => hash(JSON.stringify([...files].map(({ path, hash: hash2 }) => ({ path, hash: hash2 })).sort((a, b) => a.path.localeCompare(b.path, "en"))));
function failure(message, code = "error.repo.invalid") {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}
function safePath(path) {
  if (typeof path !== "string" || !path || path.length > 512 || path.split("/").length > 64 || path.split("/").some((p) => !p || p === "." || p === ".." || /[\\:<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw failure("Invalid skill file path");
}
async function safeDirectory(root) {
  for (let p = root; ; p = dirname(p)) {
    const info = await fs.lstat(p);
    if (info.isSymbolicLink() || !info.isDirectory()) throw failure("Skill or backup directory contains a symbolic link");
    if (dirname(p) === p) break;
  }
}
async function readSkillTree(root) {
  await safeDirectory(root);
  const result = /* @__PURE__ */ Object.create(null);
  let size = 0, count = 0;
  async function walk(dir, prefix = "") {
    for (const entry of await fs.readdir(dir)) {
      const path = prefix + entry;
      safePath(path);
      if (++count > 2e3) throw failure("Skill directory entry limit exceeded");
      const target = join(dir, entry), info = await fs.lstat(target);
      if (info.isSymbolicLink()) throw failure("Skill contains a symbolic link; update refused");
      if (info.isDirectory()) await walk(target, path + "/");
      else {
        if (!info.isFile() || info.size > 32 << 20 || (size += info.size) > 64 << 20 || Object.keys(result).length >= 1e3) throw failure("Skill file count or size limit exceeded");
        result[path] = await fs.readFile(target);
      }
    }
  }
  await walk(root);
  return result;
}
function changesBetween(before, after) {
  const a = new Map(before.map((f) => [f.path, f.hash])), b = new Map(after.map((f) => [f.path, f.hash]));
  return [.../* @__PURE__ */ new Set([...a.keys(), ...b.keys()])].sort().filter((p) => a.get(p) !== b.get(p)).map((path) => ({ path, kind: !a.has(path) ? "added" : !b.has(path) ? "removed" : "modified" }));
}
function createRepositoryUpdater({ read, write, repository, download, serialize, parseRepositoryInput }) {
  async function prepare(input, includeArchive = false) {
    const { id, path } = input, data = await read();
    const record = data.installs.find((i) => i.id === id && i.path === path && i.complete);
    if (!record) throw failure("No traceable installation record is available for an online update");
    const target = join(userRoots().find((r) => r.key === "dsh").path, record.name);
    const current = fileIndex(await readSkillTree(target));
    let entries, next, commit;
    if (input.rollback === true) {
      const backup = record.backup;
      if (!/^[a-f0-9-]{36}$/.test(backup?.key || "") || backup.record?.name !== record.name || backup.record?.id !== id || backup.record?.path !== path || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(backup.record?.commit || "") || !Array.isArray(backup.record?.files)) throw failure("No valid previous-version backup is available");
      entries = await readSkillTree(join(managerHomePath(), "repository-backups", backup.key));
      next = fileIndex(entries);
      if (signature(next) !== backup.fingerprint) throw failure("Backup contents have changed; rollback refused");
      commit = backup.record.commit;
    } else {
      const repo = repository(data, id), skill = repo.skills.find((s) => s.path === path);
      if (repo.error || !skill?.valid || skill.name !== record.name || !skill.files) throw failure("Check for updates successfully first; a renamed or removed skill cannot be replaced directly");
      next = skill.files;
      commit = repo.commit;
      if (includeArchive) {
        const archive = await download(repo), prefix = path ? path + "/" : "";
        entries = Object.fromEntries(Object.entries(archive).filter(([p]) => p.startsWith(prefix)).map(([p, bytes]) => [p.slice(prefix.length), bytes]));
        if (signature(fileIndex(entries)) !== signature(next)) throw failure("Downloaded content differs from the preview; check for updates again");
      }
    }
    const token = hash(JSON.stringify({ id, path, commit, current, next, rollback: input.rollback === true }));
    return { data, record, target, entries, next, current, token, commit, localModified: signature(current) !== signature(record.files), changes: changesBetween(current, next) };
  }
  async function replace(input, rollback = false) {
    const plan = await prepare({ ...input, rollback }, true);
    if (typeof input.token !== "string" || input.token !== plan.token) throw failure("Files or version have changed; preview again");
    if (plan.localModified && input.overwrite !== true) throw failure("Local edits detected; confirm the backup before replacing", "error.repo.modified");
    const { data, record, target, entries } = plan;
    const backupRoot = join(managerHomePath(), "repository-backups");
    await fs.mkdir(backupRoot, { recursive: true });
    await safeDirectory(backupRoot);
    const key = randomUUID(), backup = join(backupRoot, key), stage = join(backupRoot, randomUUID());
    await fs.mkdir(stage);
    let moved = false, replaced = false, recoveryFailed = false;
    try {
      for (const [path, bytes] of Object.entries(entries)) {
        safePath(path);
        const file = join(stage, ...path.split("/"));
        await fs.mkdir(dirname(file), { recursive: true });
        await fs.writeFile(file, bytes, { flag: "wx" });
      }
      if (signature(fileIndex(await readSkillTree(target))) !== signature(plan.current)) throw failure("Local files have changed; preview again");
      const previous = { ...record };
      delete previous.backup;
      const nextRecord = rollback ? { ...record.backup.record } : { ...previous, commit: plan.commit, files: plan.next };
      nextRecord.backup = { key, fingerprint: signature(plan.current), record: previous };
      await fs.rename(target, backup);
      moved = true;
      await fs.rename(stage, target);
      replaced = true;
      data.installs[data.installs.indexOf(record)] = nextRecord;
      await write(data);
    } catch (caught) {
      const error = caught;
      if (moved) {
        try {
          if (replaced) await fs.rename(target, stage);
          await fs.rename(backup, target);
        } catch {
          recoveryFailed = true;
          throw failure("Automatic recovery failed; original files remain in the backup directory. Do not retry", "error.repo.state");
        }
      }
      throw error;
    } finally {
      if (!recoveryFailed) await fs.rm(stage, { recursive: true, force: true });
    }
    return { name: record.name, commit: plan.commit };
  }
  async function sources() {
    const data = await read(), result = /* @__PURE__ */ Object.create(null);
    for (const record of data.installs.filter((i) => i.complete)) {
      const source = record.source || data.repositories.find((r) => r.id === record.id);
      if (!source) continue;
      const parsed = parseRepositoryInput({ url: `${source.owner}/${source.name}`, ref: source.ref, subdirectory: source.subdirectory });
      result[record.name] = { ...parsed, id: record.id, path: record.path, commit: record.commit };
    }
    return result;
  }
  return {
    sources,
    preview: (input) => serialize(async () => {
      const p = await prepare(input);
      return { token: p.token, commit: p.commit, localModified: p.localModified, changes: p.changes, rollback: input.rollback === true };
    }),
    update: (input) => serialize(() => replace(input)),
    rollback: (input) => serialize(() => replace(input, true))
  };
}
export {
  createRepositoryUpdater,
  fileIndex,
  readSkillTree,
  signature
};
