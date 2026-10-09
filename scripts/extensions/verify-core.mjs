import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "../..");
const bin = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, "apps/cli/lib/bin.js");
const core = JSON.parse(await readFile(join(root, "integrations/core.json")));
const home = await mkdtemp(join(tmpdir(), "bc-core-qualification-"));
let output = "";
let exited = false;
const startedAt = performance.now();
const child = spawn(
  process.execPath,
  [
    bin,
    "--profile",
    "qualification",
    "--from-default-profile",
    "web",
    "--no-open",
    "--port",
    "0",
  ],
  {
    cwd: home,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      DSH_HOME: join(home, ".dsh"),
      DSH_AGENTS_HOME: join(home, ".agents"),
      DSH_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
child.once("exit", () => (exited = true));
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
try {
  let address, launchUrl;
  for (let i = 0; i < 600; i++) {
    launchUrl = output.match(
      /dsh web: (http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/,
    )?.[1];
    address = launchUrl && new URL(launchUrl).origin;
    if (address || exited) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!address)
    console.error(output.replace(/([?&]token=)[^\s]+/g, "$1[redacted]"));
  assert.ok(address, "Owned profile did not start");
  const unauthenticated = await fetch(`${address}/api/bc-extension-store`, {
    headers: { Origin: address, Cookie: "dsh-auth-forged=arbitrary" },
  });
  assert.equal(unauthenticated.status, 401, "Forged local request admitted");
  const skillsDenied = await fetch(`${address}/api/dsh-skills-manager/state`, { headers: { Origin: address, Cookie: "dsh-auth-forged=arbitrary" } });
  assert.equal(skillsDenied.status, 401, "Unauthenticated skills request admitted");
  const exchange = await fetch(launchUrl, { redirect: "manual" });
  const cookie = exchange.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Native authentication exchange failed");
  const skills = await fetch(`${address}/api/dsh-skills-manager/state`, { headers: { Origin: address, Cookie: cookie }, signal: AbortSignal.timeout(10000) });
  assert.equal(skills.status, 200, "Authenticated skills endpoint unavailable");
  const response = await fetch(`${address}/api/bc-extension-store`, {
    headers: { Origin: address, Cookie: cookie },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, "Core store endpoint unavailable");
  const view = await response.json();
  if (process.env.BC_MEASURE_CORE === "1") {
    const bootMs = performance.now() - startedAt;
    await new Promise((r) => setTimeout(r, 5000));
    let hostRssBytes = null;
    if (process.platform === "linux") {
      const status = await readFile(`/proc/${child.pid}/status`, "utf8");
      hostRssBytes = Number(status.match(/^VmRSS:\s+(\d+) kB/m)?.[1]) * 1024;
    }
    console.log(JSON.stringify({ platform: process.platform, fixture: "fresh-owned-profile", bootMs, hostRssBytes, idleObservationMs: 5000, optionalRuntimes: view.running.length, catalogBytes: Buffer.byteLength(JSON.stringify(view.catalog)), baselineComparison: null, limitation: "Host process only; renderer memory and cold/warm OS cache effects are not measured. Baseline source required compile repairs; no comparable baseline run recorded." }));
  }
  assert.equal(view.running.length, 0, "Optional runtimes started at boot");
  assert.equal(view.installed.length, 0);
  for (const name of core.defaultOn) {
    const bundle = view.bundles.find((b) => b.name === name);
    assert.ok(bundle, `Missing core bundle ${name}`);
    assert.equal(bundle.enabled, true, `${name} disabled`);
    assert.ok(!bundle.error, `${name} failed activation`);
  }
  assert.ok(view.catalog.entries.length >= 56);
  assert.ok(
    !/failed to (?:load|import)|plugin error|unknown service|peer version gate/i.test(
      output,
    ),
    "Boot reported activation errors",
  );
  console.log(
    `Native ${process.platform} profile: ${core.defaultOn.length} enabled core bundles; ${view.catalog.entries.length} catalog entries; zero optional runtimes.`,
  );
} finally {
  if (!exited) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      child.once("exit", r);
      setTimeout(() => {
        child.kill("SIGKILL");
        r();
      }, 3000).unref();
    });
  }
  await rm(home, { recursive: true, force: true });
}
