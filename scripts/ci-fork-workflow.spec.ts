/** The fork replaces upstream's CI suite with one lean gate; keep it intact. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function loadWorkflow(name: string): Record<string, unknown> {
  const path = resolve(root, '.github/workflows', name)
  if (!existsSync(path)) throw new Error(`missing workflow: ${name}`)
  const document: unknown = yaml.load(readFileSync(path, 'utf8'))
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new TypeError(`${name} must contain a workflow object`)
  }
  return document as Record<string, unknown>
}

function checksJob(workflow: Record<string, unknown>): Record<string, unknown> {
  const jobs = workflow.jobs
  if (typeof jobs !== 'object' || jobs === null) throw new TypeError('workflow must define jobs')
  const job = (jobs as Record<string, unknown>).checks
  if (typeof job !== 'object' || job === null) throw new TypeError('workflow must define the checks job')
  return job as Record<string, unknown>
}

function runCommands(job: Record<string, unknown>): unknown[] {
  const steps = job.steps
  if (!Array.isArray(steps)) throw new TypeError('checks job must define steps')
  return steps
    .filter((step): step is Record<string, unknown> => typeof step === 'object' && step !== null)
    .map(step => step.run)
    .filter(command => command !== undefined)
}

describe('fork CI gate (.github/workflows/ci.yml)', () => {
  it('triggers on trunk pushes and on pull requests', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(workflow.on).toHaveProperty('push')
    expect(workflow.on).toHaveProperty('pull_request')
  })

  it('creates safe local settings before packaging the unsigned Windows runtime', () => {
    const workflow = loadWorkflow('ci.yml')
    const jobs = workflow.jobs as Record<string, Record<string, unknown>>
    const windowsJob = jobs.windows
    if (!windowsJob) throw new Error('workflow must define the windows job')
    const steps = windowsJob.steps as Record<string, unknown>[]
    const setup = steps.findIndex(step => step.name === 'Configure unsigned Windows packaging environment')
    const packaging = steps.findIndex(step => step.name === 'Package unsigned Windows runtime and run the built payload smoke')
    expect(setup).toBeGreaterThanOrEqual(0)
    expect(packaging).toBeGreaterThan(setup)
    for (const setting of [
      'DSH_DESKTOP_APP_ID=dev.bharatcode.harness',
      'DSH_DESKTOP_AUTO_UPDATE_ENV=test',
      'DOWNLOAD_TEST_ORIGIN=https://updates.example.invalid',
      'DOWNLOAD_TEST_RELEASE_ID=0123456789abcdef0123456789abcdef',
      'DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN=https://policy.example.invalid',
      'DSH_DESKTOP_MANDATORY_UPDATE_CONFIG=',
    ]) {
      expect(steps[setup]?.run).toContain(setting)
    }
  })

  it('runs install, sandbox backend, build, profile composition, brand tripwire, tests — in that order', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(checksJob(workflow)['runs-on']).toBe('ubuntu-latest')
    expect(runCommands(checksJob(workflow))).toEqual([
      'pnpm install --frozen-lockfile',
      'bash scripts/prepare-ci-bubblewrap.sh',
      'pnpm run build',
      'bash scripts/gates/verify-config.sh',
      'bash scripts/gates/brand-tripwire.sh',
      'node --test scripts/compatibility/*.test.mjs\nnode scripts/compatibility/upstream.mjs validate\nnode scripts/compatibility/composition.mjs\npnpm exec vitest run scripts/compatibility/continuation.spec.ts scripts/compatibility/identity.spec.ts\n',
      'pnpm run verify-persistence-changes\npnpm run verify-persistence-releases\npnpm run verify-persistence-formats\n',
      'pnpm run test',
      'node scripts/compatibility/evidence.mjs unit',
    ])
  })

  it('cancels superseded runs on the same ref', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(workflow.concurrency).toMatchObject({ 'cancel-in-progress': true })
  })

  it('keeps the profile composition gate executable', () => {
    expect(existsSync(resolve(root, 'scripts/gates/verify-config.sh'))).toBe(true)
  })

  it('keeps the brand tripwire gate executable', () => {
    expect(existsSync(resolve(root, 'scripts/gates/brand-tripwire.sh'))).toBe(true)
  })
})
