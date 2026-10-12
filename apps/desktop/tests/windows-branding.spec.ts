import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

it('uses BharatCode for Windows installer, executable, shortcuts and packaged metadata', () => {
  const config = createElectronBuilderConfig({ DSH_DESKTOP_APP_ID: 'org.bharatcode.Harness.preview',
    DSH_DESKTOP_WINDOWS_PREVIEW: '1', DSH_DESKTOP_UNSIGNED: '1' }, 'win32', 'x64')
  const require = createRequire(import.meta.url)
  const { getWindowsInstallationDirName } = require('app-builder-lib/out/targets/targetUtil.js') as { getWindowsInstallationDirName: (info: { productFilename: string; sanitizedName: string }, preferProductName: boolean) => string }
  expect(getWindowsInstallationDirName({ productFilename: config.productName, sanitizedName: 'dsh-desktop' }, !config.nsis.oneClick)).toBe('BharatCode')
  expect(config.win.executableName).toBe('BharatCode')
  expect(config.nsis.shortcutName).toBe('BharatCode')
  expect(config.extraMetadata.productName).toBe('BharatCode')
  expect(config.extraMetadata.author.name).toBe('BharatCode')
})

it.each(['brand', 'brand-2x', 'brand-dark', 'brand-dark-2x', 'uninstaller-sidebar'])('ships the orange BharatCode mark in native installer artwork %s', async (name) => {
  const { data, info } = await sharp(readFileSync(new URL(`../installer/assets/${name}.png`, import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let orange = 0
  for (let i = 0; i < data.length; i += info.channels) {
    if (data.readUInt8(i) > 230 && data.readUInt8(i + 1) > 70 && data.readUInt8(i + 1) < 140
      && data.readUInt8(i + 2) < 90 && data.readUInt8(i + 3) > 200) orange++
  }
  expect(orange).toBeGreaterThan(info.width * info.height * 0.01)
})
