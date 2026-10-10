// Repository-mutating lint fixtures must settle before source scanners run.
// Both invocations preserve the inherited environment and include every unit test.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const runner = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
for (const args of [
  ["run", "scripts/oxlint-contract.spec.ts"],
  ["run", "--exclude", "scripts/oxlint-contract.spec.ts"],
]) {
  const result = spawnSync(process.execPath, [runner, ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DSH_UNIT_SOURCE_SCANNERS: args.includes("--exclude") ? "1" : "0" },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
