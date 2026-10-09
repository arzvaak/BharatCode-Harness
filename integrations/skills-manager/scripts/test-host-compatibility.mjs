// Install the specified real DSH Web version in isolation and verify the package, Agent scopes, and skill policies.
// --serve keeps the host running for browser review after checks; press Ctrl+C to stop it. Failures and --keep retain the temp directory; results are also saved to .compat-results.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  cp,
  realpath,
  access,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  resolve,
  delimiter,
  relative,
  isAbsolute,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import assert from "node:assert/strict";

import { supportedHosts as supported } from "./hosts.mjs";
import { parseOptions, usage } from "./compatibility-options.mjs";
import { resolveTempRoot, sameExistingPath } from "./compat-paths.mjs";
import { hostCordisOverrides, pinHostDependencies } from "./compat-dependencies.mjs";
let options;
try {
  options = parseOptions(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n${usage}`);
  process.exit(1);
}
if (options.help) {
  console.log(usage);
  process.exit(0);
}
if (options.list) {
  console.log(JSON.stringify(supported));
  process.exit(0);
}
if (options.versions.length > 1) {
  for (const version of options.versions) {
    const code = await new Promise((done, reject) => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(import.meta.url),
          version,
          ...(options.keep ? ["--keep"] : []),
          ...(options.serve ? ["--serve"] : []),
        ],
        { stdio: "inherit", windowsHide: true },
      );
      child.once("error", reject);
      child.once("exit", done);
    });
    if (code !== 0) process.exit(1);
  }
  process.exit(0);
}
const [version] = options.versions;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

async function seedRepositoryInstall(home) {
  const source = { owner: "example", name: "skills", ref: "main", subdirectory: "skills" };
  const id = createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 24);
  const document = "---\nname: repo-slash\ndescription: Use when: the slash menu must list a repository install\n---\nREPO_SLASH_BODY\n";
  const documentBytes = Buffer.from(document);
  const documentHash = createHash("sha256").update(documentBytes).digest("hex");
  const zip = Buffer.from(zipSync({ "repo-main/skills/repo-slash/SKILL.md": documentBytes }));
  const commit = createHash("sha256").update(zip).digest("hex");
  const cache = join(home, "skills-manager", "repository-cache");
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, `${id}-${commit}.zip`), zip);
  await writeFile(join(home, "skills-manager", "repositories.json"), JSON.stringify({
    version: 1,
    repositories: [{
      ...source,
      id,
      skills: [{
        path: "skills/repo-slash",
        files: [{ path: "SKILL.md", hash: documentHash }],
        name: "repo-slash",
        description: "Use when: the slash menu must list a repository install",
        body: "REPO_SLASH_BODY",
        documentHash,
        valid: true,
      }],
      commit,
      refreshedAt: "2026-09-30T00:00:00.000Z",
      error: null,
    }],
    installs: [],
  }));
  return { id, path: "skills/repo-slash" };
}
// Find the executable through the actual shim or symlink on PATH, without relying on the Node installation location.
async function findTool(name) {
  for (const directory of (process.env.PATH || "").split(delimiter)) {
    const shim = join(
      directory,
      name + (process.platform === "win32" ? ".cmd" : ""),
    );
    try {
      const target = await realpath(shim);
      if (process.platform !== "win32") return target;
      const candidates =
        name === "npm"
          ? ["node_modules/npm/bin/npm-cli.js"]
          : [
              "node_modules/pnpm/bin/pnpm.cjs",
              "node_modules/corepack/dist/pnpm.js",
            ];
      for (const candidate of candidates) {
        const entry = resolve(dirname(target), candidate);
        try {
          await access(entry);
          return entry;
        } catch {}
      }
    } catch {}
  }
  throw new Error(
    `No runnable ${name} executable found on PATH; install the pnpm and npm versions specified by the project, then retry.`,
  );
}
const npm = await findTool("npm");
const pnpm = await findTool("pnpm");
const tempRoot = await resolveTempRoot(tmpdir());
const sandbox = await resolveTempRoot(await mkdtemp(join(tempRoot, `dsh-skills-compat-${version}-`)));
const env = {
  ...process.env,
  DSH_HOME: join(sandbox, "home"),
  USERPROFILE: join(sandbox, "user"),
};
for (const key of [
  "AGENTS",
  "CODEX",
  "CLAUDE",
  "GEMINI",
  "OPENCODE",
  "CURSOR",
]) {
  env[`DSH_${key}_HOME`] = join(env.USERPROFILE, key.toLowerCase());
}
await mkdir(join(sandbox, "workspace"), { recursive: true });
const workspace = await resolveTempRoot(join(sandbox, "workspace"));
// Verify an ordinary workspace first, then add a Git marker to confirm both root-detection rules agree.
await mkdir(env.USERPROFILE, { recursive: true });

async function run(args, cwd = sandbox, taskEnv = process.env) {
  return new Promise((resolveRun, reject) => {
    const directTool =
      process.platform !== "win32" && [npm, pnpm].includes(args[0]);
    const child = spawn(
      directTool ? args[0] : process.execPath,
      directTool ? args.slice(1) : args,
      {
        cwd,
        env: taskEnv,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    const timeout = setTimeout(() => {
      void stopProcess(child).catch((error) => console.error(error));
      reject(new Error(`Command exceeded 180 seconds: ${args.join(" ")}\n${output}`));
    }, 180000);
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolveRun(output)
        : reject(new Error(`${args.join(" ")} (${code})\n${output}`));
    });
  });
}

// Stop only process trees started by this script, with bounded waits to avoid hanging indefinitely after a failure.
async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((done, reject) => {
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        killer.kill();
        reject(new Error("Timed out while terminating the process tree"));
      }, 10000);
      killer.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      killer.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for the host to exit")), 10000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
  }
}

const report = { version, plugin: manifest.version, sandbox, checks: [] };
let host;
let hostLog = "";
try {
  console.log(`${version}: isolated install in ${sandbox}`);
  const dependencies = { "@deepseek-ai/dsh": version };
  for (const name of Object.keys(manifest.peerDependencies)) {
    if (name.startsWith("@deepseek-ai/dsh-")) dependencies[name] = version;
  }
  await writeFile(
    join(sandbox, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      packageManager: manifest.packageManager,
      dependencies,
    }),
  );
  // The peer graph of older hosts makes npm 11 resolution slow; use the project's specified pnpm and pin official versions consistently.
  await writeFile(
    join(sandbox, "pnpm-workspace.yaml"),
    `autoInstallPeers: true\nstrictPeerDependencies: false\noverrides:\n${Object.entries(hostCordisOverrides(version)).map(([name, pinned]) => `  '${name}': '${pinned}'`).join("\n")}\n`,
  );
  await writeFile(join(sandbox, ".pnpmfile.cjs"),
    `const pinHostDependencies = ${pinHostDependencies.toString()};\nmodule.exports = { hooks: { readPackage: pkg => pinHostDependencies(pkg, ${JSON.stringify(version)}) } };\n`, "utf8");
  const installLog = await run([
    pnpm,
    "install",
    "--ignore-scripts",
    "--registry=https://registry.npmjs.org/",
  ]);
  await writeFile(join(sandbox, "install.log"), installLog);
  for (const [name, expected] of Object.entries(dependencies)) {
    const installed = JSON.parse(
      await readFile(
        join(sandbox, "node_modules", name, "package.json"),
        "utf8",
      ),
    );
    assert.equal(installed.version, expected, `${name} must not be masked by another version`);
  }
  for (const entry of await readdir(join(sandbox, "node_modules", ".pnpm"))) {
    if (!entry.startsWith("@deepseek-ai+dsh")) continue;
    const scope = join(sandbox, "node_modules", ".pnpm", entry, "node_modules", "@deepseek-ai");
    // On Windows, virtual-store directory names are truncated and hashed, so the package name cannot be inferred from the directory.
    for (const item of await readdir(scope, { withFileTypes: true })) {
      if (!item.isDirectory() || !(item.name === "dsh" || item.name.startsWith("dsh-"))) continue;
      const installed = JSON.parse(await readFile(join(scope, item.name, "package.json"), "utf8"));
      assert.equal(installed.version, version, `${installed.name} transitive dependency must not mix host versions`);
    }
  }
  report.checks.push("Installed the exact host version, all official peers, and transitive dependencies");
  const pack = JSON.parse(
    await run(
      [
        npm,
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        sandbox,
      ],
      root,
    ),
  );
  const cli = join(
    sandbox,
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
  await writeFile(
    join(sandbox, "plugin-install.log"),
    await run(
      [
        cli,
        "plugin",
        "--profile",
        "web",
        "add",
        join(sandbox, pack[0].filename),
        "--registry=https://registry.npmjs.org/",
      ],
      sandbox,
      env,
    ),
  );
  await cp(
    join(root, "test", "fixtures", "compatibility-probe.mjs"),
    join(sandbox, "probe.mjs"),
  );
  await writeFile(
    join(sandbox, "probe.yml"),
    `- insert:\n    - id: skills-compat-probe\n      name: ${JSON.stringify(pathToFileURL(join(sandbox, "probe.mjs")).href)}\n`,
  );
  const external = join(env.DSH_AGENTS_HOME, "skills", "compat-external");
  await mkdir(external, { recursive: true });
  const original =
    "---\nname: compat-external\ndescription: Isolated compatibility test\n---\nCOMPAT_EXTERNAL_BODY\n";
  await writeFile(join(external, "SKILL.md"), original);
  const local = join(env.DSH_HOME, "skills", "compat-local");
  await mkdir(local, { recursive: true });
  await writeFile(
    join(local, "SKILL.md"),
    original.replaceAll("compat-external", "compat-local"),
  );
  // Keep project and global bodies separate for the same skill name to verify that disabling one copy does not disable other sources.
  const projectScoped = join(workspace, ".dsh", "skills", "compat-scoped");
  const globalScoped = join(env.DSH_HOME, "skills", "compat-scoped");
  for (const [path, body] of [[projectScoped, "PROJECT_BODY"], [globalScoped, "GLOBAL_BODY"]]) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "SKILL.md"), `---\nname: compat-scoped\ndescription: Scope fallback test\n---\n${body}\n`);
  }
  const repositoryInstall = await seedRepositoryInstall(env.DSH_HOME);
  host = spawn(
    process.execPath,
    [
      cli,
      "--profile",
      "web",
      "--patch",
      join(sandbox, "probe.yml"),
      "--port",
      "0",
      "--no-open",
    ],
    {
      cwd: workspace,
      env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const url = await new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for the host to start\n${hostLog}`)),
      45000,
    );
    const observe = (data) => {
      hostLog += data;
      const match = hostLog.match(/http:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?/);
      if (match) {
        clearTimeout(timeout);
        resolveUrl(match[0]);
      }
    };
    host.stdout.on("data", observe);
    host.stderr.on("data", observe);
    host.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    host.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Host exited early with code ${code}\n${hostLog}`));
    });
  });
  const base = new URL(url).origin;
  // The first request obtains the host cookie; do not save the temporary access token in evidence.
  const landing = await fetch(url, { redirect: "manual" });
  const cookie = landing.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  async function request(path, body) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        cookie,
        "x-dsh-skills-session": "skills-manager-compat-agent",
        origin: base,
        "content-type": "application/json",
        "x-dsh-skills-manager": "1",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text);
  }
  const state = await request("/api/dsh-skills-manager/state");
  assert(state.ok);
  for (const name of ["compat-external", "compat-local"]) {
    assert(
      state.data.roots.some((item) =>
        item.skills.some((skill) => skill.name === name),
      ),
      `State is missing ${name}`,
    );
  }
  const probe = () => request("/__skills-manager-compat");
  let snapshot = await probe();
  assert(snapshot.list.some((skill) => skill.name === "compat-external"));
  assert(snapshot.list.some((skill) => skill.name === "compat-local"));
  assert(snapshot.local.content.includes("COMPAT_EXTERNAL_BODY"));
  assert(snapshot.skill.content.includes("COMPAT_EXTERNAL_BODY"));
  assert(snapshot.skill.invocation.modelInvocable);
  report.checks.push("Loaded the release package; read the state API, real Agent scope list, and skill body");
  await request("/api/dsh-skills-manager/disable", {
    root: "agents",
    name: "compat-external",
  });
  snapshot = await probe();
  assert(
    snapshot.list.some((skill) => skill.name === "compat-external"),
    "Skill remains discoverable after being disabled",
  );
  assert.equal(snapshot.skill.invocation.modelInvocable, false);
  assert.equal(snapshot.skill.invocation.userInvocable, false);
  await request("/api/dsh-skills-manager/enable", {
    root: "agents",
    name: "compat-external",
  });
  snapshot = await probe();
  assert.equal(snapshot.skill.invocation.modelInvocable, true);
  assert.equal(snapshot.skill.invocation.userInvocable, true);
  assert.equal(await readFile(join(external, "SKILL.md"), "utf8"), original);
  report.checks.push(
    "Model and user invocation policies refresh when disabled for the active Agent; re-enabling restores them and leaves source files unchanged",
  );
  const scopedState = await request("/api/dsh-skills-manager/state");
  const expectedProjectPath = join(workspace, ".dsh", "skills");
  const projectRoots = scopedState.data.roots.filter((item) => item.kind === "project-dsh");
  let projectRoot;
  for (const item of projectRoots) {
    if (await sameExistingPath(item.path, expectedProjectPath)) {
      projectRoot = item;
      break;
    }
  }
  assert(projectRoot, "The real Agent's project source is manageable");
  assert.equal(snapshot.scoped.content, "PROJECT_BODY");
  async function toggleScoped(root, enabled) {
    await request(`/api/dsh-skills-manager/${enabled ? "enable" : "disable"}`, { root, name: "compat-scoped" });
    return probe();
  }
  snapshot = await toggleScoped(projectRoot.key, false);
  assert.equal(snapshot.scoped.content, "GLOBAL_BODY", "Host uses the global body after the project copy is disabled");
  assert.equal(snapshot.scoped.invocation.modelInvocable, true);
  const fallbackState = await request("/api/dsh-skills-manager/state");
  const disabledProject = fallbackState.data.roots.find((r) => r.key === projectRoot.key).skills.find((s) => s.name === "compat-scoped");
  assert.equal(disabledProject.enabled, false);
  assert.equal(disabledProject.shadowedBy, undefined);
  assert.deepEqual(disabledProject.fallbackTo, { root: "dsh", name: "compat-scoped", scope: "user" }, "Fallback notice matches the actual global winner selected by the host");
  snapshot = await toggleScoped("dsh", false);
  assert.equal(snapshot.scoped.invocation.modelInvocable, false, "Invocation is blocked only when all copies are disabled");
  assert.equal(snapshot.scoped.invocation.userInvocable, false);
  snapshot = await toggleScoped(projectRoot.key, true);
  assert.equal(snapshot.scoped.content, "PROJECT_BODY");
  assert.equal(snapshot.scoped.invocation.modelInvocable, true, "Disabling global copy does not prevent the project copy from being re-enabled");
  snapshot = await toggleScoped("dsh", true);
  assert.equal(snapshot.scoped.content, "PROJECT_BODY");
  report.checks.push("Project precedence, global fallback after disabling the project copy, blocking only when all copies are disabled, individual re-enablement, and matching UI state");
  report.checks.push("Real host discovery, reading, enable/disable, and global fallback in a non-Git workspace");
  await mkdir(join(workspace, ".git"));
  const gitState = await request("/api/dsh-skills-manager/state");
  assert.equal(gitState.data.roots.find((r) => r.kind === "project-dsh").key, projectRoot.key);
  assert.equal((await probe()).scoped.content, "PROJECT_BODY");
  await rm(join(workspace, ".git"), { recursive: true });
  report.checks.push("Project identity and body remain consistent after adding a Git marker; removing it restores the non-Git test workspace");
  await request("/api/dsh-skills-manager/repositories/install", repositoryInstall);
  snapshot = await probe();
  const installedSkill = snapshot.list.find((skill) => skill.name === "repo-slash");
  assert(installedSkill, "Repository-installed skill appears in the slash menu without manually toggling it");
  assert.equal(installedSkill.invocation.userInvocable, true);
  assert.equal(installedSkill.invocation.modelInvocable, true);
  assert(snapshot.installed?.content?.includes("REPO_SLASH_BODY"), "Slash menu can read the body of a repository-installed skill");
  const managerState = JSON.parse(await readFile(join(env.DSH_HOME, "skills-manager", "state.json"), "utf8"));
  assert(managerState.enabledSkills.dsh.includes("repo-slash"), "Repository installation writes to enabledSkills");
  report.checks.push("Repository installation writes the enable policy; the real Agent slash menu can discover and read the skill");
  report.passed = true;
  await writeFile(
    join(sandbox, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (options.serve) {
    console.log(`Browser review: ${url}`);
    await new Promise((resolveStop) => {
      process.once("SIGINT", resolveStop);
      process.once("SIGTERM", resolveStop);
    });
  }
} catch (error) {
  report.passed = false;
  report.error = String(error.stack || error);
  await writeFile(
    join(sandbox, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.error(JSON.stringify(report));
  process.exitCode = 1;
} finally {
  try {
    await stopProcess(host);
  } catch (error) {
    report.passed = false;
    report.error = String(error);
    process.exitCode = 1;
  }
  const evidence = join(root, ".compat-results", version);
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    join(evidence, "host.log"),
    hostLog.replace(/\?token=[^\s]+/g, "?token=[redacted]"),
  );
  for (const name of ["install.log", "plugin-install.log"]) {
    try {
      await cp(join(sandbox, name), join(evidence, name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await writeFile(
    join(sandbox, "result.json"),
    JSON.stringify(report, null, 2),
  );
  if (
    report.passed &&
    !options.keep &&
    !options.serve
  ) {
    const rel = relative(tempRoot, sandbox);
    assert(
      rel && !rel.startsWith("..") && !isAbsolute(rel),
      "Cleanup path must be inside the temp directory",
    );
    try {
      await rm(sandbox, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 500,
      });
    } catch (error) {
      console.warn(`Failed to clean up temp directory; retaining ${sandbox}: ${error.message}`);
    }
  }
}
