/** Observe the real application without replacing Electron, Host or product services. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const appRoot = process.env.BHARATCODE_COMPAT_APP_ROOT
const temporary = process.env.BHARATCODE_COMPAT_DESKTOP_ROOT
assert.ok(appRoot && temporary, 'desktop smoke requires private runtime paths')
const { app, BrowserWindow } = createRequire(join(appRoot, 'package.json'))('electron')
app.setAppPath(appRoot)
app.setPath('userData', join(temporary, 'electron'))
let inspected = false
let poll
const fail = error => { console.error(error); clearInterval(poll); app.exit(1) }
const deadline = setTimeout(() => fail(new Error('Desktop main/preload/Host readiness deadline exceeded')), 150_000)
try {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('preload-error', (_event, _path, error) => fail(error))
    contents.on('render-process-gone', (_event, details) => fail(new Error('Desktop renderer exited: ' + details.reason)))
    contents.on('console-message', details => {
      if (details.level === 'error' && /web boot:|entries did not activate|failed to load/.test(details.message)) fail(new Error('Desktop client boot failed'))
    })
  })
  await import(pathToFileURL(join(appRoot, 'lib/main.js')).href)
  poll = setInterval(() => {
    if (inspected) return
    const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed() && candidate.webContents.getURL().startsWith('dsh-app://app/'))
    if (!window) return
    inspected = true
    void window.webContents.executeJavaScript(`({ ready: document.readyState, title: document.title,
      boot: !!globalThis.__DSH_BOOT__, loading: !!document.querySelector('[data-dsh-boot]'), body: document.body.innerText,
      preload: !!globalThis.dshDesktop })`).then(state => {
      if (state.ready !== 'complete' || !state.boot || state.loading || state.body.trim().length === 0) { inspected = false; return }
      const builtEnvironment = JSON.parse(readFileSync(join(appRoot, '../../.dsh-build/client-build-environment.json'), 'utf8'))
      // The main process and renderer are real; Host boot injections must have reached this document.
      assert.ok(state.preload, 'Desktop preload API must reach the product document')
      const identity = JSON.parse(readFileSync(new URL('./identity.json', import.meta.url), 'utf8'))
      assert.equal(state.title, builtEnvironment.environment.DSH_CLIENT_TITLE ?? identity.localBuildName, 'Desktop title must match accepted identity')
      assert.ok(builtEnvironment, 'Built client identity must be recorded')
      console.log('Linux desktop: real main/preload/Web Host document is ready')
      clearTimeout(deadline)
      clearInterval(poll)
      app.quit()
    }).catch(fail)
  }, 100)
} catch (error) { fail(error) }
