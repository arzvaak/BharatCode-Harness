/** Execute the Linux release checks locally and retain source-bound evidence. */
import { readFileSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOCAL_LINUX_GATES, localSource, localArtifact } from './local-release.mjs';

const root = resolve(import.meta.dirname, '../..');
if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Use a native Linux x64 release host');
const commit = localSource(root);
const destination = join(root, 'dist/local-linux-release');
mkdirSync(destination, { recursive: true });
rmSync(join(destination, 'receipt.json'), { force: true });
const pnpm = join(root, 'node_modules/pnpm/bin/pnpm.cjs');
const node = args => [process.execPath, args];
const run = args => node([pnpm, ...args]);
const testFiles = ['integrations/extension-store/tests', 'integrations/ci-pipelines/tests']
  .flatMap(directory => readdirSync(join(root, directory)).filter(name => name.endsWith('.test.js')).map(name => `${directory}/${name}`));
const commands = [
  run(['install', '--frozen-lockfile', '--ignore-scripts']),
  run(['run', 'build']), run(['run', 'typecheck']), run(['run', 'lint']), run(['run', 'doc-sync']),
  ['bash', ['scripts/gates/verify-config.sh']], run(['run', 'test']),
  node(['scripts/extensions/core.mjs', 'build']), node(['scripts/extensions/core.mjs', 'test']),
  node(['--test', ...testFiles, 'scripts/extensions/local-release.test.mjs']),
  ['xvfb-run', ['-a', process.execPath, 'integrations/visuals/scripts/native-export.mjs']],
  node(['scripts/extensions/qualify-managed.mjs']), node(['scripts/extensions/verify-core.mjs']),
  node(['scripts/extensions/packed-core.mjs']),
  run(['run', 'test:web:built', 'apps/web/tests/independent-chats.e2e.ts', 'apps/web/tests/research-new-chat.e2e.ts', 'apps/web/tests/sidebar-scrollbar.e2e.ts', 'apps/web/tests/sidebar-title-hover-scroll.e2e.ts', 'apps/web/tests/sidebar-right.e2e.ts', 'apps/web/tests/document-preview.e2e.ts']),
  run(['--dir', 'apps/desktop', 'run', 'package:linux:x64']),
  ['xvfb-run', ['-a', process.execPath, 'scripts/extensions/smoke-linux-appimage.mjs']],
  node(['scripts/extensions/verify-linux-artifacts.mjs']),
  node(['scripts/extensions/qualify-linux-native-packages.mjs']),
  ['xvfb-run', ['-a', process.execPath, 'apps/desktop/scripts/test-linux-updater.mjs']],
  node(['scripts/extensions/test-marketing-site.mjs']),
];
const env = { ...process.env, DSH_TELEMETRY_DISABLED: '1', DSH_SNAPSHOT: 'replay' };
for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'BC_QUALIFICATION_GITHUB_TOKEN']) delete env[key];
const gates = [];
for (const [index, [command, args]] of commands.entries()) {
  const id = LOCAL_LINUX_GATES[index];
  console.log(`Local Linux release: ${id}`);
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  gates.push({ id, startedAt, finishedAt: new Date().toISOString(), exitCode: result.status });
  writeFileSync(join(destination, 'progress.json'), JSON.stringify({ commit, gates }, null, 2) + '\n');
  if (result.error || result.status !== 0) throw Error(`Local release gate failed: ${id}`, { cause: result.error });
}
if (localSource(root) !== commit) throw Error('Source changed during local release qualification');
const inventoryPath = 'dist/packed-core/inventory.json';
const inventory = JSON.parse(readFileSync(join(root, inventoryPath)));
const reportPath = 'dist/managed-dependencies/qualification-linux.json';
const runtime = JSON.parse(readFileSync(join(root, reportPath)));
const desktop = 'apps/desktop/.desktop-build/targets/linux-x64/artifacts';
const metadata = JSON.parse(readFileSync(join(root, desktop, 'linux-preview-build.json')));
if (metadata.commit !== commit || metadata.dirty !== false) throw Error('AppImage build identity differs from tested source');
const files = [inventoryPath, ...inventory.assets.map(asset => `dist/packed-core/${asset.name}`), reportPath,
  `dist/managed-dependencies/${runtime.artifact.assetName}`, `${desktop}/linux-preview-build.json`,
  ...readdirSync(join(root, desktop)).filter(name => (/\.(AppImage|deb|rpm|blockmap)$/u.test(name) || name === 'rc-linux.yml')).map(name => `${desktop}/${name}`),
  'apps/desktop/.desktop-build/qualification/native-packages.json', 'apps/desktop/.desktop-build/qualification/linux-updater.json', 'dist/marketing-qualification/result.json'];
if (!files.some(name => name.endsWith('.AppImage'))) throw Error('Qualified AppImage missing');
const report = { schemaVersion: 1, execution: 'local', platform: 'linux', arch: 'x64', commit,
  result: 'passed', completedAt: new Date().toISOString(), gates, artifacts: files.map(path => localArtifact(path, root)) };
writeFileSync(join(destination, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
console.log('All local Linux release gates passed; receipt: dist/local-linux-release/receipt.json');
