import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const handler = new URL('../src/stdio-errors.ts', import.meta.url).href

describe('desktop output after its launcher disconnects', () => {
  it.each(['stdout', 'stderr'] as const)('survives repeated writes to a disconnected %s pipe', async (stream) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      const { installDesktopStdioErrorHandlers } = await import(${JSON.stringify(handler)});
      installDesktopStdioErrorHandlers();
      process.send('ready');
      process.on('message', () => {
        const write = () => process.${stream}.write('updater warning\\n');
        write();
        setTimeout(() => { write(); setTimeout(() => process.exit(0), 30); }, 30);
      });
    `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    let errors = ''
    if (stream === 'stdout') child.stderr!.on('data', (chunk) => { errors += String(chunk) })
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => { resolve() })
        child.once('exit', () => { reject(new Error(`child exited before ready: ${errors}`)) })
      })
      child[stream]!.destroy()
      child.send('write')
      expect(await exited, errors).toBe(0)
    } finally { if (child.exitCode === null) child.kill() }
  })

  it('preserves failures other than a broken output pipe', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      const { installDesktopStdioErrorHandlers } = await import(${JSON.stringify(handler)});
      installDesktopStdioErrorHandlers();
      process.stderr.emit('error', Object.assign(new Error('output fault'), { code: 'EIO' }));
    `], { stdio: ['ignore', 'ignore', 'pipe'] })
    let errors = ''
    child.stderr.on('data', (chunk) => { errors += String(chunk) })
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    expect(code).not.toBe(0)
    expect(errors).toContain('output fault')
  })
})
