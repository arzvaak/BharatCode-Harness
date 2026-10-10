/** Verify native Linux packages and every updater checksum before local qualification. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(join(root, 'package.json'));
const { load } = require('js-yaml');
const directory = join(root, 'apps/desktop/.desktop-build/targets/linux-x64/artifacts');
const metadata = JSON.parse(readFileSync(join(directory, 'linux-preview-build.json')));
assert.equal(metadata.updateMode, 'github');
const feed = load(readFileSync(join(directory, 'rc-linux.yml'), 'utf8'));
assert.equal(feed.version, metadata.version);
const names = readdirSync(directory);
for (const kind of ['AppImage', 'deb', 'rpm']) {
  const selected = names.filter(name => name.endsWith(`.${kind}`));
  assert.equal(selected.length, 1, `Exactly one ${kind} required`);
  const name = selected[0];
  const file = feed.files.find(file => file.url === name);
  assert.ok(file, `Updater feed missing ${kind}`);
  const bytes = readFileSync(join(directory, name));
  assert.equal(file.size, bytes.length);
  assert.equal(file.sha512, createHash('sha512').update(bytes).digest('base64'));
}
const config = load(readFileSync(join(directory, 'linux-unpacked/resources/app-update.yml'), 'utf8'));
assert.equal(config.provider, 'github');
assert.equal(config.owner, 'arzvaak');
assert.equal(config.repo, 'BharatCode-Extensions');
assert.equal(config.channel, 'rc');
const rpm = join(directory, names.find(name => name.endsWith('.rpm')));
assert.match(execFileSync('rpm', ['-qp', '--qf', '%{NAME} %{ARCH}', rpm], { encoding: 'utf8' }), /^bharatcode-harness x86_64$/);
const rpmFiles = execFileSync('rpm', ['-qpl', rpm], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
for (const suffix of ['/resources/app-update.yml', '/resources/package-type', '/resources/dsh/desktop-runtime.json', '/bharatcode-harness.desktop']) {
  assert.ok(rpmFiles.includes(suffix), `RPM missing ${suffix}`);
}
const deb = join(directory, names.find(name => name.endsWith('.deb')));
const entries = execFileSync('ar', ['t', deb], { encoding: 'utf8' }).trim().split('\n');
const control = execFileSync('ar', ['p', deb, entries.find(name => name.startsWith('control.tar'))]);
const fields = execFileSync('tar', ['-xOf', '-', './control'], { input: control, encoding: 'utf8' });
assert.match(fields, /Package: bharatcode-harness\n/);
assert.match(fields, /Architecture: amd64\n/);
const data = execFileSync('ar', ['p', deb, entries.find(name => name.startsWith('data.tar'))], { maxBuffer: 1024 * 1024 * 1024 });
const debFiles = execFileSync('tar', ['-tf', '-'], { input: data, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
for (const suffix of ['/resources/app-update.yml', '/resources/package-type', '/resources/dsh/desktop-runtime.json', '/bharatcode-harness.desktop']) {
  assert.ok(debFiles.includes(suffix), `DEB missing ${suffix}`);
}
console.log('Linux packages: AppImage, RPM, DEB, GitHub feed, package markers, desktop entries, and checksums verified');
