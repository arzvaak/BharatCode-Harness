import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { createNativeSessionStore, deleteAccountSession, getAccountSession, listAccounts, saveAccountSession, setDefaultAccount } from '../src/auth/store.js'

function credentials() {
  let value: CredentialRecord | undefined
  let tail = Promise.resolve()
  return {
    async readRecord(_key: CredentialKey) { await tail; return structuredClone(value) },
    modifyRecord(_key: CredentialKey, fn: (v: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
      const next = tail.then(async () => { const update = await fn(structuredClone(value)); if (update !== undefined) value = structuredClone(update); return structuredClone(value) })
      tail = next.then(() => {}, () => {})
      return next
    },
    seed(record: CredentialRecord) { value = record },
  }
}
const session = (account: string) => ({ accessToken: `access-${account}`, refreshToken: `refresh-${account}`, expiresAt: 10000, account })

test('native store serializes independent account writers and preserves default/delete semantics', async () => {
  const creds = credentials(), a = createNativeSessionStore(creds, []), b = createNativeSessionStore(creds, [])
  await Promise.all([saveAccountSession('copilot', 'a', session('a'), a), saveAccountSession('copilot', 'b', session('b'), b)])
  assert.equal((await listAccounts('copilot', a)).length, 2)
  await setDefaultAccount('copilot', 'b', b)
  assert.equal((await getAccountSession('copilot', undefined, a))?.account, 'b')
  await deleteAccountSession('copilot', 'b', b)
  assert.equal((await getAccountSession('copilot', undefined, a))?.account, 'a')
})
test('native migration copies legacy credentials once without modifying or resurrecting the legacy file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bc-native-auth-')), path = join(dir, 'auth.json')
  const text = JSON.stringify({ copilot: { default: 'a', accounts: { a: session('a') } } })
  try {
    await writeFile(path, text)
    const creds = credentials(), store = createNativeSessionStore(creds, [path])
    assert.equal((await listAccounts('copilot', store)).length, 1)
    await deleteAccountSession('copilot', 'a', store)
    assert.deepEqual(await listAccounts('copilot', createNativeSessionStore(creds, [path])), [])
    assert.equal(await readFile(path, 'utf8'), text)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('native credential failures and unsupported records fail closed without file fallback', async () => {
  const creds = credentials()
  creds.seed({ kind: 'grant', payload: { schemaVersion: 99, sessions: {} } })
  await assert.rejects(listAccounts('copilot', createNativeSessionStore(creds, [])), /unsupported/)
  const broken = { ...creds, readRecord: async () => { throw new Error('locked native storage') } }
  await assert.rejects(listAccounts('copilot', createNativeSessionStore(broken, [])), /locked native storage/)
})

test('native writes must be acknowledged and failures never report success', async () => {
  const creds = credentials()
  const declined = { ...creds, modifyRecord: async () => undefined }
  const store = createNativeSessionStore(declined, [])
  await assert.rejects(listAccounts('copilot', store), /not acknowledged/)
  await assert.rejects(saveAccountSession('copilot', 'a', session('a'), store), /not acknowledged/)
  const failed = { ...creds, modifyRecord: async () => { throw new Error('native write denied') } }
  await assert.rejects(saveAccountSession('copilot', 'a', session('a'), createNativeSessionStore(failed, [])), /native write denied/)
})
