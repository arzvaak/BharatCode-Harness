import type { CodedError } from "./types.js";
import type { DiscoveredEntry } from "./types.js";
// Discover skills in read-only directories: allow directory links, filter hidden directories by discovered path, and detect cycles using real ancestor paths.
import { promises as fs } from "node:fs";
import { resolve, join, relative, sep, dirname } from "node:path";

const MAX_DEPTH = 6;
const MAX_DIRECTORIES = 2000;
const MAX_ENTRIES = 20000;
const identity = (path: string) =>
  process.platform === "win32" ? path.toLowerCase() : path;

// Windows realpath expands short 8.3 names. That spelling change is not a
// distribution link; ownership must follow actual links within this source.
async function linkedWithinRoot(path: string, root: string) {
  let current = resolve(path);
  for (;;) {
    if ((await fs.lstat(current)).isSymbolicLink()) return true;
    if (identity(current) === identity(root)) return false;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** Read-only entries use paths relative to the root; a dot represents the root SKILL.md, and traversal paths are rejected. */
export function validDiscoveryName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    (name === "." ||
      (name.length <= 1024 &&
        name
          .split("/")
          .every(
            (part) =>
              part.length > 0 &&
              part.length <= 255 &&
              !part.startsWith(".") &&
              !/[\\:*?"<>|\0]/.test(part) &&
              !/[. ]$/.test(part) &&
              !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part),
          )))
  );
}

/** Return file locations only, without reading contents, so lists, details, and policies share discovery and deduplication rules. */
export async function discoverReadonlyEntries(root: string) {
  const rootPath = resolve(root);
  const queue = [{ path: rootPath, depth: 0, ancestors: new Set<string>() }];
  const byName = new Map<string, DiscoveredEntry & {name: string}>();
  let directories = 0;
  let entries = 0;
  let exists = false;
  let truncated = false;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (directories >= MAX_DIRECTORIES || entries >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const current = queue[cursor];
    let realDirectory;
    const items = [];
    try {
      realDirectory = await fs.realpath(current.path);
      const key = identity(realDirectory);
      if (current.ancestors.has(key)) continue;
      // Treat regular bundles as leaves before enumeration so resource files cannot exhaust the root-wide budget.
      // The root SKILL.md can coexist with other skills, so continue discovering the root directory.
      if (current.depth > 0) {
        const docPath = join(current.path, "SKILL.md");
        let docStat;
        try {
          docStat = await fs.lstat(docPath);
        } catch (caught) { const error = caught as CodedError;
          if (error.code !== "ENOENT") throw error;
        }
        if (docStat?.isFile() && !docStat.isSymbolicLink()) {
          const name = relative(rootPath, current.path).split(sep).join("/");
          const realDocPath = await fs.realpath(docPath);
          directories++;
          byName.set(name, {
            name,
            kind: "bundle",
            docPath,
            entryPath: current.path,
            realDocPath,
            realEntryPath: realDirectory,
            linked: await linkedWithinRoot(current.path, rootPath),
          });
          continue;
        }
      }
      const directory = await fs.opendir(current.path);
      if (current.depth === 0) exists = true;
      directories++;
      for await (const item of directory) {
        if (entries >= MAX_ENTRIES) {
          truncated = true;
          break;
        }
        entries++;
        items.push(item);
      }
    } catch {
      continue;
    } // Broken links and unreadable directories do not block other sources.
    items.sort((a, b) => a.name.localeCompare(b.name));
    const ancestors = new Set(current.ancestors).add(identity(realDirectory));
    for (const item of items) {
      const path = join(current.path, item.name);
      const name = relative(rootPath, path).split(sep).join("/");
      if (!validDiscoveryName(name)) continue;
      try {
        const stat = await fs.lstat(path);
        if (stat.isDirectory() || stat.isSymbolicLink()) {
          if (identity(item.name) === "node_modules") continue;
          if (stat.isSymbolicLink() && !(await fs.stat(path)).isDirectory())
            continue;
          if (current.depth >= MAX_DEPTH) {
            truncated = true;
            continue;
          }
          // Bound the pending traversal queue too, preventing wide directories from using unbounded memory.
          if (queue.length >= MAX_DIRECTORIES) {
            truncated = true;
            continue;
          }
          queue.push({ path, depth: current.depth + 1, ancestors });
          continue;
        }
        if (!stat.isFile()) continue;
        const bundle = item.name === "SKILL.md";
        // Preserve support for existing top-level single-file skills; do not treat nested READMEs or reference documents as skills.
        const flat =
          current.depth === 0 &&
          item.name.toLowerCase().endsWith(".md") &&
          item.name.toLowerCase() !== "skill.md";
        if (!bundle && !flat) continue;
        const entryName = bundle
          ? relative(rootPath, current.path).split(sep).join("/") || "."
          : item.name.slice(0, -3);
        if (!validDiscoveryName(entryName)) continue;
        const realDocPath = await fs.realpath(path);
        const entryPath = bundle ? current.path : path;
        const realEntryPath = bundle ? realDirectory : realDocPath;
        if (!bundle && byName.has(entryName)) continue;
        byName.set(entryName, {
          name: entryName,
          kind: bundle ? "bundle" : "flat",
          docPath: path,
          entryPath,
          realDocPath,
          realEntryPath,
          linked: await linkedWithinRoot(entryPath, rootPath),
        });
      } catch {
        /* Skip sources that become unavailable during scanning; revalidate real paths before loading. */
      }
    }
  }
  return {
    exists,
    entries: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    truncated,
  };
}
