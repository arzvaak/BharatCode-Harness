// Enforce source and release-artifact boundaries so implementation stays out of lib.

import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);

let passed = 0;
let failed = 0;

async function ok(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error("✗ " + message);
  }
}

for (const path of ["../src/core.ts", "../src/readonly-discovery.ts", "../src/index.ts", "../src/client.ts"]) {
  try {
    await access(new URL(path, import.meta.url), constants.R_OK);
    await ok(true, `${path} exists as maintained source`);
  } catch {
    await ok(false, `${path} exists as maintained source`);
  }
}

for (const path of ["../lib/core.js", "../lib/readonly-discovery.js", "../lib/index.js", "../lib/client.js"]) {
  try {
    await access(new URL(path, import.meta.url), constants.R_OK);
    await ok(true, `${path} exists as generated output`);
  } catch {
    await ok(false, `${path} exists as generated output`);
  }
}

for (const path of ["../lib/core.js.map", "../lib/index.js.map", "../lib/client.js.map"]) {
  try {
    await access(new URL(path, import.meta.url), constants.F_OK);
    await ok(false, `${path} is excluded from generated output`);
  } catch {
    await ok(true, `${path} is excluded from generated output`);
  }
}

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await ok(typeof manifest.scripts?.build === "string" && manifest.scripts.build.length > 0, "package defines a build command");
await ok(manifest.scripts?.test?.includes("build-test.mjs"), "test command enforces the source-layout contract");
await ok(manifest.engines?.node === "^22.19.0 || >=24.0.0", "package uses the shared Node LTS baseline");
await ok(manifest.packageManager === "pnpm@11.28.5", "package pins the shared pnpm version");

await ok(manifest.scripts?.typecheck === "tsc --noEmit", "type checking is an independent gate");
await ok(manifest.scripts?.test?.includes("typecheck"), "full test command runs type checking first");
const typeConfig = JSON.parse(await readFile(new URL("../tsconfig.json", import.meta.url), "utf8").then(text => text.replace(/^\uFEFF/, "")));
await ok(typeConfig.compilerOptions?.strict === true && typeConfig.compilerOptions?.noEmit === true, "transpilation builds cannot replace strict type checking");
await ok(typeConfig.compilerOptions?.erasableSyntaxOnly === true, "source uses TypeScript syntax erasable by Node");
await ok(!(await readdir(new URL("../src/", import.meta.url))).some(name => name.endsWith(".js")), "maintained source contains no unchecked JavaScript modules");

const projectRoot = new URL("../", import.meta.url);
const ignoreRules = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
const ignoresLib = ignoreRules.split(/\r?\n/u).some((line) => line === "lib" || line === "lib/" || line === "/lib/");
await ok(manifest.scripts?.prepare === undefined && !ignoresLib, "GitHub installs do not depend on a blocked build script");
await ok(manifest.scripts?.prepack === "npm run typecheck && npm run build", "types are checked and artifacts generated automatically before packing");
await ok(!manifest.scripts?.verify?.includes("check-generated.mjs"), "release verification no longer requires generated artifacts to be committed");
await ok(manifest.scripts?.verify?.includes("pack-test.mjs"), "release verification covers packing from a clean directory without artifacts");
const generatedCore = new URL("../lib/core.js", import.meta.url);
const beforeFailureHash = createHash("sha256").update(await readFile(generatedCore)).digest("hex");
try {
  await run(process.execPath, ["scripts/build.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, DSH_SKILLS_MANAGER_TEST_FAIL_BEFORE_PUBLISH: "1" },
  });
  await ok(false, "a failed publish keeps the previous lib output");
} catch {
  const afterFailureHash = createHash("sha256").update(await readFile(generatedCore)).digest("hex");
  await ok(afterFailureHash === beforeFailureHash, "a failed publish keeps the previous lib output");
}
const temporaryBuildDirectories = (await readdir(projectRoot)).filter((name) => name.startsWith(".dsh-skills-manager-build-"));
await ok(temporaryBuildDirectories.length === 0, "failed builds clean temporary output directories");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
