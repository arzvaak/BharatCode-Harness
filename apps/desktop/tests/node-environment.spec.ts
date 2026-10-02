import { delimiter, dirname } from 'node:path'
import { realpathSync } from 'node:fs'
import { expect, it } from 'vitest'
import { desktopNodeEnvironment, resolveHostNode } from '../src/node-environment.ts'

it('keeps private Desktop launchers out of the Host environment inherited by PTC', () => {
  const environment = { PATH: '/user/bin', HOME: '/user' }
  expect(desktopNodeEnvironment('/desktop/electron', undefined, environment)).toEqual({
    ...environment, ELECTRON_RUN_AS_NODE: '1',
  })
  expect(environment).toEqual({ PATH: '/user/bin', HOME: '/user' })
})

it('provides private launchers only to package installation processes', () => {
  expect(desktopNodeEnvironment('/desktop/electron', '/desktop/bin', { PATH: '/user/bin' })).toEqual({
    ELECTRON_RUN_AS_NODE: '1',
    DSH_DESKTOP_NODE_EXECUTABLE: '/desktop/electron',
    PATH: `/desktop/bin${delimiter}/user/bin`,
  })
})

it('honours the explicit Host Node override on every platform', () => {
  expect(resolveHostNode({ PATH: '/missing' }, 'linux', '/custom/node')).toBe('/custom/node')
  expect(resolveHostNode({ PATH: '/missing' }, 'darwin', '/custom/node')).toBe('/custom/node')
  expect(resolveHostNode({ PATH: '/missing' }, 'linux', '')).toBeUndefined()
})

it('keeps Electron as the Host where no standalone Node exists', () => {
  expect(resolveHostNode({ PATH: '/definitely/missing/bin' }, 'linux')).toBeUndefined()
  expect(resolveHostNode({ PATH: process.env.PATH ?? '' }, 'darwin')).toBeUndefined()
  expect(resolveHostNode({ PATH: process.env.PATH ?? '' }, 'win32')).toBeUndefined()
})

it.runIf(process.platform === 'linux')('finds a standalone Node on the Linux PATH', () => {
  const resolved = resolveHostNode({ PATH: dirname(process.execPath) }, 'linux')
  expect(resolved).toBe(realpathSync(process.execPath))
})
