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

  it('runs install, sandbox backend, build, profile composition, tests — in that order', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(checksJob(workflow)['runs-on']).toBe('ubuntu-latest')
    expect(runCommands(checksJob(workflow))).toEqual([
      'pnpm install --frozen-lockfile',
      'bash scripts/prepare-ci-bubblewrap.sh',
      'pnpm run build',
      'bash scripts/gates/verify-config.sh',
      'pnpm run test',
    ])
  })

  it('cancels superseded runs on the same ref', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(workflow.concurrency).toMatchObject({ 'cancel-in-progress': true })
  })

  it('keeps the profile composition gate executable', () => {
    expect(existsSync(resolve(root, 'scripts/gates/verify-config.sh'))).toBe(true)
  })
})
