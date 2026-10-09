// Pack in an isolated directory without lib to ensure ignored artifacts do not leave the release without runnable code.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const sandbox = await mkdtemp(join(tmpdir(), 'dsh-skills-clean-pack-'));
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run via npm run verify to use the current npm entry point');

try {
  for (const name of ['package.json', 'tsconfig.json', 'src', 'scripts', 'test/types', 'assets', 'cordis.patch.yml', 'LICENSE', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'CHANGELOG.zh-CN.md']) {
    await cp(join(root, name), join(sandbox, name), { recursive: true });
  }
  // Reuse installed dependencies only; do not download dependencies or copy/read workspace lib.
  await symlink(join(root, 'node_modules'), join(sandbox, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(access(join(sandbox, 'lib')), { code: 'ENOENT' });
  const { stdout } = await run(process.execPath, [npm, 'pack', '--json'], {
    cwd: sandbox, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  // npm writes prepack build logs before the JSON; parse only the standalone array start line.
  const jsonStart = stdout.search(/^\[\s*$/m);
  assert.ok(jsonStart >= 0, 'npm pack must return a file list');
  const [pack] = JSON.parse(stdout.slice(jsonStart));
  const files = new Set(pack.files.map(file => file.path));
  const manifest = JSON.parse(await readFile(join(sandbox, 'package.json'), 'utf8'));
  assert.equal(pack.version, manifest.version);
  for (const name of ['index', 'client', 'core', 'readonly-discovery', 'plugin-updater', 'repositories', 'repository-updates']) {
    assert.ok(files.has(`lib/${name}.js`), `published package must include the ${name} artifact`);
  }
  assert.ok(files.has('cordis.patch.yml'), 'published package must include the host registration patch');
  assert.ok(![...files].some(file => /^(?:src|test|scripts)\//.test(file) || file.endsWith('.ts') || file === 'tsconfig.json'), 'published package excludes source, tests, and development configuration');
  await run(process.execPath, ['--input-type=module', '-e', "await import('./lib/index.js')"], { cwd: sandbox, windowsHide: true });
  console.log('Clean-directory packaging passed: generated seven artifacts, loadable package entry point, and no development files.');
} finally {
  // Remove the dependency link first so temporary cleanup never recurses into the real node_modules.
  await rm(join(sandbox, 'node_modules'), { force: true, recursive: process.platform === 'win32' });
  await rm(sandbox, { recursive: true, force: true });
}
