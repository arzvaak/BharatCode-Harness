/** Qualify the real Electron Linux updater using only an owned temporary application. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

if (process.platform !== 'linux') throw Error('Linux updater qualification requires Linux')
const root = await mkdtemp(join(tmpdir(), 'bc-linux-updater-'))
try {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/KEY|SECRET|TOKEN|PASSWORD|^NODE_OPTIONS$|^ELECTRON_RUN_AS_NODE$/iu.test(name)))
  const child = spawn(electron, ['--ozone-platform=x11', fileURLToPath(new URL('../tests/fixtures/linux-updater.mjs', import.meta.url))], {
    env: { ...env, BC_LINUX_UPDATE_TEST_ROOT: root }, stdio: 'inherit',
  })
  const timer = setTimeout(() => { child.kill('SIGTERM') }, 60_000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    if (code !== 0) throw Error(`Linux updater qualification failed: ${code}`)
    const report = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'))
    const destination = fileURLToPath(new URL('../.desktop-build/qualification/linux-updater.json', import.meta.url))
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, JSON.stringify(report, null, 2) + '\n')
    console.log('Linux updater: no downgrade, checksum rejection, retry, approval, replacement, and restart passed')
  } finally { clearTimeout(timer) }
} finally { await rm(root, { recursive: true, force: true }) }
