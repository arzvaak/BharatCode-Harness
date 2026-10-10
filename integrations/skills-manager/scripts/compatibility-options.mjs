// Parse options independently so invalid usage cannot trigger installation or sandbox creation.
import { supportedHosts } from "./hosts.mjs";
export const usage = "Usage: node scripts/test-host-compatibility.mjs [version | --all] [--keep] [--serve] | --list | --help\nOmit the version to run all; --serve requires exactly one version; flags may appear before or after the version.";
export function parseOptions(args) {
  const flags = new Set();
  const versions = [];
  for (const arg of args) {
    if (arg.startsWith("--")) {
      if (!["--all", "--keep", "--serve", "--list", "--help"].includes(arg)) throw new Error(`Unknown flag: ${arg}`);
      flags.add(arg);
    } else versions.push(arg);
  }
  if (versions.length > 1 || (versions.length && flags.has("--all"))) throw new Error("Specify at most one version and do not combine it with --all");
  if (versions.length && !supportedHosts.includes(versions[0])) throw new Error(`Unsupported version: ${versions[0]}`);
  if ((flags.has("--list") || flags.has("--help")) && (flags.size > 1 || versions.length)) throw new Error("--list/--help must be used alone");
  if (flags.has("--serve") && versions.length !== 1) throw new Error("--serve requires exactly one explicitly specified version");
  return { versions: versions.length ? versions : [...supportedHosts], keep: flags.has("--keep"), serve: flags.has("--serve"), list: flags.has("--list"), help: flags.has("--help") };
}
