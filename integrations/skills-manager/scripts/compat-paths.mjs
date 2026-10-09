import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

function identity(path) {
  const canonical = resolve(path);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

/** Resolve 8.3 short paths before comparing, so Windows CI temp paths match the session cwd after realpath. */
export async function sameExistingPath(left, right) {
  try {
    return identity(await realpath(left)) === identity(await realpath(right));
  } catch {
    return identity(left) === identity(right);
  }
}

export async function resolveTempRoot(path) {
  return realpath(path);
}
