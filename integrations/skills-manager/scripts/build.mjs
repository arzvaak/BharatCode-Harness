// Generate the publishable lib from src in one place; runtime artifacts should not become a manually maintained source.
// Build both targets in a sibling staging directory before replacing the output, so failures do not damage the installable artifacts.

import { access, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { build } from "esbuild";

const outputDirectory = resolve("lib");
const stagingDirectory = resolve(`.dsh-skills-manager-build-${randomUUID()}`);
const backupDirectory = resolve(`.dsh-skills-manager-build-backup-${randomUUID()}`);
let previousOutputMoved = false;
let published = false;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

try {
  await build({
    entryPoints: ["src/starter-skills.ts", "src/core.ts", "src/readonly-discovery.ts", "src/index.ts", "src/plugin-updater.ts", "src/repositories.ts", "src/repository-updates.ts"],
    outdir: stagingDirectory,
    outbase: "src",
    bundle: false,
    format: "esm",
    platform: "node",
    target: "node20",
  });

  await build({
    entryPoints: ["src/client.ts"],
    outfile: join(stagingDirectory, "client.js"),
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2022",
    external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
    minify: true,
    define: { "process.env.NODE_ENV": "\"production\"" },
    banner: {
      js: "window.__ModuleLoader__.load({ id: \"@michengai/dsh-skills-manager\", factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;",
    },
    footer: { js: "return module.exports;\n} });" },
  });

  if (process.env.DSH_SKILLS_MANAGER_TEST_FAIL_BEFORE_PUBLISH === "1") {
    throw new Error("Test: interrupt before publishing build artifacts");
  }

  if (await exists(outputDirectory)) {
    await rename(outputDirectory, backupDirectory);
    previousOutputMoved = true;
  }

  try {
    await rename(stagingDirectory, outputDirectory);
    published = true;
  } catch (error) {
    if (previousOutputMoved) await rename(backupDirectory, outputDirectory);
    throw error;
  }

  if (published && previousOutputMoved) await rm(backupDirectory, { recursive: true, force: true });
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
  if (published && previousOutputMoved && (await exists(backupDirectory))) {
    await rm(backupDirectory, { recursive: true, force: true });
  }
}

console.log("[dsh-skills-manager] Generated Host and client release artifacts from src");
