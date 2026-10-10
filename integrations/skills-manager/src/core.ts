import type { SkillRoot, RootInput, Diagnostic, OperationError, CodedError, Log, DiscoveredEntry, SkillEntry, ParsedSkill, Scan, ManagerState, PolicyResult, Policy, SkillItem, ViewItem, RootView, SkillView, ScopeOptions, MutationOptions, RenameOptions, UploadInput, CreateInput, ImportCandidate, ImportPending, ImportConflict, ImportFailure, ImportResult } from "./types.js";
// dsh-skills-manager core: pure Node.js skill file-management core (fflate is used only for ZIP extraction; independently testable)
//
// Covers DSH user-level and active Session project-level skill roots:
//   - User roots: ~/.dsh/skills and common Agent user directories
//   - Project roots: DSH roots support create and trash; shared Agent and application directories support local-policy enable/disable, while source files remain read-only
//   - Entry forms: <root>/<name>/SKILL.md (bundle) or <root>/<name>.md (flat); read-only sources are discovered recursively, writable sources only one level deep
//   - The frontend displays name, description, and enabled status; it does not validate or automatically repair formats
//
// All functions return plain result objects. Business validation failures return { ok: false, error, code?, params? };
// Error messages remain in Chinese for compatibility; code is a lowercase dotted business error code, and params supplies placeholders for the frontend dictionary;
// System exceptions (such as fs ENOENT) pass through as String(e.message) without a code.
// File-write errors are returned to the caller by the route.

import { homedir } from "node:os";
import {
  join,
  basename,
  dirname,
  resolve,
  relative,
  isAbsolute,
  sep,
} from "node:path";
import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import {
  discoverReadonlyEntries,
  validDiscoveryName,
} from "./readonly-discovery.js";

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Define project sources centrally so path validation, policy identity, and display share one list; this prevents adding visible but unloadable directories.
// Both scopes share Agent ordering; compatibility directories follow the primary directory, with generic project directories last.
const EXTERNAL_SOURCE_ORDER = [
  "ccswitch", "codex", "claude", "gemini", "opencode", "cursor", "copilot",
  "windsurf", "windsurf-user", "trae", "trae-cn", "openclaw", "clawdbot",
  "roo", "codebuddy", "workbuddy", "qoder", "qoder-cn", "lingma", "projectSkills",
];
function rankSources<T extends {key: string; native?: boolean; rank?: number; localeKey?: string}>(sources: T[], startRank: number) {
  const order = (root: T) => EXTERNAL_SOURCE_ORDER.indexOf(root.localeKey === "projectSkills" ? "projectSkills" : root.key);
  const external = sources.filter((root) => !root.native);
  // Validate each entry first; a single-item array does not invoke the sort comparator and must not bypass unregistered-source checks.
  for (const root of external) {
    if (order(root) < 0) throw new Error(`Skill source is not registered in EXTERNAL_SOURCE_ORDER: ${root.key}`);
  }
  external.sort((a, b) => order(a) - order(b));
  const ranks = new Map(external.map((root, index) => [root.key, startRank + index * 10]));
  return sources.map((root) => ({ ...root, rank: root.native ? root.rank! : ranks.get(root.key)! }))
    .sort((a, b) => a.rank - b.rank);
}
const PROJECT_SOURCES = rankSources([
  { key: "dsh", directory: ".dsh", localeKey: "projectDsh", label: "Project DSH", rank: 100, mutable: true, native: true },
  { key: "agents", directory: ".agents", localeKey: "projectAgents", label: "Project Agent", rank: 200, native: true },
  // Preserve native project ranks 100/200; assign other project sources 210–320 using the shared Agent order.
  { key: "copilot", directory: ".github", localeKey: "copilot", label: "Copilot" },
  { key: "codex", directory: ".codex", localeKey: "codex", label: "Codex" },
  { key: "claude", directory: ".claude", localeKey: "claude", label: "Claude" },
  { key: "gemini", directory: ".gemini", localeKey: "gemini", label: "Gemini" },
  { key: "opencode", directory: ".opencode", localeKey: "opencode", label: "OpenCode" },
  { key: "cursor", directory: ".cursor", localeKey: "cursor", label: "Cursor" },
  { key: "windsurf", directory: ".windsurf", localeKey: "windsurf", label: "Windsurf" },
  { key: "trae", directory: ".trae", localeKey: "trae", label: "Trae" },
  { key: "trae-cn", directory: ".trae-cn", localeKey: "traeCn", label: "Trae CN" },
  // Preserve the project-openclaw:<hash> policy key for existing settings; this scans generic <project>/skills, not an OpenClaw-specific directory.
  { key: "openclaw", directory: "", localeKey: "projectSkills", label: "Project Skills" },
  { key: "roo", directory: ".roo", localeKey: "roo", label: "Roo" },
  { key: "codebuddy", directory: ".codebuddy", localeKey: "codebuddy", label: "CodeBuddy" },
  { key: "workbuddy", directory: ".workbuddy", localeKey: "workbuddy", label: "WorkBuddy" },
  // Qoder CN CLI project skills also live in .qoder/skills, shared with the international Qoder edition.
  { key: "qoder", directory: ".qoder", localeKey: "qoder", label: "Qoder" },
  { key: "lingma", directory: ".lingma", localeKey: "lingma", label: "Qoder CN" },
], 210);
const PROJECT_ROOT_KEY_RE = new RegExp(
  `^project-(?:${[...PROJECT_SOURCES]
    .map((source) => source.key)
    .sort((left, right) => right.length - left.length)
    .join("|")}):[a-f0-9]{16}$`,
);
function projectSourceDefinition(kind?: string) {
  return PROJECT_SOURCES.find((source) => `project-${source.key}` === kind);
}
const USER_DSH_POLICY_RANK = 399;
const WINDOWS_DEVICE_NAME_RE =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_SOURCE_DEPTH = 64;
const MAX_ENTRY_NAME_LENGTH = 128;
const MAX_BROWSE_ENTRIES = 500;
const MAX_UPLOAD_ARCHIVE_BYTES = 32 << 20;
const MAX_UPLOAD_ENTRY_BYTES = 32 << 20;
const MAX_UPLOAD_TOTAL_BYTES = 64 << 20;
const MAX_UPLOAD_ENTRIES = 1000;
const MAX_UPLOAD_PATH_LENGTH = 512;
const TRANSIENT_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

// ── Business error codes ─────────────────────────────────────────────────────

/** Create a business Error with code/params for import flows to throw and pass through to failure details. */
function codedError(message: string, code: string, params?: Record<string, unknown>): CodedError {
  const error: CodedError = new Error(message);
  error.code = code;
  error.params = params;
  return error;
}

/** Add business Error code/params to failure details; preserve system exceptions (such as ENOENT, without an error.* prefix) as-is. */
function attachCode<T extends Diagnostic>(item: T, error: CodedError | null | undefined): T {
  if (error && typeof error.code === "string" && /^error\./.test(error.code))
    item.code = error.code;
  if (error && error.params) item.params = error.params;
  return item;
}

// ── Path resolution ─────────────────────────────────────────────────────────

export function resolveDshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

export function resolveAgentsHome() {
  return process.env.DSH_AGENTS_HOME || join(homedir(), ".agents");
}

/**
 * User-level skill directories for DSH and common Agents.
 *
 * Ranks align with the official filesystem provider's user-level priority: DSH=400, Agents=500.
 * The manager provider takes over shared Agents at 450 (still below DSH); other sources follow in order.
 */
export function userRoots(): SkillRoot[] {
  return rankSources([
    {
      key: "dsh",
      path: join(resolveDshHome(), "skills"),
      label: "DSH Skills",
      mutable: true,
      toggleable: true,
      native: true,
      rank: 400,
    },
    {
      key: "agents",
      path: join(resolveAgentsHome(), "skills"),
      label: "Shared Agent",
      mutable: false,
      toggleable: true,
      native: true,
      rank: 450,
    },
    {
      key: "ccswitch",
      path: join(homedir(), ".cc-switch", "skills"),
      label: "CC Switch",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "codex",
      path: join(
        process.env.DSH_CODEX_HOME || join(homedir(), ".codex"),
        "skills",
      ),
      label: "Codex",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "claude",
      path: join(
        process.env.DSH_CLAUDE_HOME || join(homedir(), ".claude"),
        "skills",
      ),
      label: "Claude",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "gemini",
      path: join(
        process.env.DSH_GEMINI_HOME || join(homedir(), ".gemini"),
        "skills",
      ),
      label: "Gemini",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "opencode",
      path: join(
        process.env.DSH_OPENCODE_HOME || join(homedir(), ".config", "opencode"),
        "skills",
      ),
      label: "OpenCode",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "cursor",
      path: join(
        process.env.DSH_CURSOR_HOME || join(homedir(), ".cursor"),
        "skills",
      ),
      label: "Cursor",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "copilot",
      path: join(process.env.DSH_COPILOT_HOME || join(homedir(), ".copilot"), "skills"),
      label: "Copilot",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "windsurf",
      path: join(
        process.env.DSH_WINDSURF_HOME || join(homedir(), ".codeium", "windsurf"),
        "skills",
      ),
      label: "Windsurf",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "windsurf-user",
      localeKey: "windsurfUser",
      path: join(
        process.env.DSH_WINDSURF_USER_HOME || join(homedir(), ".windsurf"),
        "skills",
      ),
      label: "Windsurf Main Directory",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "trae",
      path: join(process.env.DSH_TRAE_HOME || join(homedir(), ".trae"), "skills"),
      label: "Trae",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "trae-cn",
      localeKey: "traeCn",
      path: join(
        process.env.DSH_TRAE_CN_HOME || join(homedir(), ".trae-cn"),
        "skills",
      ),
      label: "Trae China Edition",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "openclaw",
      path: join(
        process.env.DSH_OPENCLAW_HOME || join(homedir(), ".openclaw"),
        "skills",
      ),
      label: "OpenClaw",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "clawdbot",
      path: join(
        process.env.DSH_CLAWDBOT_HOME || join(homedir(), ".clawdbot"),
        "skills",
      ),
      label: "Legacy OpenClaw Directory",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "roo",
      path: join(process.env.DSH_ROO_HOME || join(homedir(), ".roo"), "skills"),
      label: "Roo",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "codebuddy",
      path: join(
        process.env.DSH_CODEBUDDY_HOME || join(homedir(), ".codebuddy"),
        "skills",
      ),
      label: "CodeBuddy",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "workbuddy",
      localeKey: "workbuddy",
      path: join(
        process.env.DSH_WORKBUDDY_HOME || join(homedir(), ".workbuddy"),
        "skills",
      ),
      label: "WorkBuddy",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "qoder",
      localeKey: "qoder",
      path: join(process.env.DSH_QODER_HOME || join(homedir(), ".qoder"), "skills"),
      label: "Qoder",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "qoder-cn",
      localeKey: "qoderCn",
      path: join(
        process.env.DSH_QODER_CN_HOME || join(homedir(), ".qoder-cn"),
        "skills",
      ),
      label: "Qoder CN CLI",
      mutable: false,
      toggleable: true,
      native: false,
    },
    {
      key: "lingma",
      localeKey: "lingma",
      path: join(process.env.DSH_LINGMA_HOME || join(homedir(), ".lingma"), "skills"),
      label: "Qoder CN",
      mutable: false,
      toggleable: true,
      native: false,
    },
  ], 500);
}

function projectIdentity(path: string) {
  const canonical = pathIdentity(path);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

async function nearestProjectRoot(cwd: string) {
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return null;
  let start;
  try {
    start = await fs.realpath(resolve(cwd));
    if (!(await fs.stat(start)).isDirectory()) return null;
  } catch {
    return { unavailable: true, cwd };
  }
  let current = start;
  for (;;) {
    try {
      await fs.lstat(join(current, ".git"));
      return { root: current, cwd: start };
    } catch {
      /* Continue upward to find the nearest project root. */
    }
    const parent = dirname(current);
    // Match the host: use the validated session cwd when no Git marker is present.
    if (parent === current) return { root: start, cwd: start };
    current = parent;
  }
}

async function projectSourceSafe(definition: SkillRoot) {
  // Read-only sources allow directory links, but overlapping sources could bypass the disabled policy of a user root.
  const source = projectSourceDefinition(definition.kind);
  if (!source) return false;
  if (!source.mutable)
    return !(await overlapsUserSkillRoot(definition.path));
  const container = join(
    definition.projectRoot!,
    source.directory,
  );
  for (const path of [container, definition.path]) {
    const st = await lstatOrNull(path);
    if (st && (!st.isDirectory() || st.isSymbolicLink())) return false;
  }
  return !(await overlapsUserSkillRoot(definition.path));
}

/**
 * Derive project skill roots from active Session cwds. Accept only absolute directories resolvable by the host.
 * Multiple Sessions for one project collapse into the same stable keys, preventing same-named skills from different workspaces from merging.
 */
export async function projectRoots(projectCwds: string[] = [], diagnostics?: Diagnostic[]): Promise<SkillRoot[]> {
  const projects = new Map<string, {root: string; cwds: Set<string>}>();
  for (const cwd of Array.isArray(projectCwds) ? projectCwds : []) {
    const found = await nearestProjectRoot(cwd);
    if (!found || !found.root) {
      if (
        found &&
        found.unavailable &&
        Array.isArray(diagnostics) &&
        typeof cwd === "string" &&
        isAbsolute(cwd)
      ) {
        diagnostics.push({
          code: "warning.project.unavailable",
          params: { path: cwd },
          error: `Could not read the active workspace from the host; project skills are hidden: ${cwd}`,
        });
      }
      continue;
    }
    const identity = pathIdentity(found.root);
    const existing = projects.get(identity) || {
      root: found.root,
      cwds: new Set<string>(),
    };
    existing.cwds.add(found.cwd);
    projects.set(identity, existing);
  }
  const roots = [];
  for (const project of [...projects.values()].sort((a, b) =>
    a.root.localeCompare(b.root),
  )) {
    const id = projectIdentity(project.root);
    const common = {
      mutable: false,
      toggleable: false,
      native: true,
      scope: "project",
      projectRoot: project.root,
      projectName: basename(project.root) || project.root,
      workspaceCwds: [...project.cwds].sort(),
    };
    const candidates = PROJECT_SOURCES.map((source) => ({
      ...common,
      key: `project-${source.key}:${id}`,
      kind: `project-${source.key}`,
      localeKey: source.localeKey,
      path: join(project.root, source.directory, "skills"),
      label: source.label,
      rank: source.rank,
      mutable: source.mutable === true,
      native: source.native === true,
      toggleable: true,
    }));
    for (const candidate of candidates) {
      if (candidate.kind !== "project-dsh" && !(await lstatOrNull(candidate.path)))
        continue;
      if (await projectSourceSafe(candidate)) roots.push(candidate);
    }
  }
  return roots;
}

export function managerHomePath() {
  return join(resolveDshHome(), "skills-manager");
}

export function managerStatePath() {
  return join(managerHomePath(), "state.json");
}

export function trashRootPath() {
  return join(managerHomePath(), "trash");
}

export function logPath() {
  return join(resolveDshHome(), "dsh-skills-manager.log");
}

/**
 * List one level of local directories for the frontend's embedded directory picker.
 * Do not follow directory symlinks; imports are still fully security-validated by importSkill after selection.
 */
export async function browseDirectories(inputPath: string) {
  const requested = String(inputPath == null ? "" : inputPath).trim();
  const target = requested === "" ? homedir() : requested;
  if (!isAbsolute(target)) {
    return {
      ok: false,
      error: `Directory path must be absolute: ${target}`,
      code: "error.browse.absolute",
      params: { path: target },
    };
  }

  let canonical;
  let directory;
  try {
    canonical = await fs.realpath(target);
    directory = await fs.stat(canonical);
  } catch (caught) { const error = caught as CodedError;
    return {
      ok: false,
      error: `Could not read directory: ${target}`,
      code: "error.browse.unreadable",
      params: {
        path: target,
        error: String(error && error.message ? error.message : error),
      },
    };
  }
  if (!directory.isDirectory()) {
    return {
      ok: false,
      error: `Not a directory: ${target}`,
      code: "error.browse.notDirectory",
      params: { path: target },
    };
  }

  const entries = [];
  let truncated = false;
  try {
    const items = await fs.readdir(canonical, { withFileTypes: true });
    for (const item of items) {
      // Do not expand directory links in the browser, which could otherwise send the picker into another tree without notice.
      if (!item.isDirectory() || item.isSymbolicLink()) continue;
      // Dirent comes from a directory snapshot; recheck the current entry with lstat to narrow the TOCTOU window
      // and explicitly exclude reparse directories such as Windows junctions.
      const childPath = join(canonical, item.name);
      const childStat = await lstatOrNull(childPath);
      if (!childStat || !childStat.isDirectory() || childStat.isSymbolicLink())
        continue;
      if (entries.length >= MAX_BROWSE_ENTRIES) {
        truncated = true;
        break;
      }
      entries.push({
        name: item.name,
        path: childPath,
        hidden: item.name.startsWith("."),
      });
    }
  } catch (caught) { const error = caught as CodedError;
    return {
      ok: false,
      error: `Could not read directory: ${canonical}`,
      code: "error.browse.unreadable",
      params: {
        path: canonical,
        error: String(error && error.message ? error.message : error),
      },
    };
  }
  entries.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      sensitivity: "base",
      numeric: true,
    }),
  );

  const crumbs = [];
  let cursor = canonical;
  for (;;) {
    const parent = dirname(cursor);
    crumbs.unshift({
      name: parent === cursor ? cursor : basename(cursor),
      path: cursor,
      hidden: false,
    });
    if (parent === cursor) break;
    cursor = parent;
  }
  return { path: canonical, home: homedir(), crumbs, entries, truncated };
}

function dshRootPath() {
  return userRoots().find((root) => root.key === "dsh")!.path;
}

/** Rejection result for read-only sources; action is a translatable semantic value (toggle/delete). */
function readonlyError(action: string): OperationError {
  return {
    ok: false,
    code: "error.root.readonly",
    params: { action },
    error:
      action === "delete"
        ? "This skill source does not allow deletion"
        : "This skill source does not allow enabling or disabling",
  };
}

function rootDefinition(root: RootInput): SkillRoot | null {
  if (root && typeof root === "object" && typeof root.key === "string")
    return root;
  if (typeof root !== "string") return null;
  const resolved = resolve(root);
  return userRoots().find((item) => resolve(item.path) === resolved) || null;
}

function rootByKey(key: string): SkillRoot | null | undefined {
  return userRoots().find((item) => item.key === key) || null;
}

/** Allow file writes only in the user DSH root or a project DSH root derived from an active Session. */
function writableRootDefinition(root: RootInput) {
  const definition = rootDefinition(root);
  if (!definition || definition.mutable !== true) return null;
  if (definition.key === "dsh")
    return resolve(definition.path) === resolve(dshRootPath())
      ? rootByKey("dsh")
      : null;
  if (
    definition.scope !== "project" ||
    definition.kind !== "project-dsh" ||
    typeof definition.projectRoot !== "string" ||
    !isAbsolute(definition.projectRoot!) ||
    definition.key !==
      `project-dsh:${projectIdentity(definition.projectRoot!)}` ||
    resolve(definition.path) !==
      resolve(join(definition.projectRoot!, ".dsh", "skills"))
  )
    return null;
  return definition;
}

async function checkedWritableRootDefinition(root: RootInput): Promise<SkillRoot | OperationError | null | undefined> {
  const definition = writableRootDefinition(root);
  if (!definition || definition.scope !== "project") return definition;
  if (await overlapsUserSkillRoot(definition.path)) {
    return {
      ok: false,
      error: `Project skill directory overlaps a user skill directory; write refused: ${definition.path}`,
      code: "error.root.unsafe",
      params: { path: definition.path },
    };
  }
  // Project repository content is untrusted; refuse writes redirected outside the project through .dsh or skills links.
  for (const path of [join(definition.projectRoot!, ".dsh"), definition.path]) {
    const st = await lstatOrNull(path);
    if (st && (!st.isDirectory() || st.isSymbolicLink())) {
      return {
        ok: false,
        error: `Project skill directory is unsafe; write refused: ${path}`,
        code: "error.root.unsafe",
        params: { path },
      };
    }
  }
  return definition;
}

/** Check whether child equals or is inside parent. Across drive letters, relative returns an absolute path. */
function isSameOrDescendant(parent: string, child: string) {
  const rel = relative(resolve(parent), resolve(child));
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

/** Resolve real paths; if an intermediate directory is a symlink, compare the resolved destinations for overlap. */
async function resolvedPath(path: string) {
  try {
    return await fs.realpath(path);
  } catch {
    return resolve(path);
  }
}

/** Resolve links in the nearest existing ancestor even if the final path does not exist, for permission-boundary overlap checks. */
async function comparisonPath(path: string) {
  let current = resolve(path);
  const missing = [];
  for (;;) {
    try {
      return resolve(await fs.realpath(current), ...missing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.unshift(basename(current));
      current = parent;
    }
  }
}

async function overlapsUserSkillRoot(path: string) {
  const candidate = await comparisonPath(path);
  for (const root of userRoots()) {
    const userPath = await comparisonPath(root.path);
    if (
      isSameOrDescendant(candidate, userPath) ||
      isSameOrDescendant(userPath, candidate)
    )
      return true;
  }
  return false;
}

/** Refuse overlapping paths because an overwrite import could delete its own source. */
async function pathsOverlap(a: string, b: string) {
  const left = await resolvedPath(a);
  const right = await resolvedPath(b);
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

/** Validate within a pre-resolved skill root so each entry scan can reuse realpath and avoid duplicate I/O. */
async function isInsideResolvedRoot(rootReal: string, path: string) {
  return isSameOrDescendant(rootReal, await resolvedPath(path));
}

function pathIdentity(path: string) {
  const canonical = resolve(path);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

async function lstatOrNull(path: string) {
  try {
    return await fs.lstat(path);
  } catch {
    return null;
  }
}

/** Names must be a single ordinary path segment; existing skill names are not restricted to kebab-case. */
export function entryPath(root: string, name: string) {
  if (
    typeof name !== "string" ||
    name === "" ||
    name === "." ||
    name === ".." ||
    name.startsWith(".") ||
    name.length > MAX_ENTRY_NAME_LENGTH ||
    /[\\/:*?"<>|\0]/.test(name) ||
    /[. ]$/.test(name) ||
    WINDOWS_DEVICE_NAME_RE.test(name) ||
    basename(name) !== name
  )
    return null;
  const rootPath = resolve(root);
  const path = resolve(rootPath, name);
  return isSameOrDescendant(rootPath, path) && rootPath !== path ? path : null;
}

function isDshRoot(root: RootInput) {
  return typeof root === "string" && resolve(root) === resolve(dshRootPath());
}

// ── Name normalization ───────────────────────────────────────────────────────

/** Normalize an arbitrary name to kebab-case where possible; return an empty string if no valid name can be produced. */
export function toKebab(s: string) {
  let t = String(s).trim();
  if (t === "") return "";
  t = t.replace(/([a-z0-9])([A-Z])/g, "$1-$2"); // camelCase boundary
  t = t.toLowerCase();
  t = t.replace(/[\s_.]+/g, "-");
  t = t.replace(/[^a-z0-9-]/g, "-");
  t = t.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return t;
}

// ── Frontmatter parsing / serialization (permissive YAML object, preserving key order) ─

/** Strip the UTF-8 BOM often written by Windows tools; otherwise the opening --- will not match. */
function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parse SKILL.md frontmatter and return { fields, map, body }, preserving key order in map.
 * Recognizes only top-level key: value pairs; indented nested fields (such as metadata.source) are excluded from map. */
export function parseSkillDoc(text: string): ParsedSkill {
  const src = stripBom(String(text));
  const lines = src.split(/\r?\n/);
  const map: Record<string, string> = Object.create(null);
  const fields = [];
  let body = src;
  let hasFrontmatter = false;
  if (lines.length > 0 && lines[0].trim() === "---") {
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }
    if (end >= 0) {
      hasFrontmatter = true;
      for (let i = 1; i < end; i++) {
        const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
        if (m) {
          fields.push({ key: m[1], raw: m[2] });
          const block = /^([>|])[-+]?\s*$/.exec(m[2]);
          if (block) {
            const content = [];
            while (
              i + 1 < end &&
              (/^\s/.test(lines[i + 1]) || lines[i + 1] === "")
            ) {
              i++;
              content.push(lines[i]);
            }
            const indentation = content
              .filter((line) => line.trim() !== "")
              .reduce(
                (min, line) =>
                  Math.min(min, (/^\s*/.exec(line) || [""])[0].length),
                Infinity,
              );
            const normalized = content.map((line) =>
              Number.isFinite(indentation)
                ? line.slice(Math.min(indentation, line.length))
                : line,
            );
            map[m[1]] =
              block[1] === ">"
                ? normalized.join(" ").replace(/\s+/g, " ").trim()
                : normalized.join("\n").trim();
          } else {
            map[m[1]] = decodeYamlScalar(m[2]);
          }
        }
      }
      body = lines.slice(end + 1).join("\n");
    }
  }
  return { fields, map, body, hasFrontmatter };
}

/** Read the display value of a YAML scalar without relying on a third-party YAML parser. */
function decodeYamlScalar(v: string) {
  const s = String(v == null ? "" : v).trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
      const value: unknown = JSON.parse(s);
      if (typeof value === "string") return value;
    } catch {
      /* Preserve the original content when parsing fails. */
    }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'")
    return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

export function unquote(v: unknown) {
  const s = String(v == null ? "" : v).trim();
  if (
    s.length >= 2 &&
    ((s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** Write to a temporary file in the same directory and rename it to avoid truncating the original SKILL.md if writing is interrupted. */
/** Antivirus software or indexers on Windows may briefly lock a directory; retry only rename errors known to be recoverable. */
export async function renameWithRetry(source: string, destination: string, options: RenameOptions = {}) {
  const rename =
    typeof options.rename === "function" ? options.rename : fs.rename;
  const maxAttempts =
    Number.isInteger(options.maxAttempts) && options.maxAttempts! > 0
      ? options.maxAttempts!
      : 6;
  const delayMs =
    Number.isFinite(options.delayMs) && options.delayMs! >= 0
      ? options.delayMs!
      : 40;
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(source, destination);
    } catch (caught) { const error = caught as CodedError;
      if (
        !TRANSIENT_RENAME_CODES.has(error && error.code || "") ||
        attempt >= maxAttempts
      )
        throw error;
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, delayMs * attempt),
      );
    }
  }
}

async function removeMovedPath(path: string) {
  const st = await lstatOrNull(path);
  if (!st) return;
  if (st.isDirectory() && !st.isSymbolicLink())
    await fs.rm(path, { recursive: true, force: false });
  else await fs.unlink(path);
}

/** When rename returns EXDEV across disks: copy completely, atomically hide the source entry on its disk, then clean up the hidden copy. */
async function movePathWithFallback(source: string, destination: string, options: RenameOptions = {}) {
  try {
    await renameWithRetry(source, destination, options);
    return { copied: false, cleanupError: null };
  } catch (caught) { const error = caught as CodedError;
    if (!error || error.code !== "EXDEV") throw error;
  }

  const quarantine = join(
    dirname(source),
    `.${basename(source)}.dssm-move-${randomUUID()}`,
  );
  try {
    await fs.cp(source, destination, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    // The source and quarantine are in the same directory; once successful, the original skill name disappears immediately so recursive deletion cannot leave a partially visible entry.
    await renameWithRetry(source, quarantine, options);
  } catch (caught) { const error = caught as CodedError;
    await removeMovedPath(destination).catch(() => undefined);
    throw error;
  }

  let cleanupError = null;
  try {
    await removeMovedPath(quarantine);
  } catch (caught) { const error = caught as CodedError;
    cleanupError = error;
  }
  return { copied: true, cleanupError, quarantine };
}

async function writeFileAtomically(path: string, content: string) {
  const temp = join(
    dirname(path),
    `.${basename(path)}.dssm-${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, path);
  } catch (caught) { const error = caught as CodedError;
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Parse a boolean field value; return true/false for valid values and undefined otherwise. */
export function parseBoolValue(raw: unknown) {
  const v = unquote(raw).trim().toLowerCase();
  if (v === "true" || v === "yes" || v === "on" || v === "1") return true;
  if (v === "false" || v === "no" || v === "off" || v === "0") return false;
  return undefined;
}

// ── Entry resolution / scanning ─────────────────────────────────────────────

/** Resolve an entry by name (bundle first, then flat); return null if not found. */
export async function resolveEntry(root: RootInput, name: string): Promise<DiscoveredEntry | null> {
  const definition = rootDefinition(root);
  if (definition && !definition.mutable) {
    if (!validDiscoveryName(name)) return null;
    return (
      (await discoverReadonlyEntries(definition.path)).entries.find(
        (entry) => entry.name === name,
      ) || null
    );
  }
  const directory = definition ? definition.path : root as string;
  try {
    const bundlePath = entryPath(directory, name);
    if (bundlePath === null) return null;
    const rootPath = resolve(directory);
    const rootStat = await lstatOrNull(rootPath);
    if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink())
      return null;
    const rootReal = await resolvedPath(rootPath);
    const bundleStat = await lstatOrNull(bundlePath);
    if (
      bundleStat &&
      bundleStat.isDirectory() &&
      !bundleStat.isSymbolicLink()
    ) {
      const bundleDoc = join(bundlePath, "SKILL.md");
      const docStat = await lstatOrNull(bundleDoc);
      if (
        docStat &&
        docStat.isFile() &&
        !docStat.isSymbolicLink() &&
        (await isInsideResolvedRoot(rootReal, bundleDoc))
      ) {
        return {
          kind: "bundle",
          docPath: bundleDoc,
          entryPath: bundlePath,
          realDocPath: await fs.realpath(bundleDoc),
          realEntryPath: await fs.realpath(bundlePath),
          linked: false,
        };
      }
    }
    const flatDoc = resolve(rootPath, `${name}.md`);
    if (!isSameOrDescendant(rootPath, flatDoc) || rootPath === flatDoc)
      return null;
    const flatStat = await lstatOrNull(flatDoc);
    if (
      flatStat &&
      flatStat.isFile() &&
      !flatStat.isSymbolicLink() &&
      (await isInsideResolvedRoot(rootReal, flatDoc))
    ) {
      const realDocPath = await fs.realpath(flatDoc);
      return {
        kind: "flat",
        docPath: flatDoc,
        entryPath: flatDoc,
        realDocPath,
        realEntryPath: realDocPath,
        linked: false,
      };
    }
    return null;
  } catch {
    // The source may change between lstat and realpath/readFile; callers consistently treat this as not found.
    return null;
  }
}

function entryOf(name: string, kind: string, docPath: string, doc: Pick<ParsedSkill, "map" | "hasFrontmatter">) {
  const declaredName = doc.map.name !== undefined ? unquote(doc.map.name) : "";
  const description =
    doc.map.description !== undefined ? unquote(doc.map.description) : "";
  const modelValue = parseBoolValue(doc.map["disable-model-invocation"]);
  const userValue = parseBoolValue(doc.map["user-invocable"]);
  const modelDisabled = modelValue === true;
  const userDisabled = userValue === false;
  const invocationPolicyValid =
    (doc.map["disable-model-invocation"] === undefined ||
      modelValue !== undefined) &&
    (doc.map["user-invocable"] === undefined || userValue !== undefined);
  const diagnostics = [];
  if (!doc.hasFrontmatter)
    diagnostics.push({
      level: "error",
      code: "diagnostic.frontmatter.missing",
    });
  if (doc.hasFrontmatter && !declaredName)
    diagnostics.push({ level: "error", code: "diagnostic.name.missing" });
  else if (declaredName && !KEBAB_RE.test(declaredName))
    diagnostics.push({
      level: "error",
      code: "diagnostic.name.invalid",
      params: { name: declaredName },
    });
  if (doc.hasFrontmatter && !description)
    diagnostics.push({
      level: "error",
      code: "diagnostic.description.missing",
    });
  if (!invocationPolicyValid)
    diagnostics.push({ level: "error", code: "diagnostic.invocation.invalid" });
  return {
    name,
    declaredName,
    kind,
    docPath,
    description,
    modelInvocable: !modelDisabled,
    userInvocable: !userDisabled,
    invocationPolicyValid,
    hasFrontmatter: doc.hasFrontmatter,
    // Invalid invocation policy values can be overridden by the manager's local policy; load as long as the structure itself is valid.
    loadable:
      doc.hasFrontmatter && KEBAB_RE.test(declaredName) && description !== "",
    diagnostics,
  };
}

/** Recursively discover read-only sources; writable DSH roots retain top-level scanning and symlink write boundaries. */
export function scanEntries(root: RootInput, options: {metadataOnly: true}): Promise<MetadataScan>;
export function scanEntries(root: RootInput, options?: {metadataOnly?: false}): Promise<Scan>;
export async function scanEntries(root: RootInput, options: {metadataOnly?: boolean} = {}): Promise<Scan | MetadataScan> {
  const definition = rootDefinition(root);
  if (definition && !definition.mutable) {
    const discovered = await discoverReadonlyEntries(definition.path);
    if (options.metadataOnly) return discovered;
    const entries = [];
    for (const entry of discovered.entries) {
      try {
        entries.push({
          ...entryOf(
            entry.name,
            entry.kind,
            entry.docPath,
            parseSkillDoc(await fs.readFile(entry.realDocPath, "utf8")),
          ),
          ...entry,
        });
      } catch {
        /* Ignore invalid or unreadable skills. */
      }
    }
    return { ...discovered, entries };
  }
  const directory = definition ? definition.path : root as string;
  const rootStat = await lstatOrNull(resolve(directory));
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink())
    return { exists: false, entries: [] };
  let items;
  try {
    items = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return { exists: false, entries: [] };
  }
  const byName = new Map<string, SkillEntry>();
  const rootReal = await resolvedPath(directory);
  for (const it of items) {
    try {
      if (it.isSymbolicLink()) continue;
      if (it.isDirectory() && entryPath(directory, it.name) !== null) {
        const docPath = join(directory, it.name, "SKILL.md");
        const st = await lstatOrNull(docPath);
        if (
          !st ||
          !st.isFile() ||
          st.isSymbolicLink() ||
          !(await isInsideResolvedRoot(rootReal, docPath))
        )
          continue;
        const doc = options.metadataOnly
          ? { map: {}, hasFrontmatter: false }
          : parseSkillDoc(await fs.readFile(docPath, "utf8"));
        byName.set(it.name, {
          ...entryOf(it.name, "bundle", docPath, doc),
          entryPath: join(directory, it.name),
          realDocPath: await fs.realpath(docPath),
          realEntryPath: await fs.realpath(join(directory, it.name)),
          linked: false,
        });
      } else if (
        it.isFile() &&
        it.name.toLowerCase().endsWith(".md") &&
        it.name.toLowerCase() !== "skill.md" &&
        entryPath(directory, it.name.slice(0, -3)) !== null
      ) {
        const skillName = it.name.slice(0, -3);
        if (byName.has(skillName)) continue;
        const docPath = join(directory, it.name);
        if (!(await isInsideResolvedRoot(rootReal, docPath))) continue;
        const doc = options.metadataOnly
          ? { map: {}, hasFrontmatter: false }
          : parseSkillDoc(await fs.readFile(docPath, "utf8"));
        const realDocPath = await fs.realpath(docPath);
        byName.set(skillName, {
          ...entryOf(skillName, "flat", docPath, doc),
          entryPath: docPath,
          realDocPath,
          realEntryPath: realDocPath,
          linked: false,
        });
      }
    } catch {
      /* Skip unreadable entries. */
    }
  }
  const entries = [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return { exists: true, entries };
}

/** Prefer the direct SSOT for the same real skill; break ties between entry types by source rank. */
function scanDeduplicatedRoots(roots: SkillRoot[], options: {metadataOnly: true}): Promise<Map<string, MetadataScan>>;
function scanDeduplicatedRoots(roots?: SkillRoot[], options?: {metadataOnly?: false}): Promise<Map<string, Scan>>;
async function scanDeduplicatedRoots(roots: SkillRoot[] = userRoots(), options: {metadataOnly?: boolean} = {}) {
  const results = await Promise.all(
    roots.map(async (root) => [root, options.metadataOnly ? await scanEntries(root, {metadataOnly: true}) : await scanEntries(root)] as const),
  );
  const scans = new Map<string, MetadataScan>();
  const groups = new Map<string, {root: SkillRoot; entry: MetadataEntry}[]>();
  for (const [root, scan] of results) {
    scans.set(root.key, scan);
    for (const entry of scan.entries) {
      const identity = pathIdentity(
        entry.realEntryPath || entry.entryPath || entry.docPath,
      );
      const group = groups.get(identity) || [];
      group.push({ root, entry });
      groups.set(identity, group);
    }
  }
  const winners = new Set();
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        Number(left.entry.linked) - Number(right.entry.linked) ||
        left.root.rank - right.root.rank,
    );
    const winner = group[0];
    winner.entry.providerRank = Math.min(
      ...group.map((item) => item.root.rank),
    );
    winner.entry.policyAliases = group.map((item) => ({
      rootKey: item.root.key,
      name: item.entry.name,
    }));
    winners.add(winner.entry);
  }
  for (const scan of scans.values()) {
    scan.entries = scan.entries.filter((entry) => winners.has(entry));
  }
  return scans;
}

/** Details and lists share path deduplication; scanning to locate an entry does not read unrelated skill bodies. */
async function visibleEntryForRoot(root: SkillRoot, name: string) {
  if (!validDiscoveryName(name)) return null;
  const roots = root.scope === "project" ? [root] : userRoots();
  const scans = await scanDeduplicatedRoots(roots, { metadataOnly: true });
  return (
    scans.get(root.key)?.entries.find((entry) => entry.name === name) || null
  );
}

// ── Manager-local policy (external sources are read-only; enabled state is written to DSH_HOME) ─

function defaultManagerState(): ManagerState {
  const sources: ManagerState["sources"] = Object.create(null);
  const disabledSkills: ManagerState["disabledSkills"] = Object.create(null);
  const enabledSkills: ManagerState["enabledSkills"] = Object.create(null);
  for (const root of userRoots()) {
    if (root.key !== "dsh") sources[root.key] = true;
    disabledSkills[root.key] = [];
    enabledSkills[root.key] = [];
  }
  return { version: 1, sources, disabledSkills, enabledSkills };
}

function validStateSkillName(name: unknown): name is string {
  return validDiscoveryName(name);
}

/** Disable all external sources if an existing state file is unusable, so a damaged config cannot expose skills again. */
function failClosedManagerState() {
  const state = defaultManagerState();
  for (const key of Object.keys(state.sources)) state.sources[key] = false;
  return state;
}

function validPolicyLists(value: unknown, allowMissing = false) {
  if (value === undefined && allowMissing) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, list] of Object.entries(value)) {
    if (
      !userRoots().some((root) => root.key === key) &&
      !PROJECT_ROOT_KEY_RE.test(key)
    )
      continue;
    if (!Array.isArray(list) || list.some((name) => !validStateSkillName(name)))
      return false;
  }
  return true;
}

function validManagerStateDocument(value: ManagerState) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== 1
  )
    return false;
  if (
    !value.sources ||
    typeof value.sources !== "object" ||
    Array.isArray(value.sources)
  )
    return false;
  if (
    !validPolicyLists(value.disabledSkills) ||
    !validPolicyLists(value.enabledSkills, true)
  )
    return false;
  for (const root of userRoots()) {
    if (root.key === "dsh") continue;
    if (typeof value.sources[root.key] !== "boolean") return false;
    const list = value.disabledSkills[root.key];
    if (!Array.isArray(list) || list.some((name) => !validStateSkillName(name)))
      return false;
  }
  // Project source keys may be omitted (enabled by default), but explicit values require the same strict validation as global sources.
  for (const [key, flag] of Object.entries(value.sources)) {
    if (PROJECT_ROOT_KEY_RE.test(key) && typeof flag !== "boolean") return false;
  }
  const enabledSkills = value.enabledSkills || {};
  for (const key of new Set([
    ...Object.keys(value.disabledSkills),
    ...Object.keys(enabledSkills),
  ])) {
    const disabled = new Set(value.disabledSkills[key] || []);
    if ((enabledSkills[key] || []).some((name) => disabled.has(name)))
      return false;
  }
  return true;
}

/** Fill in newly added read-only source keys only for recognized version 1 state; strict validation still fails closed for other structures. */
function migrateManagerStateDocument(value: ManagerState) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== 1
  )
    return value;
  // Version 1 does not record which release introduced a source, so only sources known to be newly added may be filled in.
  // Missing original agents/codex/claude/gemini/opencode fields still indicate a damaged config.
  const addedSources = ["ccswitch", "cursor", "copilot", "windsurf", "windsurf-user", "trae", "trae-cn", "openclaw", "clawdbot", "roo", "codebuddy", "workbuddy", "qoder", "qoder-cn", "lingma"];
  for (const key of addedSources) {
    for (const field of ["sources", "disabledSkills", "enabledSkills"] as const) {
      if (
        value[field] &&
        typeof value[field] === "object" &&
        !Array.isArray(value[field]) &&
        value[field][key] === undefined
      )
        value[field][key] = field === "sources" ? true : [];
    }
  }
  return value;
}

function normalizeManagerState(value: ManagerState) {
  const normalized = defaultManagerState();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return normalized;
  for (const root of userRoots()) {
    if (
      root.key !== "dsh" &&
      value.sources &&
      typeof value.sources[root.key] === "boolean"
    )
      normalized.sources[root.key] = value.sources[root.key];
    const list = value.disabledSkills && value.disabledSkills[root.key];
    if (Array.isArray(list))
      normalized.disabledSkills[root.key] = [
        ...new Set(list.filter((name) => validStateSkillName(name))),
      ].sort();
    const enabled = value.enabledSkills && value.enabledSkills[root.key];
    if (Array.isArray(enabled))
      normalized.enabledSkills[root.key] = [
        ...new Set(enabled.filter((name) => validStateSkillName(name))),
      ].sort();
  }
  if (value.sources && typeof value.sources === "object" && !Array.isArray(value.sources)) {
    for (const [key, flag] of Object.entries(value.sources)) {
      if (PROJECT_ROOT_KEY_RE.test(key) && !key.startsWith("project-dsh:") && typeof flag === "boolean")
        normalized.sources[key] = flag;
    }
  }
  for (const field of ["disabledSkills", "enabledSkills"] as const) {
    const source = value[field];
    if (source && typeof source === "object" && !Array.isArray(source)) {
      for (const [key, list] of Object.entries(source)) {
        if (!PROJECT_ROOT_KEY_RE.test(key) || !Array.isArray(list)) continue;
        normalized[field][key] = [
          ...new Set(list.filter(validStateSkillName)),
        ].sort();
      }
    }
  }
  return normalized;
}

export async function readManagerState(): Promise<PolicyResult> {
  try {
    const raw = await fs.readFile(managerStatePath(), "utf8");
    // Legacy state migration and the schema validation below remain the trust boundary for disk data.
    const parsed = migrateManagerStateDocument(JSON.parse(raw) as ManagerState);
    if (!validManagerStateDocument(parsed))
      throw codedError("invalid manager state schema", "error.state.invalid");
    return {
      state: normalizeManagerState(parsed),
      warning: null,
      writable: true,
    };
  } catch (caught) { const error = caught as CodedError;
    if (error && error.code === "ENOENT")
      return { state: defaultManagerState(), warning: null, writable: true };
    return {
      state: failClosedManagerState(),
      writable: false,
      warning: {
        code: "warning.state.invalid",
        params: { path: managerStatePath() },
        error: `Skill Manager state file is unreadable; all skills have been safely disabled and state writes are locked: ${managerStatePath()}`,
      },
    };
  }
}

async function writeManagerState(value: ManagerState) {
  await fs.mkdir(managerHomePath(), { recursive: true });
  await writeFileAtomically(
    managerStatePath(),
    `${JSON.stringify(normalizeManagerState(value), null, 2)}\n`,
  );
}

function managerSkillOverride(policy: ManagerState, rootKey: string, name: string, policyAliases: {rootKey: string; name: string}[] = []) {
  if ((policy.enabledSkills[rootKey] || []).includes(name)) return true;
  if ((policy.disabledSkills[rootKey] || []).includes(name)) return false;
  let inheritedEnable = false;
  for (const alias of policyAliases) {
    if (alias.rootKey === rootKey && alias.name === name) continue;
    if ((policy.disabledSkills[alias.rootKey] || []).includes(alias.name))
      return false;
    if ((policy.enabledSkills[alias.rootKey] || []).includes(alias.name))
      inheritedEnable = true;
  }
  if (inheritedEnable) return true;
  return undefined;
}

function effectiveSkillPolicy(policyResult: PolicyResult, root: SkillRoot, entry: SkillEntry): Policy {
  const override = managerSkillOverride(
    policyResult.state,
    root.key,
    entry.name,
    entry.policyAliases,
  );
  const sourceEnabled =
    root.key === "dsh" ||
    root.kind === "project-dsh" ||
    policyResult.state.sources[root.key] !== false;
  if (policyResult.writable === false || !sourceEnabled || override === false) {
    return {
      override,
      sourceEnabled,
      modelInvocable: false,
      userInvocable: false,
      enabled: false,
    };
  }
  if (override === true) {
    return {
      override,
      sourceEnabled,
      modelInvocable: true,
      userInvocable: true,
      enabled: true,
    };
  }
  const modelInvocable = entry.invocationPolicyValid && entry.modelInvocable;
  const userInvocable = entry.invocationPolicyValid && entry.userInvocable;
  return {
    override,
    sourceEnabled,
    modelInvocable,
    userInvocable,
    enabled: modelInvocable && userInvocable,
  };
}

function invalidManagerStateWrite() {
  return {
    ok: false,
    code: "error.state.invalid",
    params: { path: managerStatePath() },
    error: `Skill Manager state file is unreadable; overwriting was refused: ${managerStatePath()}`,
  };
}

export async function setSourceEnabled(key: string, enabled: boolean, log?: Log, options: ScopeOptions = {}) {
  let root = rootByKey(key);
  if (!root && PROJECT_ROOT_KEY_RE.test(key) && !key.startsWith("project-dsh:"))
    root = (await projectRoots(options.projectCwds)).find((item) => item.key === key);
  if (!root || root.key === "dsh" || root.kind === "project-dsh" || !root.toggleable)
    return readonlyError("toggle");
  const current = await readManagerState();
  if (current.writable === false) return invalidManagerStateWrite();
  current.state.sources[root.key] = enabled === true;
  await writeManagerState(current.state);
  if (log)
    log(
      enabled ? "source-enable" : "source-disable",
      `${enabled ? "Enable" : "Disable"} source ${root.key}: ${root.path}`,
    );
  return { root: root.key, enabled: enabled === true };
}

async function checkedPolicyRootDefinition(root: RootInput): Promise<SkillRoot | OperationError | null> {
  const definition = rootDefinition(root);
  if (!definition || !definition.toggleable) return null;
  if (definition.scope !== "project") {
    const canonical = rootByKey(definition.key);
    return canonical && resolve(canonical.path) === resolve(definition.path)
      ? canonical
      : null;
  }
  const source = projectSourceDefinition(definition.kind);
  const validProjectRoot =
    source &&
    PROJECT_ROOT_KEY_RE.test(definition.key) &&
    typeof definition.projectRoot === "string" &&
    isAbsolute(definition.projectRoot!) &&
    definition.key ===
      `${definition.kind}:${projectIdentity(definition.projectRoot!)}` &&
    resolve(definition.path) ===
      resolve(
        join(
          definition.projectRoot!,
          source.directory,
          "skills",
        ),
      );
  if (!validProjectRoot) return null;
  if (!(await projectSourceSafe(definition))) {
    return {
      ok: false,
      error: `Project skill directory is unsafe; writing state was refused: ${definition.path}`,
      code: "error.root.unsafe",
      params: { path: definition.path },
    };
  }
  return definition;
}

async function setPolicySkillEnabled(root: RootInput, name: string, enabled: boolean, log?: Log) {
  const definition = await checkedPolicyRootDefinition(root);
  if (definition && definition.ok === false) return definition;
  if (!definition) return readonlyError("toggle");
  const resolved = await resolveEntry(definition, name);
  if (resolved === null)
    return {
      ok: false,
      error: `Skill not found: ${name}`,
      code: "error.skill.notFound",
      params: { name },
    };
  let summary;
  try {
    summary = entryOf(
      name,
      resolved.kind,
      resolved.docPath,
      parseSkillDoc(
        await fs.readFile(resolved.realDocPath || resolved.docPath, "utf8"),
      ),
    );
  } catch {
    return {
      ok: false,
      error: `Skill not found: ${name}`,
      code: "error.skill.notFound",
      params: { name },
    };
  }
  if (!summary.hasFrontmatter) {
    return {
      ok: false,
      error: `Skill is missing complete frontmatter and cannot be ${enabled ? "enabled" : "disabled"}: ${name}`,
      code: "error.skill.noFrontmatter",
      params: { name, action: enabled ? "enable" : "disable" },
    };
  }
  if (!summary.loadable) {
    return {
      ok: false,
      error: `Skill structure is incomplete and cannot be ${enabled ? "enabled" : "disabled"}: ${name}`,
      code: "error.skill.notLoadable",
      params: { name, action: enabled ? "enable" : "disable" },
    };
  }
  const current = await readManagerState();
  if (current.writable === false) return invalidManagerStateWrite();
  const disabled = new Set(current.state.disabledSkills[definition.key] || []);
  const explicitlyEnabled = new Set(
    current.state.enabledSkills[definition.key] || [],
  );
  if (enabled) {
    disabled.delete(name);
    explicitlyEnabled.add(name);
  } else {
    explicitlyEnabled.delete(name);
    disabled.add(name);
  }
  current.state.disabledSkills[definition.key] = [...disabled].sort();
  current.state.enabledSkills[definition.key] = [...explicitlyEnabled].sort();
  await writeManagerState(current.state);
  if (log)
    log(
      enabled ? "policy-enable" : "policy-disable",
      `${enabled ? "Enable" : "Disable"} ${definition.key}/${name} (local policy; source files remain unchanged)`,
    );
  return { root: definition.key, name, enabled: enabled === true };
}

// ── Enable / disable (controls model and manual invocation; non-destructive) ──

/** With enabled=true, restore model and manual invocation; false disables both invocation paths. */
export async function setSkillEnabled(root: RootInput, name: string, enabled: boolean, log?: Log) {
  return setPolicySkillEnabled(root, name, enabled, log);
}

async function safeExistingEntryPaths(root: string, name: string) {
  const paths: {path: string; fileName: string; recursive: boolean}[] = [];
  const bundle = entryPath(root, name);
  if (bundle === null) return paths;
  const flat = resolve(root, `${name}.md`);
  const bundleStat = await lstatOrNull(bundle);
  if (bundleStat && (bundleStat.isDirectory() || bundleStat.isSymbolicLink()))
    paths.push({ path: bundle, fileName: name, recursive: true });
  const flatStat = await lstatOrNull(flat);
  if (flatStat && (flatStat.isFile() || flatStat.isSymbolicLink()))
    paths.push({ path: flat, fileName: `${name}.md`, recursive: false });
  return paths;
}

async function readTrashMetadata(id: string): Promise<TrashMetadata | null> {
  if (entryPath(trashRootPath(), id) === null) return null;
  try {
    const value: TrashMetadata = JSON.parse(
      await fs.readFile(join(trashRootPath(), id, "metadata.json"), "utf8"),
    );
    if (
      !value ||
      value.id !== id ||
      typeof value.name !== "string" ||
      !Array.isArray(value.entries)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Windows Defender / indexers may keep the newly written stage directory locked, causing the container-directory rename
 * to still return EPERM after the short retry window. In that case, retain stage as the only rollback copy, copy entries to the final directory,
 * and write metadata last: listTrash() will not expose a partial item before copying is complete.
 */
async function publishTrashStage(stage: string, finalPath: string, metadata: TrashMetadata, renameOptions?: RenameOptions) {
  try {
    await renameWithRetry(stage, finalPath, renameOptions);
    return { fallback: false, cleanupError: null };
  } catch (caught) { const error = caught as CodedError;
    if (!TRANSIENT_RENAME_CODES.has(error && error.code || "")) throw error;
  }

  await fs.mkdir(finalPath);
  try {
    for (const fileName of metadata.entries) {
      await fs.cp(join(stage, fileName), join(finalPath, fileName), {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      });
    }
    await fs.writeFile(
      join(finalPath, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  } catch (caught) { const error = caught as CodedError;
    await fs
      .rm(finalPath, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }

  let cleanupError = null;
  try {
    await fs.rm(stage, { recursive: true, force: true });
  } catch (caught) { const error = caught as CodedError;
    cleanupError = error;
  }
  return { fallback: true, cleanupError };
}

function trashRootMetadata(definition: SkillRoot) {
  if (definition.key === "dsh")
    return { key: "dsh", scope: "user", label: definition.label };
  return {
    key: definition.key,
    scope: "project",
    kind: "project-dsh",
    projectRoot: definition.projectRoot!,
    projectName: definition.projectName,
    label: definition.label,
  };
}

async function restoreRootDefinition(metadata: TrashMetadata, options: ScopeOptions = {}): Promise<SkillRoot | OperationError | null | undefined> {
  // version 1 entries predate scoped Trash and always belong to $DSH_HOME/skills.
  if (!metadata.root) return rootByKey("dsh");
  if (metadata.root.scope === "user" && metadata.root.key === "dsh")
    return rootByKey("dsh");
  if (
    metadata.root.scope !== "project" ||
    metadata.root.kind !== "project-dsh" ||
    typeof metadata.root.key !== "string" ||
    typeof metadata.root.projectRoot !== "string" ||
    !isAbsolute(metadata.root.projectRoot)
  )
    return {
      ok: false,
      error: `Trash entry has an invalid source: ${metadata.id}`,
      code: "error.trash.invalid",
      params: { id: metadata.id },
    };
  const roots = await projectRoots(options.projectCwds);
  const normalizedProjectRoot = pathIdentity(metadata.root.projectRoot);
  const root = roots.find(
    (item) =>
      item.key === metadata.root!.key &&
      item.kind === "project-dsh" &&
      pathIdentity(item.projectRoot!) === normalizedProjectRoot,
  );
  if (!root) {
    return {
      ok: false,
      error: `The original project is not in an active workspace and cannot be restored: ${metadata.root.projectRoot}`,
      code: "error.trash.projectUnavailable",
      params: { path: metadata.root.projectRoot },
    };
  }
  return checkedWritableRootDefinition(root);
}

/** Move one skill from the user or active project's DSH root into the manager-owned trash. */
export async function deleteSkill(root: RootInput, name: string, log?: Log, options: MutationOptions = {}) {
  const definition = await checkedWritableRootDefinition(root);
  if (definition && definition.ok === false) return definition;
  if (!definition) return readonlyError("delete");
  const resolved = await resolveEntry(definition, name);
  if (resolved === null)
    return {
      ok: false,
      error: `Skill not found: ${name}`,
      code: "error.skill.notFound",
      params: { name },
    };
  const targets = await safeExistingEntryPaths(definition.path, name);
  const id = `${Date.now()}-${randomUUID()}`;
  const trashRoot = trashRootPath();
  const stage = join(trashRoot, `.stage-${randomUUID()}`);
  const finalPath = join(trashRoot, id);
  const moved = [];
  await fs.mkdir(stage, { recursive: true });
  try {
    for (const target of targets) {
      const destination = join(stage, target.fileName);
      const transferred = await movePathWithFallback(
        target.path,
        destination,
        options.renameOptions,
      );
      if (transferred.cleanupError && log)
        log(
          "trash-source-warning",
          `Skill was moved to trash across disks, but the hidden source copy is pending cleanup: ${transferred.quarantine} (${transferred.cleanupError.message || transferred.cleanupError})`,
        );
      moved.push({ ...target, destination });
    }
    const metadata = {
      version: 2,
      id,
      name,
      deletedAt: new Date().toISOString(),
      entries: moved.map((item) => item.fileName),
      root: trashRootMetadata(definition),
    };
    await fs.writeFile(
      join(stage, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
    const published = await publishTrashStage(
      stage,
      finalPath,
      metadata,
      options.renameOptions,
    );
    if (published.cleanupError && log)
      log(
        "trash-stage-warning",
        `Trash was published, but the temporary directory is pending cleanup: ${stage} (${published.cleanupError.message || published.cleanupError})`,
      );
    if (log) log("trash", `Moved to trash ${name} -> ${finalPath}`);
    return { id, name, deletedAt: metadata.deletedAt, root: metadata.root };
  } catch (caught) { const error = caught as CodedError;
    const rollbackFailures = [];
    for (const item of moved.reverse()) {
      try {
        await movePathWithFallback(
          item.destination,
          item.path,
          options.renameOptions,
        );
      } catch (caught) { const rollbackError = caught as CodedError;
        rollbackFailures.push({
          path: item.destination,
          error: String(
            rollbackError && rollbackError.message
              ? rollbackError.message
              : rollbackError,
          ),
        });
      }
    }
    if (rollbackFailures.length) {
      const causeText = String(error && error.message ? error.message : error);
      throw codedError(
        `${causeText}; trash rollback failed, and unrestored content remains at: ${stage}`,
        "error.trash.rollbackFailed",
        { path: stage, error: causeText },
      );
    }
    await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function listTrash() {
  let items;
  try {
    items = await fs.readdir(trashRootPath(), { withFileTypes: true });
  } catch {
    return [];
  }
  const result = [];
  for (const item of items) {
    if (!item.isDirectory() || item.name.startsWith(".")) continue;
    const metadata = await readTrashMetadata(item.name);
    if (metadata) result.push(metadata);
  }
  return result.sort((a, b) =>
    String(b.deletedAt).localeCompare(String(a.deletedAt)),
  );
}

export async function restoreTrash(id: string, log?: Log, options: MutationOptions = {}) {
  const metadata = await readTrashMetadata(id);
  if (!metadata)
    return {
      ok: false,
      error: `Trash entry not found: ${id}`,
      code: "error.trash.notFound",
      params: { id },
    };
  const definition = await restoreRootDefinition(metadata, options);
  if (!definition || definition.ok === false)
    return definition || readonlyError("restore");
  const root = definition.path;
  const conflicts = await safeExistingEntryPaths(root, metadata.name);
  if (conflicts.length)
    return {
      ok: false,
      error: `Cannot restore because a skill with the same name already exists: ${metadata.name}`,
      code: "error.trash.conflict",
      params: { name: metadata.name },
    };
  await fs.mkdir(root, { recursive: true });
  const itemRoot = join(trashRootPath(), id);
  const moved = [];
  try {
    for (const fileName of metadata.entries) {
      const source = join(itemRoot, fileName);
      const destination = join(root, fileName);
      if (
        !isSameOrDescendant(itemRoot, source) ||
        !isSameOrDescendant(root, destination)
      )
        throw codedError("Invalid trash entry path", "error.trash.invalid", { id });
      await movePathWithFallback(source, destination, options.renameOptions);
      moved.push({ source, destination });
    }
    await fs.rm(itemRoot, { recursive: true, force: true });
    if (log) log("restore", `Restored from trash ${metadata.name} -> ${root}`);
    return { id, name: metadata.name, root: trashRootMetadata(definition) };
  } catch (caught) { const error = caught as CodedError;
    for (const item of moved.reverse())
      await movePathWithFallback(
        item.destination,
        item.source,
        options.renameOptions,
      ).catch(() => undefined);
    throw error;
  }
}

export async function permanentlyDeleteTrash(id: string, log?: Log) {
  const metadata = await readTrashMetadata(id);
  if (!metadata)
    return {
      ok: false,
      error: `Trash entry not found: ${id}`,
      code: "error.trash.notFound",
      params: { id },
    };
  await fs.rm(join(trashRootPath(), id), { recursive: true, force: true });
  if (log) log("trash-delete", `Permanently deleted trash entry ${metadata.name} (${id})`);
  return { id, name: metadata.name };
}

// ── Import ───────────────────────────────────────────────────────────────────

/** Analyze a source: one skill directory, one .md file, or a batch directory. */
async function analyzeSource(source: string): Promise<SourceAnalysis> {
  let st;
  try {
    st = await fs.lstat(source);
  } catch {
    return {
      kind: "none",
      error: `Path not found: ${source}`,
      code: "error.source.notFound",
      params: { path: source },
    };
  }
  if (st.isSymbolicLink())
    return {
      kind: "none",
      error: `Skill sources containing symbolic links are not supported: ${source}`,
      code: "error.source.symlink",
      params: { path: source },
    };
  if (st.isDirectory()) {
    const sk = join(source, "SKILL.md");
    const skSt = await lstatOrNull(sk);
    // Match preflight checks to the actual import: reject a symlinked SKILL.md so dry runs cannot pass only for the real import to fail.
    if (skSt && skSt.isSymbolicLink())
      return {
        kind: "none",
        error: `Skill sources containing symbolic links are not supported: ${sk}`,
        code: "error.source.symlink",
        params: { path: sk },
      };
    if (skSt && skSt.isFile()) {
      return {
        kind: "single",
        rawName: basename(source),
        kebab: toKebab(basename(source)),
        source,
        isDir: true,
        skillFile: sk,
      };
    }
    return { kind: "batch", rawName: basename(source), source, isDir: true };
  }
  if (st.isFile() && source.toLowerCase().endsWith(".md")) {
    if (basename(source).toLowerCase() === "skill.md") {
      const parent = dirname(source);
      return {
        kind: "single",
        rawName: basename(parent),
        kebab: toKebab(basename(parent)),
        source: parent,
        isDir: true,
        skillFile: source,
      };
    }
    const rawName = basename(source).slice(0, -3);
    return {
      kind: "single",
      rawName,
      kebab: toKebab(rawName),
      source,
      isDir: false,
      skillFile: source,
    };
  }
  return {
    kind: "none",
    error: `Unrecognized skill source: ${source}`,
    code: "error.source.unrecognized",
    params: { path: source },
  };
}

async function collectCandidates(dir: string): Promise<ImportCandidate[]> {
  const items = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const it of items) {
    if (it.isSymbolicLink())
      throw codedError(
        `Skill sources containing symbolic links are not supported: ${join(dir, it.name)}`,
        "error.source.symlink",
        { path: join(dir, it.name) },
      );
    if (it.isDirectory()) {
      const sk = join(dir, it.name, "SKILL.md");
      // lstatOrNull swallows I/O errors (null means skip); symlinks must throw so they cannot be hidden by the skip logic.
      const st = await lstatOrNull(sk);
      if (st && st.isSymbolicLink())
        throw codedError(
          `Skill sources containing symbolic links are not supported: ${sk}`,
          "error.source.symlink",
          { path: sk },
        );
      if (st && st.isFile()) {
        out.push({
          source: join(dir, it.name),
          kebab: toKebab(it.name),
          rawName: it.name,
          isDir: true,
        });
      }
    } else if (
      it.isFile() &&
      it.name.toLowerCase().endsWith(".md") &&
      it.name.toLowerCase() !== "skill.md"
    ) {
      out.push({
        source: join(dir, it.name),
        kebab: toKebab(it.name.slice(0, -3)),
        rawName: it.name.slice(0, -3),
        isDir: false,
      });
    }
  }
  return out;
}

/** Reject symbolic links in imported content to prevent files outside the destination from entering the skill directory. */
async function assertNoSymbolicLinks(source: string) {
  const pending = [{ path: source, depth: 0 }];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > MAX_SOURCE_DEPTH)
      throw codedError(
        `Skill source directory exceeds the maximum depth of ${MAX_SOURCE_DEPTH}: ${source}`,
        "error.source.tooDeep",
        { depth: MAX_SOURCE_DEPTH, path: source },
      );
    const st = await fs.lstat(current.path);
    if (st.isSymbolicLink())
      throw codedError(
        `Skill sources containing symbolic links are not supported: ${current.path}`,
        "error.source.symlink",
        { path: current.path },
      );
    if (!st.isDirectory()) continue;
    const items = await fs.readdir(current.path, { withFileTypes: true });
    for (const item of items) {
      const path = join(current.path, item.name);
      if (item.isSymbolicLink())
        throw codedError(
          `Skill sources containing symbolic links are not supported: ${path}`,
          "error.source.symlink",
          { path },
        );
      if (item.isDirectory()) pending.push({ path, depth: current.depth + 1 });
    }
  }
}

function temporaryPath(target: string, kind: string) {
  return join(
    dirname(target),
    `.${basename(target)}.dssm-${kind}-${randomUUID()}`,
  );
}

/** Dry-run preflight performs the same symlink/depth checks as import; a preflight failure is final and does not proceed to overwrite confirmation.
 * The import's post-copy validation still handles races where the source is replaced between preflight and import. */
async function preflightCandidates(pending: ImportPending[], conflicts: ImportConflict[], failed: ImportFailure[]) {
  for (const group of [pending, conflicts]) {
    for (let i = group.length - 1; i >= 0; i--) {
      const candidate = group[i];
      try {
        await assertNoSymbolicLinks(candidate.source);
      } catch (caught) { const error = caught as CodedError;
        failed.push(
          attachCode(
            {
              source: candidate.source,
              error: String(error && error.message ? error.message : error),
            },
            error,
          ),
        );
        group.splice(i, 1);
      }
    }
  }
}

/** Copy to a temporary path in the same directory first; if copying fails, leave the existing skill untouched. */
async function copyToTemporary(source: string, target: string, isDir: boolean) {
  const temp = temporaryPath(target, "stage");
  try {
    await assertNoSymbolicLinks(source);
    if (isDir)
      await fs.cp(source, temp, { recursive: true, dereference: false });
    else await fs.copyFile(source, temp);
    await assertNoSymbolicLinks(temp);
    return temp;
  } catch (caught) { const error = caught as CodedError;
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Replace only after the temporary copy is ready; if replacement fails, attempt to restore the old entry. */
async function replaceWithCopy(source: string, dest: string, isDir: boolean, existing: string[] = []) {
  const stage = await copyToTemporary(source, dest, isDir);
  const backups = [];
  try {
    for (const path of existing) {
      const backup = temporaryPath(path, "backup");
      await fs.rename(path, backup);
      backups.push({ path, backup });
    }
    await fs.rename(stage, dest);
  } catch (caught) { const error = caught as CodedError;
    await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined);
    const rollbackFailures = [];
    for (const item of backups.reverse()) {
      try {
        await fs.rename(item.backup, item.path);
      } catch (caught) { const rollbackError = caught as CodedError;
        rollbackFailures.push(item.backup);
      }
    }
    if (rollbackFailures.length) {
      const causeText = String(error && error.message ? error.message : error);
      throw codedError(
        `${causeText}; overwrite import rollback failed; backups are retained at: ${rollbackFailures.join(", ")}`,
        "error.import.rollbackFailed",
        { path: rollbackFailures.join("; "), error: causeText },
      );
    }
    throw error;
  }
  const warnings: Diagnostic[] = [];
  for (const item of backups) {
    try {
      await fs.rm(item.backup, { recursive: true, force: true });
    } catch (caught) { const error = caught as CodedError;
      warnings.push({
        code: "warning.backupUncleaned",
        params: {
          path: item.backup,
          error: String(error && error.message ? error.message : error),
        },
        error: `Old-version backup was not cleaned up: ${item.backup} (${String(error && error.message ? error.message : error)})`,
      });
    }
  }
  return warnings;
}

/**
 * Import skills into the target root.
 * options: { conflict: 'skip'|'overwrite', dryRun: boolean }
 * On success, returns { kind, imported, skipped, failed }; on failure, returns { ok:false, error }.
 */
export async function importSkill(source: string, log?: Log, options: MutationOptions = {}): Promise<ImportResult> {
  const targetRoot = dshRootPath();
  const conflict = options.conflict === "overwrite" ? "overwrite" : "skip";
  const dryRun = options.dryRun === true;

  const analysis = await analyzeSource(source);
  if (analysis.kind === "none")
    return {
      ok: false,
      error: analysis.error || "Unrecognized skill source",
      code: analysis.code || "error.source.unrecognized",
      params: analysis.params,
    };
  if (await pathsOverlap(analysis.source, targetRoot))
    return {
      ok: false,
      error: "Import source must not be the DSH skills directory or overlap it",
      code: "error.import.overlap",
    };

  let candidates = [];
  if (analysis.kind === "single") {
    candidates = [
      {
        source: analysis.source,
        kebab: analysis.kebab,
        rawName: analysis.rawName,
        isDir: analysis.isDir,
      },
    ];
  } else {
    try {
      candidates = await collectCandidates(source);
    } catch (caught) { const error = caught as CodedError;
      return attachCode(
        {
          ok: false,
          error: String(error && error.message ? error.message : error),
        },
        error,
      );
    }
    if (candidates.length === 0)
      return {
        ok: false,
        error: `No skill entries found in directory (expected subdirectories containing SKILL.md or .md files): ${source}`,
        code: "error.import.emptySource",
        params: { path: source },
      };
  }

  const pending: ImportPending[] = [];
  const conflicts: ImportConflict[] = [];
  const failed: ImportFailure[] = [];
  const imported: NonNullable<ImportResult["imported"]> = [];
  const skipped: NonNullable<ImportResult["skipped"]> = [];

  const nameCount = new Map<string, number>();
  for (const candidate of candidates) {
    if (
      candidate.kebab &&
      KEBAB_RE.test(candidate.kebab) &&
      entryPath(targetRoot, candidate.kebab) !== null
    )
      nameCount.set(candidate.kebab, (nameCount.get(candidate.kebab) || 0) + 1);
  }

  function failureResult() {
    return {
      ok: false,
      // Aggregate the original failure details; the frontend prefers translated failed entries, so this is only a fallback.
      error: failed.map((item) => item.error).join("; "),
      code: "error.import.failed",
      kind: analysis.kind,
      imported,
      skipped,
      failed,
    };
  }

  for (const c of candidates) {
    if (
      !c.kebab ||
      !KEBAB_RE.test(c.kebab) ||
      entryPath(targetRoot, c.kebab) === null
    ) {
      failed.push({
        source: c.source,
        error: `Could not generate a valid kebab-case name (original name: ${c.rawName || basename(c.source)})`,
        code: "error.import.invalidName",
        params: { name: c.rawName || basename(c.source) },
      });
      continue;
    }
    if (nameCount.get(c.kebab)! > 1) {
      failed.push({
        source: c.source,
        error: `Multiple items in the batch source have the same name: ${c.kebab}`,
        code: "error.import.duplicateName",
        params: { name: c.kebab },
      });
      continue;
    }
    const dest = c.isDir
      ? join(targetRoot, c.kebab)
      : join(targetRoot, `${c.kebab}.md`);
    const paths = [
      join(targetRoot, c.kebab),
      join(targetRoot, `${c.kebab}.md`),
    ];
    const existing = [];
    for (const path of paths) {
      try {
        await fs.stat(path);
        existing.push(path);
      } catch {}
    }
    if (existing.length) {
      conflicts.push({
        name: c.kebab,
        source: c.source,
        isDir: c.isDir,
        paths: existing,
      });
      continue;
    }
    pending.push({ name: c.kebab, source: c.source, isDir: c.isDir, dest });
  }

  if (pending.length === 0 && conflicts.length === 0) return failureResult();

  if (dryRun) {
    // Preflight is conclusive: apply the same symlink/depth checks as import so confirmation cannot succeed only for the actual import to fail.
    await preflightCandidates(pending, conflicts, failed);
    if (pending.length === 0 && conflicts.length === 0) return failureResult();
    return { kind: analysis.kind, pending, conflicts, failed };
  }

  if (
    pending.length > 0 ||
    (conflict === "overwrite" && conflicts.length > 0)
  ) {
    await fs.mkdir(targetRoot, { recursive: true });
  }

  for (const p of pending) {
    try {
      const warnings = await replaceWithCopy(p.source, p.dest, p.isDir);
      imported.push({ name: p.name, overwritten: false, warnings });
      if (log) log("import", `Imported ${p.source} -> ${p.dest}`);
    } catch (caught) { const e = caught as CodedError;
      failed.push(
        attachCode(
          { source: p.source, error: String(e && e.message ? e.message : e) },
          e,
        ),
      );
    }
  }

  if (conflict === "overwrite") {
    for (const c of conflicts) {
      try {
        const dest = c.isDir
          ? join(targetRoot, c.name)
          : join(targetRoot, `${c.name}.md`);
        const warnings = await replaceWithCopy(
          c.source,
          dest,
          c.isDir,
          c.paths,
        );
        imported.push({ name: c.name, overwritten: true, warnings });
        if (log) log("import-overwrite", `Overwrote from ${c.source} -> ${dest}`);
      } catch (caught) { const e = caught as CodedError;
        failed.push(
          attachCode(
            { source: c.source, error: String(e && e.message ? e.message : e) },
            e,
          ),
        );
      }
    }
  } else {
    for (const c of conflicts) skipped.push({ name: c.name, source: c.source });
  }

  if (failed.length && imported.length === 0) return failureResult();
  return { kind: analysis.kind, imported, skipped, failed };
}

// ── Browser upload import ───────────────────────────────────────────────────

/**
 * Validate relative paths provided by the browser or a ZIP. Uploaded content is always written as regular files; ZIP link metadata is not interpreted.
 * This avoids relying on the browser exposing local absolute paths and prevents archives from escaping the manager's staging directory.
 */
function normalizeUploadPath(input: string) {
  const raw = String(input == null ? "" : input).replace(/\\/g, "/");
  if (
    !raw ||
    raw.length > MAX_UPLOAD_PATH_LENGTH ||
    raw.includes("\0") ||
    raw.startsWith("/") ||
    /^[A-Za-z]:/.test(raw) ||
    raw.startsWith("//")
  ) {
    throw codedError(`Invalid uploaded entry path: ${raw}`, "error.upload.path", {
      path: raw,
    });
  }
  const directory = raw.endsWith("/");
  const parts = raw
    .split("/")
    .filter((part, index, all) =>
      directory && index === all.length - 1 ? false : true,
    );
  if (
    !parts.length ||
    parts.length > MAX_SOURCE_DEPTH ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.length > MAX_ENTRY_NAME_LENGTH ||
        WINDOWS_DEVICE_NAME_RE.test(part),
    )
  ) {
    throw codedError(`Invalid uploaded entry path: ${raw}`, "error.upload.path", {
      path: raw,
    });
  }
  return { path: parts.join("/"), directory };
}

function decodeUploadBase64(value: string, maxBytes: number, code = "error.upload.tooLarge") {
  const raw = String(value == null ? "" : value);
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  const dataLength = raw.length - padding;
  const firstPadding = raw.indexOf("=");
  if (
    raw.length % 4 !== 0 ||
    (firstPadding !== -1 && firstPadding !== dataLength)
  ) {
    throw codedError("Uploaded content is not valid Base64", "error.upload.encoding");
  }
  const decodedLength = (raw.length / 4) * 3 - padding;
  if (decodedLength > maxBytes)
    throw codedError(`Uploaded content exceeds the ${maxBytes}-byte limit`, code, {
      limit: maxBytes,
    });
  // Avoid regexes with repeated groups on multi-MiB strings; V8 may exhaust the call stack on valid large files.
  for (let index = 0; index < dataLength; index += 1) {
    const char = raw.charCodeAt(index);
    if (
      !(
        (char >= 65 && char <= 90) ||
        (char >= 97 && char <= 122) ||
        (char >= 48 && char <= 57) ||
        char === 43 ||
        char === 47
      )
    ) {
      throw codedError("Uploaded content is not valid Base64", "error.upload.encoding");
    }
  }
  const bytes = Buffer.from(raw, "base64");
  return bytes;
}

function uploadError(error: CodedError): OperationError {
  return attachCode(
    {
      ok: false,
      error: String(error && error.message ? error.message : error),
    },
    error,
  );
}

async function writeUploadedEntries(contentRoot: string, entries: UploadInput["entries"]) {
  if (!Array.isArray(entries) || entries.length === 0)
    throw codedError("Uploaded content is empty", "error.upload.empty");
  if (entries.length > MAX_UPLOAD_ENTRIES)
    throw codedError(
      `Uploaded entry count exceeds the limit of ${MAX_UPLOAD_ENTRIES}`,
      "error.upload.tooMany",
      { limit: MAX_UPLOAD_ENTRIES },
    );
  let total = 0;
  const seen = new Set();
  for (const entry of entries) {
    const normalized = normalizeUploadPath(entry && entry.path);
    const key = normalized.path.toLowerCase();
    if (seen.has(key))
      throw codedError(
        `Uploaded content contains a duplicate path: ${normalized.path}`,
        "error.upload.duplicate",
        { path: normalized.path },
      );
    seen.add(key);
    if (normalized.directory) continue;
    const bytes = decodeUploadBase64(
      entry && entry.data,
      MAX_UPLOAD_ENTRY_BYTES,
    );
    total += bytes.length;
    if (total > MAX_UPLOAD_TOTAL_BYTES)
      throw codedError(
        `Total uploaded content exceeds the ${MAX_UPLOAD_TOTAL_BYTES}-byte limit`,
        "error.upload.tooLarge",
        { limit: MAX_UPLOAD_TOTAL_BYTES },
      );
    const target = join(contentRoot, ...normalized.path.split("/"));
    if (!isSameOrDescendant(contentRoot, target))
      throw codedError(
        `Invalid uploaded entry path: ${normalized.path}`,
        "error.upload.path",
        { path: normalized.path },
      );
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
}

async function writeUploadedZip(contentRoot: string, encoded: string) {
  const archive = decodeUploadBase64(
    encoded,
    MAX_UPLOAD_ARCHIVE_BYTES,
    "error.upload.archiveTooLarge",
  );
  let count = 0;
  let total = 0;
  let files;
  try {
    files = unzipSync(archive, {
      filter(info) {
        const normalized = normalizeUploadPath(info.name);
        count += 1;
        if (count > MAX_UPLOAD_ENTRIES)
          throw codedError(
            `ZIP contains more than ${MAX_UPLOAD_ENTRIES} entries`,
            "error.upload.tooMany",
            { limit: MAX_UPLOAD_ENTRIES },
          );
        if (!normalized.directory && info.originalSize > MAX_UPLOAD_ENTRY_BYTES)
          throw codedError(
            `ZIP entry is too large: ${normalized.path}`,
            "error.upload.tooLarge",
            { limit: MAX_UPLOAD_ENTRY_BYTES },
          );
        total += normalized.directory ? 0 : info.originalSize;
        if (total > MAX_UPLOAD_TOTAL_BYTES)
          throw codedError(
            `Total uncompressed ZIP size exceeds the ${MAX_UPLOAD_TOTAL_BYTES}-byte limit`,
            "error.upload.tooLarge",
            { limit: MAX_UPLOAD_TOTAL_BYTES },
          );
        return !normalized.directory;
      },
    });
  } catch (caught) { const error = caught as CodedError;
    if (error && /^error\./.test(String(error.code || ""))) throw error;
    throw codedError(
      `Could not extract ZIP: ${String(error && error.message ? error.message : error)}`,
      "error.upload.zipInvalid",
    );
  }
  const entries = Object.entries(files).map(([path, bytes]) => ({
    path,
    data: Buffer.from(bytes).toString("base64"),
  }));
  await writeUploadedEntries(contentRoot, entries);
}

async function prepareUploadedSource(sessionRoot: string, input: UploadInput) {
  const contentRoot = join(sessionRoot, "content");
  await fs.mkdir(contentRoot, { recursive: true });
  if (input && input.zip !== undefined)
    await writeUploadedZip(contentRoot, input.zip);
  else await writeUploadedEntries(contentRoot, input && input.entries);

  const rootSkill = join(contentRoot, "SKILL.md");
  const rootSkillStat = await lstatOrNull(rootSkill);
  if (!rootSkillStat || !rootSkillStat.isFile()) return contentRoot;

  const doc = parseSkillDoc(await fs.readFile(rootSkill, "utf8"));
  const fallback = String((input && input.name) || "uploaded-skill")
    .replace(/\.zip$/i, "")
    .replace(/^skill\.md$/i, "uploaded-skill");
  const skillName = toKebab(doc.map.name || fallback);
  if (
    !skillName ||
    !KEBAB_RE.test(skillName) ||
    entryPath(contentRoot, skillName) === null
  ) {
    throw codedError(
      `Could not generate a valid kebab-case name (original name: ${doc.map.name || fallback})`,
      "error.import.invalidName",
      { name: doc.map.name || fallback },
    );
  }
  const batchRoot = join(sessionRoot, "batch");
  const wrappedRoot = join(batchRoot, skillName);
  await fs.mkdir(batchRoot, { recursive: true });
  await fs.rename(contentRoot, wrappedRoot);
  return batchRoot;
}

/**
 * Receive content read by the browser, stage it in the manager's private directory, and reuse the existing atomic import path.
 * input: { name, entries:[{path,data(base64)}] } or { name, zip:base64 }.
 */
export async function importUploadedSkill(input: UploadInput, log?: Log, options: MutationOptions = {}): Promise<ImportResult> {
  const uploadHome = join(managerHomePath(), "uploads");
  const sessionRoot = join(uploadHome, `.upload-${randomUUID()}`);
  try {
    await fs.mkdir(sessionRoot, { recursive: true });
    const source = await prepareUploadedSource(sessionRoot, input || {});
    return await importSkill(source, log, options);
  } catch (caught) { const error = caught as CodedError;
    return uploadError(error);
  } finally {
    await fs
      .rm(sessionRoot, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

// ── Create / details / provider ──────────────────────────────────────────────

function yamlString(value: string) {
  return JSON.stringify(String(value));
}

export async function createSkill(input: CreateInput, log?: Log, options: MutationOptions = {}) {
  const requestedRoot = Object.prototype.hasOwnProperty.call(options, "root")
    ? options.root
    : rootByKey("dsh");
  const definition = await checkedWritableRootDefinition(requestedRoot);
  if (definition && definition.ok === false) return definition;
  if (!definition) return readonlyError("create");
  const root = definition.path;
  const requestedName = String((input && input.name) || "").trim();
  const name = toKebab(requestedName);
  const description = String((input && input.description) || "").trim();
  const body = String((input && input.body) || "").trim();
  if (!name || !KEBAB_RE.test(name) || entryPath(root, name) === null)
    return {
      ok: false,
      error: `Could not generate a valid kebab-case name (original name: ${requestedName})`,
      code: "error.import.invalidName",
      params: { name: requestedName },
    };
  if (!description)
    return {
      ok: false,
      error: "Skill description cannot be empty",
      code: "error.create.descriptionRequired",
    };
  if (!body)
    return {
      ok: false,
      error: "Skill body cannot be empty",
      code: "error.create.bodyRequired",
    };
  if (description.length > 500 || body.length > 1 << 18)
    return { ok: false, error: "Skill content is too long", code: "error.create.tooLarge" };
  if (
    await safeExistingEntryPaths(root, name).then((items) => items.length > 0)
  )
    return {
      ok: false,
      error: `A skill with the same name already exists: ${name}`,
      code: "error.create.conflict",
      params: { name },
    };
  await fs.mkdir(root, { recursive: true });
  const target = entryPath(root, name)!;
  const stage = temporaryPath(target, "create");
  try {
    await fs.mkdir(stage);
    const content = `---\nname: ${name}\ndescription: ${yamlString(description)}\n---\n\n${body}\n`;
    await fs.writeFile(join(stage, "SKILL.md"), content, "utf8");
    await fs.rename(stage, target);
  } catch (caught) { const error = caught as CodedError;
    await fs.rm(stage, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  if (log) log("create", `Created ${join(target, "SKILL.md")}`);
  return { name, path: join(target, "SKILL.md"), root: definition.key };
}

export async function skillDetail(key: string, name: string, options: ScopeOptions = {}) {
  const scopedRoots = await projectRoots(options.projectCwds);
  const root = rootByKey(key) || scopedRoots.find((item) => item.key === key);
  if (!root)
    return {
      ok: false,
      error: `Unknown skill source: ${key}`,
      code: "error.root.unknown",
      params: { root: key },
    };
  const entry = await visibleEntryForRoot(root, name);
  if (!entry)
    return {
      ok: false,
      error: `Skill not found: ${name}`,
      code: "error.skill.notFound",
      params: { name },
    };
  let raw;
  try {
    raw = await fs.readFile(entry.realDocPath || entry.docPath, "utf8");
  } catch {
    return {
      ok: false,
      error: `Skill not found: ${name}`,
      code: "error.skill.notFound",
      params: { name },
    };
  }
  const doc = parseSkillDoc(raw);
  const summary = entryOf(name, entry.kind, entry.docPath, doc);
  return {
    root: root.key,
    name,
    declaredName: summary.declaredName,
    description: summary.description,
    path: entry.docPath,
    kind: entry.kind,
    body: doc.body.trim(),
    document: raw,
    frontmatter: summary.hasFrontmatter
      ? Object.fromEntries(Object.entries(doc.map))
      : null,
    diagnostics: summary.diagnostics,
    loadable: summary.loadable,
    sourceReadOnly: !root.mutable,
  };
}

/** Select the highest-priority enabled copy; when all are disabled, emit a blocking candidate that overrides native scanning. */
export async function listProviderCandidates(options: ScopeOptions = {}) {
  const policyResult = await readManagerState();
  const candidates = [];
  const user = userRoots();
  const userScans = await scanDeduplicatedRoots(user);
  const items = user.flatMap((root) =>
    userScans.get(root.key)!.entries.map((entry) => ({ root, entry, policy: effectiveSkillPolicy(policyResult, root, entry) })),
  );
  const cwd =
    options && typeof options.cwd === "string" ? options.cwd : undefined;
  if (cwd) {
    const roots = await projectRoots([cwd]);
    for (const root of roots) {
      const scanned = (await scanDeduplicatedRoots([root])).get(root.key)!;
      for (const entry of scanned.entries) items.push({ root, entry, policy: effectiveSkillPolicy(policyResult, root, entry) });
    }
  }
  for (const group of groupLoadableSkillsByName(items).values()) {
    const { root, entry, policy } = selectSkillWinner(group);
    const project = root.scope === "project";
    const policyOnly = root.mutable;
    // A fallback copy must also override higher-priority native entries in the group, preventing the host from selecting a disabled copy again.
    const overlayRank = group.length > 1
      ? Math.min(...group.map((item) => Math.min(item.root.rank, item.entry.providerRank ?? item.root.rank))) - 1
      : undefined;
    const needsOverlay =
      !policyOnly ||
      group.length > 1 ||
      policy.override !== undefined ||
      !entry.invocationPolicyValid ||
      policyResult.writable === false;
    if (!needsOverlay) continue;
    candidates.push({
      name: entry.declaredName,
      description: entry.description,
      invocation: {
        modelInvocable: policy.modelInvocable,
        userInvocable: policy.userInvocable,
      },
      provider: "dsh-skills-manager-external",
      source: project
        ? root.kind
        : root.key === "dsh"
          ? "user-dsh"
          : `agent-${root.key}`,
      rank: overlayRank ?? (project
        ? root.rank - 1
        : root.key === "dsh"
          ? USER_DSH_POLICY_RANK
          : (entry.providerRank ?? root.rank)),
      locator: {
        rootKey: root.key,
        entryName: entry.name,
        path: entry.docPath,
        realEntryPath: entry.realEntryPath,
        realDocPath: entry.realDocPath,
      },
      resourceBase: {
        kind: "directory",
        path: entry.kind === "bundle" ? entry.realEntryPath : root.path,
      },
      path: entry.docPath,
      metadata: {
        dshSkillsManager: {
          root: root.key,
          readOnly: !root.mutable,
          sourceReadOnly: !root.mutable,
          policyOnly,
        },
      },
    });
  }
  return candidates;
}

export async function getProviderSkill(candidate: ProviderCandidate, options: ScopeOptions = {}) {
  const locator = candidate && candidate.locator;
  if (
    !locator ||
    typeof locator.path !== "string" ||
    typeof locator.rootKey !== "string" ||
    typeof locator.realEntryPath !== "string" ||
    typeof locator.realDocPath !== "string"
  )
    return undefined;
  let root = rootByKey(locator.rootKey);
  if (
    !root &&
    PROJECT_ROOT_KEY_RE.test(locator.rootKey) &&
    typeof options.cwd === "string"
  ) {
    root = (await projectRoots([options.cwd])).find(
      (item) => item.key === locator.rootKey,
    );
  }
  if (!root) return undefined;
  try {
    const entry = await resolveEntry(root, String(locator.entryName || ""));
    if (!entry || resolve(entry.docPath) !== resolve(locator.path))
      return undefined;
    if (
      pathIdentity(entry.realEntryPath) !== pathIdentity(locator.realEntryPath)
    )
      return undefined;
    if (pathIdentity(entry.realDocPath) !== pathIdentity(locator.realDocPath))
      return undefined;
    const doc = parseSkillDoc(
      await fs.readFile(entry.realDocPath || entry.docPath, "utf8"),
    );
    const summary = entryOf(locator.entryName, entry.kind, entry.docPath, doc);
    if (!summary.loadable || summary.declaredName !== candidate.name)
      return undefined;
    return {
      name: candidate.name,
      description: candidate.description,
      invocation: candidate.invocation,
      provider: candidate.provider,
      source: candidate.source,
      resourceBase: candidate.resourceBase,
      path: candidate.path,
      metadata: candidate.metadata,
      content: doc.body.trim(),
    };
  } catch {
    return undefined;
  }
}

// ── State snapshot ──────────────────────────────────────────────────────────

function canonicalSkillName(item: SkillItem) {
  return item.entry.declaredName || item.entry.name;
}

/** Deduplicate by real path, then group by declared name; the manager page and current-workspace provider share source priority. */
function groupLoadableSkillsByName<T extends SkillItem>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  // For ties, explicitly prefer project scope, then break ties by source and entry identifiers instead of caller insertion order.
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  for (const item of [...items].sort((a, b) =>
    a.root.rank - b.root.rank ||
    Number(b.root.scope === "project") - Number(a.root.scope === "project") ||
    compareText(a.root.key, b.root.key) ||
    compareText(a.entry.name, b.entry.name),
  )) {
    if (!item.entry.loadable) continue;
    const name = canonicalSkillName(item);
    const group = groups.get(name) || [];
    group.push(item);
    groups.set(name, group);
  }
  return groups;
}

// Skip only copies explicitly disabled by the manager; frontmatter channel restrictions and invalid policies still fail closed as before.
function isCopyDisabled(item: SkillItem) {
  return !item.policy.sourceEnabled || item.policy.override === false;
}
function selectSkillWinner<T extends SkillItem>(group: T[]): T {
  return group.find((item) => !isCopyDisabled(item)) || group[0];
}
function markWinners(items: ViewItem[]) {
  const winners = new Map<string, ViewItem>();
  for (const [canonicalName, group] of groupLoadableSkillsByName(items)) {
    const winner = selectSkillWinner(group);
    winners.set(canonicalName, winner);
    for (const item of group) {
      delete item.view.winner;
      delete item.view.shadowedBy;
      delete item.view.fallbackTo;
      delete item.view.enabled;
      if (isCopyDisabled(item)) {
        item.view.enabled = false;
        if (item !== winner && (winner.policy.modelInvocable || winner.policy.userInvocable)) {
          item.view.fallbackTo = { root: winner.root.key, name: winner.entry.name, scope: winner.root.scope || "user" };
        }
      } else if (item !== winner) {
        item.view.shadowedBy = { root: winner.root.key, name: winner.entry.name };
      }
    }
    if (!isCopyDisabled(winner)) winner.view.winner = true;
    winner.view.enabled = winner.policy.enabled;
    winner.view.canonicalName = canonicalName;
  }
  return winners;
}

/** Skill snapshot from DSH, common Agent, and active Session project roots. */
export async function state(options: ScopeOptions = {}) {
  const user = userRoots();
  const userScans = await scanDeduplicatedRoots(user);
  const projectWarnings: Diagnostic[] = [];
  const scoped = await projectRoots(options.projectCwds, projectWarnings);
  const policyResult = await readManagerState();
  const trash = await listTrash();
  const result = {
    roots: [] as RootView[],
    projects: [] as {root?: string; name?: string; workspaceCwds?: string[]}[],
    summary: {total: 0, enabled: 0, disabled: 0, issues: 0},
    trash,
    warnings: [
      ...(policyResult.warning ? [policyResult.warning] : []),
      ...projectWarnings,
    ],
  };
  const all: ViewItem[] = [];
  for (const root of [...scoped, ...user]) {
    const { exists, entries, truncated } =
      root.scope === "project"
        ? (await scanDeduplicatedRoots([root])).get(root.key)!
        : userScans.get(root.key)!;
    // Return writable roots to the creation form even if the project .dsh/skills directory does not exist yet; show read-only project roots only when they exist.
    if (root.scope === "project" && !exists && root.kind !== "project-dsh")
      continue;
    if (truncated)
      result.warnings.push({
        code: "warning.scan.truncated",
        params: { path: root.path },
        error: `Skill scan reached the traversal limit; some skills are not shown: ${root.path}`,
      });
    const skills: SkillView[] = [];
    for (const e of entries) {
      const policy = effectiveSkillPolicy(policyResult, root, e);
      const managerEnabled =
        policyResult.writable !== false &&
        policy.sourceEnabled &&
        policy.override !== false;
      skills.push({
        name: e.name,
        declaredName: e.declaredName,
        kind: e.kind,
        description: e.description,
        modelInvocable: e.modelInvocable,
        userInvocable: e.userInvocable,
        invocationPolicyValid: e.invocationPolicyValid,
        hasFrontmatter: e.hasFrontmatter,
        loadable: e.loadable,
        managerEnabled,
        managerOverride: policy.override === undefined ? null : policy.override,
        effectiveModelInvocable: policy.modelInvocable,
        effectiveUserInvocable: policy.userInvocable,
        diagnostics: e.diagnostics,
        path: e.docPath,
      });
      all.push({
        root,
        entry: e,
        managerEnabled,
        policy,
        view: skills[skills.length - 1],
      });
    }
    result.roots.push({
      key: root.key,
      ...(root.kind ? { kind: root.kind } : {}),
      ...(root.localeKey ? { localeKey: root.localeKey } : {}),
      path: root.path,
      label: root.label,
      mutable: root.mutable,
      toggleable: root.toggleable,
      native: root.native,
      rank: root.rank,
      scope: root.scope || "user",
      ...(root.projectRoot
        ? {
            projectRoot: root.projectRoot,
            projectName: root.projectName,
            workspaceCwds: root.workspaceCwds,
          }
        : {}),
      exists,
      truncated: truncated === true,
      enabled:
        policyResult.writable !== false &&
        (root.key === "dsh" ||
          root.kind === "project-dsh" ||
          policyResult.state.sources[root.key] !== false),
      skills,
    });
  }
  const userItems = all.filter((item) => item.root.scope !== "project");
  markWinners(userItems);
  const projectGroups = new Map<string | undefined, ViewItem[]>();
  for (const item of all.filter(
    (candidate) => candidate.root.scope === "project",
  )) {
    const group = projectGroups.get(item.root.projectRoot) || [];
    group.push(item);
    projectGroups.set(item.root.projectRoot, group);
  }
  for (const projectItems of projectGroups.values()) {
    // User-level entries participate in workspace priority decisions, but their global view is not marked as "overridden by a project."
    const userCopies = userItems.map((item) => ({
      ...item,
      view: { ...item.view },
    }));
    markWinners([...projectItems, ...userCopies]);
  }
  const seenProjects = new Set();
  for (const root of result.roots.filter((item) => item.scope === "project")) {
    if (seenProjects.has(root.projectRoot)) continue;
    seenProjects.add(root.projectRoot);
    result.projects.push({
      root: root.projectRoot,
      name: root.projectName,
      workspaceCwds: root.workspaceCwds,
    });
  }
  // Preserve the existing HTTP summary contract; the page can independently calculate mutually exclusive status counts for the current tab.
  result.summary = {
    total: all.length,
    enabled: all.filter((item) => item.view.enabled === true).length,
    disabled: all.filter((item) => item.entry.loadable && item.policy.enabled === false).length,
    issues: all.reduce((count, item) => count + item.entry.diagnostics.length + (item.view.shadowedBy ? 1 : 0), 0),
  };
  return result;
}

export { KEBAB_RE };

export type ProviderCandidate = Awaited<ReturnType<typeof listProviderCandidates>>[number];

type SourceAnalysis = ({kind: "none"} & Diagnostic) | ({kind: "single"; skillFile: string} & ImportCandidate) | {kind: "batch"; rawName: string; source: string; isDir: boolean};
type MetadataEntry = DiscoveredEntry & {name: string; providerRank?: number; policyAliases?: {rootKey: string; name: string}[]};
interface MetadataScan {exists: boolean; entries: MetadataEntry[]; truncated?: boolean}
interface TrashMetadata { id: string; name: string; deletedAt: string; root?: {key: string; scope: string; label: string; projectRoot?: string; projectName?: string; kind?: string}; entries: string[] }
