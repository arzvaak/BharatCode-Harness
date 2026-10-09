/** Real native credential provider, isolated home; no real account or profile access. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { LocalCredentialProvider } from '../../../packages/credentials/credentials-local/lib/index.js';
import { createNativeSessionStore, listAccounts, saveAccountSession, deleteAccountSession } from '../lib/auth/store.js';
const home = await mkdtemp(join(tmpdir(), 'bc-native-subscription-'));
const contexts = [];
try {
  const legacy = join(home, 'plugins/subscriptions/auth.json');
  const session = account => ({ accessToken: `fixture-access-${account}`, refreshToken: `fixture-refresh-${account}`, expiresAt: 10000, account });
  const bytes = JSON.stringify({ copilot: { default: 'a', accounts: { a: session('a') } } });
  await mkdir(join(home, 'plugins/subscriptions'), { recursive: true });
  await writeFile(legacy, bytes, { mode: 0o600 });
  async function open() {
    const ctx = new Context(); contexts.push(ctx);
    await ctx.plugin(LocalCredentialProvider, { path: join(home, '.credentials.yaml'), dshHome: home, watch: false });
    return createNativeSessionStore(ctx.credentials, [legacy]);
  }
  const a = await open(), b = await open();
  assert.equal((await listAccounts('copilot', a)).length, 1);
  await Promise.all([saveAccountSession('copilot', 'b', session('b'), a), saveAccountSession('copilot', 'c', session('c'), b)]);
  const restarted = await open();
  assert.deepEqual((await listAccounts('copilot', restarted)).map(x => x.key).sort(), ['a', 'b', 'c']);
  for (const key of ['a', 'b', 'c']) await deleteAccountSession('copilot', key, restarted);
  assert.deepEqual(await listAccounts('copilot', await open()), []);
  assert.equal(await readFile(legacy, 'utf8'), bytes);
  console.log('Real native credential provider: migration, exclusive writes, restart, logout and preserved legacy bytes passed.');
} finally {
  for (const ctx of contexts) await ctx.fiber.dispose();
  await rm(home, { recursive: true, force: true });
}
