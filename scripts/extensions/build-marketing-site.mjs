/** Assemble Pages content from locally qualified release assets; no hosted build is needed. */
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  packages[kind] = { name, url: `https://github.com/arzvaak/BharatCode-Extensions/releases/download/${tag}/${name}`, sha256: asset.sha256, bytes: asset.bytes };
}
const destination = join(root, 'dist/marketing-site');
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(join(root, 'integrations/extension-store/site'), destination, { recursive: true });
writeFileSync(join(destination, 'release.json'), JSON.stringify({ version: metadata.version, commit: report.commit,
  url: `https://github.com/arzvaak/BharatCode-Extensions/releases/tag/${tag}`, packages }, null, 2) + '\n');
console.log(`Locally built Pages content: ${destination}`);
