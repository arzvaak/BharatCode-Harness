import { readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const pnpmManifest = join(root, "node_modules/pnpm/package.json");
const pnpmBin = join(
  dirname(pnpmManifest),
  JSON.parse(readFileSync(pnpmManifest)).bin.pnpm,
);
const core = JSON.parse(readFileSync(join(root, "integrations/core.json")));
const mode = process.argv[2] ?? "build";
let failed = 0;
for (const row of core.packages) {
  const directory = join(root, row.directory);
  const manifest = JSON.parse(readFileSync(join(directory, "package.json")));
  if ((mode === "build" || mode === "test") && manifest.scripts?.[mode]) {
    const result = spawnSync(
      process.execPath,
      [pnpmBin, "--dir", directory, "run", mode],
      {
        stdio: "inherit",
      },
    );
    if (result.status !== 0) {
      if (mode === "test") failed++;
      else process.exit(result.status ?? 1);
    }
  } else if (mode === "pack") {
    const destination = join(root, "dist/extensions");
    mkdirSync(destination, { recursive: true });
    const result = spawnSync(
      process.execPath,
      [
        pnpmBin,
        "--dir",
        directory,
        "pack",
        "--config.ignore-scripts=true",
        "--pack-destination",
        destination,
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (failed) process.exit(1);
