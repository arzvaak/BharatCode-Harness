/** Identity expectations change only with a reviewed product rebrand. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { resolveClientBuildEnvironment } from '../client-build-environment.ts'
import { en, zh } from '../../apps/desktop/src/locale.ts'
it('keeps the accepted product name in official client builds and both desktop locales', () => {
  const identity = JSON.parse(readFileSync(new URL('./identity.json', import.meta.url), 'utf8')) as { productName: string }
  const environment = resolveClientBuildEnvironment({ DSH_CLIENT_COMMIT_HASH: 'fixture', DSH_CLIENT_VERSION: '0.0.0' }, 'official')
  expect(environment.DSH_CLIENT_TITLE).toBe(identity.productName)
  expect(en.aboutProduct).toBe(identity.productName)
  expect(zh.aboutProduct).toBe(identity.productName)
})
