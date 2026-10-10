/** Real AppImage download and replacement, confined to one temporary fixture directory. */
import { app } from 'electron'
import updaterModule from 'electron-updater'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { DesktopUpdateCoordinator } from '../../lib/types/update-coordinator.js'
import { DesktopUpdateHttpExecutor } from '../../lib/types/update-http-executor.js'

void (async () => {
const root = process.env.BC_LINUX_UPDATE_TEST_ROOT
if (!root || !root.includes('bc-linux-updater-')) throw Error('Owned fixture root required')
app.setPath('userData', root)
await app.whenReady()
const current = join(root, 'BharatCode.AppImage')
const marker = join(root, 'restarted')
const original = '#!/bin/sh\nexit 0\n'
const payload = Buffer.from(`#!/bin/sh\nprintf updated > '${marker}'\n`)
await writeFile(current, original, { mode: 0o755 })
await writeFile(join(root, 'app-update.yml'), 'updaterCacheDirName: fixture-cache\n')
process.env.APPIMAGE = current
let version = '0.9.0-rc.1'
let corrupt = false
const states = []
const cases = []
const server = createServer((request, response) => {
  if (request.url.startsWith('/rc-linux.yml')) {
    response.setHeader('Content-Type', 'text/yaml')
    const sha512 = createHash('sha512').update(corrupt ? Buffer.from('wrong') : payload).digest('base64')
    response.end(`version: ${version}\nfiles:\n  - url: BharatCode.AppImage\n    size: ${payload.length}\n    sha512: ${sha512}\npath: BharatCode.AppImage\nsha512: ${sha512}\nreleaseDate: 2026-10-10T00:00:00.000Z\n`)
  } else if (request.url.startsWith('/BharatCode.AppImage')) {
    response.setHeader('Content-Length', payload.length)
    response.end(payload)
  } else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
let allowRestart = false
const forbidden = () => { throw Error('Fixture cannot quit or relaunch another application') }
const updater = new updaterModule.AppImageUpdater(undefined, {
  version: '1.0.0-rc.1', name: 'bharatcode-owned-qualification', isPackaged: true,
  userDataPath: root, baseCachePath: root, appUpdateConfigPath: join(root, 'app-update.yml'),
  whenReady: async () => {}, quit: forbidden, relaunch: forbidden, onQuit: forbidden,
})
updater.logger = null
updater.httpExecutor = new DesktopUpdateHttpExecutor(5000)
updater.disableDifferentialDownload = true
updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${port}/`, channel: 'rc' })
const coordinator = new DesktopUpdateCoordinator(state => { states.push(state); return state },
  async () => allowRestart, updater, () => true, () => '1.0.0-rc.1')
// Use the real AppImage replacement while avoiding the fixture Electron process's own quit.
updater.quitAndInstall = () => { assert.equal(updater.install(true, true), true) }
let failure
try {
  assert.equal((await coordinator.check(true)).phase, 'idle')
  cases.push('older-release-does-not-downgrade')
  version = '1.0.0-rc.2'
  corrupt = true
  assert.equal((await coordinator.check(true)).phase, 'available')
  const failure = await coordinator.download(version)
  assert.equal(failure.phase, 'error')
  assert.equal(failure.failedOperation, 'download')
  assert.equal(await readFile(current, 'utf8'), original)
  cases.push('checksum-failure-preserves-installed-file')
  corrupt = false
  await coordinator.check(true)
  const ready = await coordinator.download(version)
  assert.equal(ready.phase, 'ready')
  assert.equal(await readFile(current, 'utf8'), original)
  cases.push('retry-downloads-and-verifies-without-installing')
  await coordinator.install(version)
  assert.equal(await readFile(current, 'utf8'), original)
  cases.push('restart-refusal-preserves-installed-file')
  allowRestart = true
  await coordinator.install(version)
  const deadline = Date.now() + 5000
  let restarted = false
  while (!restarted && Date.now() < deadline) { try { restarted = await readFile(marker, 'utf8') === 'updated' } catch {} if (!restarted) await delay(50) }
  assert.equal(restarted, true)
  assert.deepEqual(await readFile(current), payload)
  cases.push('approved-update-replaces-owned-appimage-and-restarts')
  await writeFile(join(root, 'result.json'), JSON.stringify({ platform: 'linux', result: 'passed', cases, phases: states.map(state => state.phase) }, null, 2) + '\n')
} catch (error) { failure = error } finally {
  coordinator.dispose()
  await new Promise(resolve => server.close(resolve))
}
if (failure) { console.error(failure); app.exit(1) } else { app.exit(0) }


})().catch(error => { console.error(error); app.exit(1) })
