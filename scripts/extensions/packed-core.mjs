import {
  globSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { validateArchive } from "../../integrations/extension-store/src/archive.js";
const qualificationToken = process.env.BC_QUALIFICATION_GITHUB_TOKEN;
delete process.env.BC_QUALIFICATION_GITHUB_TOKEN;
const root = resolve(import.meta.dirname, "../..");
const pnpmManifest = join(root, "node_modules/pnpm/package.json");
const pnpmBin = join(
  dirname(pnpmManifest),
  JSON.parse(readFileSync(pnpmManifest)).bin.pnpm,
);
const rows = JSON.parse(
  readFileSync(join(root, "integrations/core.json")),
).packages;
const all = new Map();
for (const p of [
  ...globSync(
    [
      "packages/*/*/package.json",
      "apps/*/package.json",
      "vendor/*/package.json",
      "native/system/package.json",
      "native/system/packages/*/package.json",
    ],
    { cwd: root },
  ),
  ...rows.map((r) => `${r.directory}/package.json`),
  "integrations/ci-pipelines/package.json",
]) {
  const file = join(root, p);
  const manifest = JSON.parse(readFileSync(file));
  all.set(manifest.name, { directory: dirname(file), manifest });
}
const selected = new Map();
function visit(name) {
  if (selected.has(name) || !all.has(name)) return;
  const row = all.get(name);
  selected.set(name, row);
  for (const dep of Object.keys({
    ...row.manifest.dependencies,
    ...row.manifest.peerDependencies,
  }))
    visit(dep);
}
visit("@deepseek-ai/dsh");
for (const r of rows) visit(r.packageName);
visit("@bharatcode/ci-pipelines");
const destination = join(root, "dist/packed-core");
mkdirSync(destination, { recursive: true });
const dependencies = {},
  assets = [];
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0)
    throw Error(`Qualification command failed (${result.status})`);
}
for (const [name, { directory, manifest }] of selected) {
  if (!process.argv.includes("--reuse"))
    run(process.execPath, [
      pnpmBin,
      "--dir",
      directory,
      "pack",
      "--config.ignore-scripts=true",
      "--pack-destination",
      destination,
    ]);
  const filename = `${name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
  const path = join(destination, filename);
  const bytes = readFileSync(path);
  validateArchive(bytes, { packageName: name, version: manifest.version });
  dependencies[name] = pathToFileURL(path).href;
  assets.push({
    name: filename,
    packageName: name,
    version: manifest.version,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    license: manifest.license ?? "UNRESOLVED",
  });
}
writeFileSync(
  join(destination, "inventory.json"),
  JSON.stringify(
    { schemaVersion: 1, platform: process.platform, assets },
    null,
    2,
  ),
);
const consumer = mkdtempSync(join(tmpdir(), "bc-packed-core-"));
try {
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "bc-packed-core-qualification",
      version: "0.0.0",
      private: true,
      dependencies,
    }),
  );
  const env = {
    ...process.env,
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  const npm =
    process.platform === "win32"
      ? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
      : resolve(
          dirname(process.execPath),
          "../lib/node_modules/npm/bin/npm-cli.js",
        );
  if (process.platform === "win32")
    run(
      process.execPath,
      [npm, "install", "--ignore-scripts", "--package-lock=false"],
      {
        cwd: consumer,
        env,
      },
    );
  else
    run("npm", ["install", "--ignore-scripts", "--package-lock=false"], {
      cwd: consumer,
      env,
    });
  run(
    process.execPath,
    [
      join(root, "scripts/extensions/verify-core.mjs"),
      join(consumer, "node_modules/@deepseek-ai/dsh/lib/bin.js"),
    ],
    { cwd: consumer, env },
  );
  writeFileSync(
    join(consumer, "pipeline-fixture.mjs"),
    `
    import assert from 'node:assert/strict';
    import * as extension from '@bharatcode/ci-pipelines';
    const tools = [], listeners = new Map();
    extension.apply({tools: {register(tool) {tools.push(tool)}}, credentials: {}, on(event, listener) {listeners.set(event, listener)}}, extension.Config({}));
    assert.equal(tools.length, 5);
    assert.equal((await listeners.get('tools/pre-execute')({name: 'pipeline_rerun'}, () => {throw Error('Unsafe continuation')})).kind, 'deny');
    console.log('Packed optional pipeline export/registration/default-denial fixture passed; no account workflow claimed.');
  `,
  );
  run(process.execPath, [join(consumer, "pipeline-fixture.mjs")], {
    cwd: consumer,
    env,
  });
  if (qualificationToken || process.argv.includes('--github-account')) run(process.execPath, [join(root, 'scripts/extensions/packed-pipeline-readonly.mjs'), consumer, ...(!qualificationToken ? ['--use-gh-session'] : [])], {
    cwd: consumer, env: { ...env, BC_QUALIFICATION_GITHUB_TOKEN: qualificationToken },
  });
  else console.log('Packed GitHub account evidence not requested; registration fixtures do not qualify account workflows.');
  console.log(
    `Packed-install fixture passed: ${selected.size} independent archives on native ${process.platform}. Full extension lifecycle and additional accounts/platforms remain unqualified.`,
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
