import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import yaml from 'js-yaml'
const load = name => yaml.load(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'))
test('all platform jobs are required by a failing aggregate even if another job is skipped', () => {
  const workflow = load('ci.yml')
  assert.deepEqual(workflow.jobs.compatibility.needs, ['checks', 'linux', 'windows'])
  assert.equal(workflow.jobs.compatibility.if, 'always()')
  assert.match(workflow.jobs.compatibility.steps[0].run, /success/)
  assert.match(workflow.jobs.windows['runs-on'], /^windows-/)
  assert.equal(workflow.jobs.windows.defaults.run.shell, 'pwsh')
  assert.ok(workflow.jobs.linux.steps.some(step => step.run?.includes('test:snapshot')))
  assert.ok(workflow.jobs.linux.steps.some(step => step.run?.includes('test:web:ci')))
  assert.ok(workflow.jobs.windows.steps.some(step => step.run?.includes('--unsigned')))
})
test('upstream integration uses App credentials, one candidate and serialized updates', () => {
  const workflow = load('upstream-track.yml')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.ok(workflow.jobs.drift.steps.some(step => step.uses?.startsWith('actions/create-github-app-token@')))
  assert.ok(workflow.jobs.drift.steps.some(step => step.run?.includes('automation.mjs')))
})
