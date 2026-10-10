import { expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

it('packages a self-contained Linux preview with GitHub updates and native distribution packages', () => {
  const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'org.bharatcode.Harness.preview' }, 'linux', 'x64')
  expect(config.productName).toBe('BharatCode')
  expect(config.linux.target).toEqual(['AppImage', 'deb', 'rpm'])
  expect(config.electronDist).toContain('linux-x64')
  expect(config.publish).toEqual([{ provider: 'github', owner: 'arzvaak', repo: 'BharatCode-Harness', channel: 'rc', releaseType: 'prerelease' }])
  expect(config.deb.packageName).toBe('bharatcode-harness')
  expect(config.rpm.packageName).toBe('bharatcode-harness')
  expect(config.deb.depends).toContain('libasound2t64 | libasound2')
  expect(config.rpm.depends).toContain('alsa-lib')
  expect(config.deb.depends).toContain('pkexec')
  expect(config.rpm.depends).toContain('polkit')
  expect(config.asar).toBe(true)
  expect(config.extraMetadata.dshMandatoryUpdatePolicy).toBeUndefined()
  expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'dsh' }))
  expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'dsh/node_modules', filter: ['**/*'] }))
  expect(config.extraResources).toContainEqual(expect.objectContaining({ to: 'runtime' }))
})
