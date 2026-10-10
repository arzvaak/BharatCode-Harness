/** Serialized, detached native record seam for plugin-wiring fixtures. */
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
export function createFakeCredentials() {
  const records = new Map<CredentialKey, CredentialRecord>()
  let tail = Promise.resolve()
  return {
    async readRecord(key: CredentialKey) { await tail; return structuredClone(records.get(key)) },
    modifyRecord(key: CredentialKey, mutate: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
      const next = tail.then(async () => {
        const update = await mutate(structuredClone(records.get(key)))
        if (update !== undefined) records.set(key, structuredClone(update))
        return structuredClone(records.get(key))
      })
      tail = next.then(() => {}, () => {})
      return next
    },
  }
}
