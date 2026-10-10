/** Source-bound local qualification required by Linux preview publishers. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const LOCAL_LINUX_GATES = [
  'immutable-install', 'build', 'typecheck', 'lint', 'documentation', 'profile', 'unit',
  'core-build', 'core-tests', 'store-tests', 'native-graphics', 'managed-runtime',
  'core-profile', 'packed-core', 'browser', 'appimage', 'appimage-ui',
];

/** Read the clean checkout identity; unpublished changes cannot qualify a release. */
export function localSource(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git(['status', '--porcelain'])) throw Error('Local release gates require a clean checkout');
  return git(['rev-parse', 'HEAD']);
}

/** Record exact release bytes, independently of their generated metadata. */
export function localArtifact(path, root) {
  const bytes = readFileSync(resolve(root, path));
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Reject incomplete, stale or modified local release evidence. */
export function validateLocalRelease(report, commit, artifactReader) {
  if (report?.schemaVersion !== 1 || report.execution !== 'local' || report.platform !== 'linux'
    || report.arch !== 'x64' || report.commit !== commit || report.result !== 'passed')
    throw Error('Local Linux release qualification is missing or stale');
  for (const gate of LOCAL_LINUX_GATES) {
    const rows = report.gates?.filter(row => row.id === gate);
    if (rows?.length !== 1 || rows[0].exitCode !== 0) throw Error(`Local gate did not pass: ${gate}`);
  }
  if (!Array.isArray(report.artifacts) || !report.artifacts.length) throw Error('Local artifacts missing');
  for (const artifact of report.artifacts) {
    if (typeof artifact.path !== 'string' || artifact.path.startsWith('/')
      || artifact.path.split('/').some(part => part === '..')) throw Error('Invalid local artifact path');
    const actual = artifactReader(artifact.path);
    if (actual.bytes !== artifact.bytes || actual.sha256 !== artifact.sha256)
      throw Error(`Locally qualified artifact changed: ${artifact.path}`);
  }
  return report;
}

/** Load and verify the current checkout's completed local qualification. */
export function requireLocalRelease(root) {
  const report = JSON.parse(readFileSync(resolve(root, 'dist/local-linux-release/receipt.json'), 'utf8'));
  validateLocalRelease(report, localSource(root), path => localArtifact(path, root));
  const paths = new Set(report.artifacts.map(row => row.path));
  const inventoryPath = 'dist/packed-core/inventory.json';
  const runtimePath = 'dist/managed-dependencies/qualification-linux.json';
  const desktop = 'apps/desktop/.desktop-build/targets/linux-x64/artifacts';
  for (const path of [inventoryPath, runtimePath, `${desktop}/linux-preview-build.json`])
    if (!paths.has(path)) throw Error(`Local qualification artifact missing: ${path}`);
  const inventory = JSON.parse(readFileSync(resolve(root, inventoryPath)));
  for (const asset of inventory.assets)
    if (!paths.has(`dist/packed-core/${asset.name}`)) throw Error('Locally qualified core archive missing');
  const runtime = JSON.parse(readFileSync(resolve(root, runtimePath)));
  if (!paths.has(`dist/managed-dependencies/${runtime.artifact.assetName}`)) throw Error('Locally qualified managed archive missing');
  const metadata = JSON.parse(readFileSync(resolve(root, desktop, 'linux-preview-build.json')));
  if (metadata.commit !== report.commit || metadata.dirty !== false
    || !paths.has(`${desktop}/bharatcode-${metadata.version}-linux-x86_64.AppImage`))
    throw Error('Locally qualified AppImage identity differs');
  return report;
}
