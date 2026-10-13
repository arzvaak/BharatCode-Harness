/** Assemble Pages content from locally qualified release assets; no hosted build is needed. */
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { requireLocalRelease } from './local-release.mjs';
const root = resolve(import.meta.dirname, '../..');
const report = requireLocalRelease(root);
const metadata = JSON.parse(readFileSync(join(root, 'apps/desktop/.desktop-build/targets/linux-x64/artifacts/linux-preview-build.json')));
const tag = `v${metadata.version}`;
const packages = {};
for (const kind of ['AppImage', 'deb', 'rpm']) {
  const rows = report.artifacts.filter(row => row.path.endsWith(`.${kind}`));
  if (rows.length !== 1) throw Error(`Exactly one qualified ${kind} required`);
  const asset = rows[0]; const name = asset.path.split('/').at(-1);
  packages[kind] = { name, url: `https://github.com/arzvaak/BharatCode-Harness/releases/download/${tag}/${name}`, sha256: asset.sha256, bytes: asset.bytes };
}
const windowsDirectory = join(root, 'apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts');
const windowsReport = join(windowsDirectory, 'windows-qualification.json');
if (existsSync(windowsReport)) {
  const qualification = JSON.parse(readFileSync(windowsReport));
  if (qualification.result === 'passed' && qualification.commit === report.commit && qualification.version === metadata.version) {
    const installers = qualification.assets.filter(asset => asset.name.endsWith('.exe'));
    if (installers.length !== 1) throw Error('Exactly one qualified Windows installer required');
    const asset = installers[0]; const bytes = readFileSync(join(windowsDirectory, asset.name));
    if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw Error('Windows installer differs from qualification');
    packages.exe = { ...asset, url: `https://github.com/arzvaak/BharatCode-Harness/releases/download/${tag}/${asset.name}` };
  }
}
const destination = join(root, 'dist/marketing-site');
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(join(root, 'integrations/extension-store/site'), destination, { recursive: true });
writeFileSync(join(destination, 'release.json'), JSON.stringify({ version: metadata.version, commit: report.commit,
  url: `https://github.com/arzvaak/BharatCode-Harness/releases/tag/${tag}`, packages }, null, 2) + '\n');
console.log(`Locally built Pages content: ${destination}`);
