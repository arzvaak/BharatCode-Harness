import { describe, expect, it, vi } from 'vitest'
import { claimDesktopSingleInstance, type DesktopSingleInstanceApplication } from '../src/single-instance.ts'

describe('desktop single-instance ownership', () => {
  it('quits a second process without registering lifecycle work', () => {
    const quit = vi.fn()
    const on = vi.fn()
    const application = {
      requestSingleInstanceLock: () => false,
      quit,
      on,
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, vi.fn())).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
  })

  it('routes a later launch to the primary process', () => {
    let secondInstance: (() => void) | undefined
    const focus = vi.fn()
    const application = {
      requestSingleInstanceLock: () => true,
      quit: vi.fn(),
      on: vi.fn((_event: 'second-instance', listener: () => void) => { secondInstance = listener }),
    } satisfies DesktopSingleInstanceApplication

    expect(claimDesktopSingleInstance(application, focus)).toBe(true)
    secondInstance?.()
    expect(focus).toHaveBeenCalledOnce()
  })
})

it('forwards launch arguments including a private chat URI to the existing window', () => {
  let secondInstance!: (event?: unknown, argv?: string[]) => void
  const open = vi.fn()
  const application: DesktopSingleInstanceApplication = {
    requestSingleInstanceLock: () => true, quit: vi.fn(),
    on: (_event, listener) => { secondInstance = listener },
  }
  claimDesktopSingleInstance(application, open)
  const argv = ['BharatCode.exe', 'dsh://sessions/source']
  secondInstance({}, argv)
  expect(open).toHaveBeenCalledWith(argv)
})
