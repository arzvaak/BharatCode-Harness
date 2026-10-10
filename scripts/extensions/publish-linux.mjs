/** Publish only the exact Linux packages and updater feed admitted by completed local gates. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireLocalRelease } from './local-release.mjs';

const root = resolve(import.meta.dirname, '../..');
const report = requireLocalRelease(root);
const artifact = report.artifacts.find(row => row.path.endsWith('.AppImage'));
if (!artifact || report.artifacts.filter(row => row.path.endsWith('.AppImage')).length !== 1)
  throw Error('Exactly one locally qualified AppImage required');
const directory = resolve(root, artifact.path, '..');
const metadata = JSON.parse(readFileSync(join(directory, 'linux-preview-build.json')));
if (metadata.commit !== report.commit || metadata.dirty !== false) throw Error('AppImage source identity differs');
const repository = 'arzvaak/BharatCode-Extensions';
const tag = `v${metadata.version}`;
const receiptPath = join(root, 'dist/local-linux-release/receipt.json');
const packages = report.artifacts.filter(row => /\.(AppImage|deb|rpm)$/u.test(row.path));
writeFileSync(join(directory, 'SHA256SUMS'), packages.map(row => `${row.sha256}  ${row.path.split('/').at(-1)}`).join('\n') + '\n');
const { run: _run, ...publicMetadata } = metadata;
writeFileSync(join(directory, 'release-build.json'), JSON.stringify(publicMetadata, null, 2) + '\n');
const notes = join(directory, 'RELEASE.md');
writeFileSync(notes, 'BharatCode Linux x64 preview. All local release gates passed for this clean source revision and exact AppImage, Fedora RPM, and Debian DEB: build, typecheck, lint, documentation, complete unit suite, core packages, native graphics, managed runtime, packed installation, browser interactions, production runtime and sandboxed AppImage onboarding/restart, native package metadata, real updater checksum rejection and replacement, and marketing browser interactions. The local receipt is included. Check for updates in the Application menu, download the verified update, then confirm restart. Native package updates may require system authorization. Older manual-update AppImages require this installer once before future in-app updates. Account-dependent workflows, Windows and ARM64 are outside this preview scope.\n');
execFileSync('gh', ['release', 'create', tag, ...report.artifacts.filter(row => (/\.(AppImage|deb|rpm|blockmap)$/u.test(row.path) || row.path.endsWith('/rc-linux.yml'))).map(row => resolve(root, row.path)), join(directory, 'release-build.json'),
  join(directory, 'SHA256SUMS'), receiptPath, '--repo', repository, '--prerelease', '--title',
  `BharatCode Linux preview ${metadata.version}`, '--notes-file', notes], { stdio: 'inherit' });
