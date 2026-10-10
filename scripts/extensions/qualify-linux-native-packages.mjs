/** Install and remove the qualified native packages in owned, disposable distribution containers. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..');
const directory = join(root, 'apps/desktop/.desktop-build/targets/linux-x64/artifacts');
const rows = [];
const targets = [
  { kind: 'rpm', image: 'docker.io/library/fedora@sha256:1ad64e0ebefee83263fffacc5cb139b37ff70def215e4fe44720896c83353132',
    install: 'dnf -y install /packages/"$BC_PACKAGE"', query: 'rpm -q bharatcode-harness', remove: 'dnf -y remove bharatcode-harness' },
  { kind: 'deb', image: 'docker.io/library/debian@sha256:918311b7b6c4c6f68b232ba516584925f6c78ad82b6fd534b98979df6438e483',
    install: 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -y install /packages/"$BC_PACKAGE"', query: 'dpkg-query -W bharatcode-harness', remove: 'apt-get -y remove bharatcode-harness' },
];
for (const target of targets) {
  const names = readdirSync(directory).filter(name => name.endsWith(`.${target.kind}`));
  if (names.length !== 1 || !/^[A-Za-z0-9._-]+$/u.test(names[0])) throw Error(`Exactly one ${target.kind} package required`);
  const command = `set -eu\n${target.install}\n${target.query}\ntest -f /usr/share/applications/bharatcode-harness.desktop\ntest -f /opt/BharatCode/resources/app-update.yml\ntest "$(cat /opt/BharatCode/resources/package-type)" = ${target.kind}\nldd /opt/BharatCode/bharatcode > /tmp/bc-libraries\ncat /tmp/bc-libraries\nif grep -q 'not found' /tmp/bc-libraries; then exit 1; fi\n/opt/BharatCode/resources/runtime/primary-runtime/dependencies/node/bin/node --version\n${target.remove}\ntest ! -e /opt/BharatCode/bharatcode\n`;
  execFileSync('podman', ['run', '--rm', '--security-opt', 'label=disable', '-v', `${directory}:/packages:ro`, '-e', `BC_PACKAGE=${names[0]}`, target.image, 'sh', '-c', command], { stdio: 'inherit', timeout: 600_000 });
  rows.push({ kind: target.kind, image: target.image, package: names[0], sha256: createHash('sha256').update(readFileSync(join(directory, names[0]))).digest('hex'), result: 'passed' });
}
const destination = join(root, 'apps/desktop/.desktop-build/qualification/native-packages.json');
mkdirSync(join(destination, '..'), { recursive: true });
writeFileSync(destination, JSON.stringify({ result: 'passed', targets: rows }, null, 2) + '\n');
console.log('Fedora and Debian: native package installation, runtime, desktop entry, updater markers, and removal passed');
