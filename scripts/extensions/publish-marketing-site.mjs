/** Deploy locally qualified static content using only the authorized public Pages workflow. */
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { requireLocalRelease } from './local-release.mjs';
const root = resolve(import.meta.dirname, '../..');
requireLocalRelease(root);
execFileSync(process.execPath, ['scripts/extensions/build-marketing-site.mjs'], { cwd: root, stdio: 'inherit' });
const repository = 'arzvaak/BharatCode-Extensions';
const temporary = mkdtempSync(join(tmpdir(), 'bc-pages-'));
const git = args => execFileSync('git', args, { cwd: temporary, encoding: 'utf8' }).trim();
const api = (path, body, method = 'PUT') => {
  const input = join(temporary, 'request.json'); writeFileSync(input, JSON.stringify(body));
  return execFileSync('gh', ['api', `repos/${repository}/${path}`, '--method', method, '--input', input], { encoding: 'utf8' });
};
try {
  git(['init', '--initial-branch=gh-pages']);
  git(['remote', 'add', 'origin', `https://github.com/${repository}.git`]);
  const existing = git(['ls-remote', '--heads', 'origin', 'gh-pages']);
  if (existing) { git(['fetch', '--depth=1', 'origin', 'gh-pages']); git(['reset', '--hard', 'FETCH_HEAD']); }
  for (const key of ['user.name', 'user.email']) {
    const value = execFileSync('git', ['config', key], { cwd: root, encoding: 'utf8' }).trim();
    git(['config', key, value]);
  }
  if (existing) git(['rm', '-r', '--ignore-unmatch', '.']);
  cpSync(join(root, 'dist/marketing-site'), temporary, { recursive: true });
  mkdirSync(join(temporary, '.github/workflows'), { recursive: true });
  writeFileSync(join(temporary, '.github/workflows/pages.yml'), `name: Deploy prebuilt Pages\non:\n  push:\n    branches: [gh-pages]\n  workflow_dispatch:\npermissions:\n  contents: read\n  pages: write\n  id-token: write\nconcurrency:\n  group: pages\n  cancel-in-progress: false\njobs:\n  deploy:\n    environment:\n      name: github-pages\n      url: \${{ steps.deployment.outputs.page_url }}\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/configure-pages@v5\n      - uses: actions/upload-pages-artifact@v3\n        with:\n          path: .\n      - name: Deploy\n        id: deployment\n        uses: actions/deploy-pages@v4\n`);
  git(['add', '.']);
  git(['commit', '-m', 'Publish locally qualified BharatCode Linux marketing site']);
  git(['push', 'origin', 'gh-pages']);
  api('actions/permissions', { enabled: true, allowed_actions: 'selected' });
  api('actions/permissions/selected-actions', { github_owned_allowed: false, verified_allowed: false,
    patterns_allowed: ['actions/checkout@v4', 'actions/configure-pages@v5', 'actions/upload-pages-artifact@v3', 'actions/upload-artifact@v4', 'actions/deploy-pages@v4'] });
  let exists = true;
  try { execFileSync('gh', ['api', `repos/${repository}/pages`], { stdio: 'pipe' }); } catch { exists = false; }
  api('pages', { build_type: 'workflow', source: { branch: 'gh-pages', path: '/' } }, exists ? 'PUT' : 'POST');
  git(['commit', '--allow-empty', '-m', 'Deploy prebuilt Pages content']);
  git(['push', 'origin', 'gh-pages']);
  console.log('Public Pages deployment dispatched; application build/test Actions remain disabled.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
