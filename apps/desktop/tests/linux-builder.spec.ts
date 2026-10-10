import { expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

it('packages a self-contained Linux preview without an unrelated updater or policy service', () => {
  const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'org.bharatcode.Harness.preview' }, 'linux', 'x64')
  expect(config.productName).toBe('BharatCode')
  expect(config.linux.target).toEqual(['AppImage'])
  expect(config.electronDist).toContain('linux-x64')
  expect(config.publish).toBeNull()
  expect(config.asar).toBe(true)
  expect(config.extraMetadata.dshMandatoryUpdatePolicy).toBeUndefined()
  expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'dsh' }))
  expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'dsh/node_modules', filter: ['**/*'] }))
  expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'runtime' }))
})
