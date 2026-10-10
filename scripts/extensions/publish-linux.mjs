/** Publish only the exact Linux AppImage admitted by completed local gates. */
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
const tag = `bharatcode-linux-preview-${metadata.version}-${report.commit.slice(0, 8)}`;
const receiptPath = join(root, 'dist/local-linux-release/receipt.json');
writeFileSync(join(directory, 'SHA256SUMS'), `${artifact.sha256}  ${artifact.path.split('/').at(-1)}\n`);
const { run: _run, ...publicMetadata } = metadata;
writeFileSync(join(directory, 'release-build.json'), JSON.stringify(publicMetadata, null, 2) + '\n');
const notes = join(directory, 'RELEASE.md');
writeFileSync(notes, 'BharatCode Linux x64 preview. All local release gates passed for this clean source revision and exact AppImage: build, typecheck, lint, documentation, complete unit suite, core packages, native graphics, managed runtime, packed installation, browser interactions, production runtime and sandboxed AppImage onboarding/restart. The local receipt is included. Updates are manual. Paid-account workflows, Windows and ARM64 are outside this preview scope.\n');
execFileSync('gh', ['release', 'create', tag, resolve(root, artifact.path), join(directory, 'release-build.json'),
  join(directory, 'SHA256SUMS'), receiptPath, '--repo', repository, '--prerelease', '--title',
  `BharatCode Linux preview ${metadata.version}`, '--notes-file', notes], { stdio: 'inherit' });
