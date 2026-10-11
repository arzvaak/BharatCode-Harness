import { afterEach, expect, it } from 'vitest'
import { access } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '../../../subprocess/subprocess-local/src/index.ts'
import type { ArtifactRevision } from '@deepseek-ai/dsh-workspace/types'
import { executeCapturedNotebook } from '../src/notebook-runner.ts'
const python = process.env['BC_NOTEBOOK_TEST_PYTHON']
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})
function artifact(path: string, text: string): ArtifactRevision {
  return { path, text } as ArtifactRevision
}
async function run(code: string, signal = new AbortController().signal) {
  if (python === undefined) throw new Error('Set BC_NOTEBOOK_TEST_PYTHON to an isolated nbclient/ipykernel environment')
  await access(python)
  const ctx = new Context()
  contexts.push(ctx)
  new LocalSubprocessRuntime(ctx)
  const notebook = JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [{ cell_type: 'code', id: 'probe', metadata: {}, source: code, execution_count: null, outputs: [] }],
  })
  return await executeCapturedNotebook(
    ctx,
    {
      python,
      timeout: 10,
      projectPath: '/project',
      notebook: artifact('/project/a.ipynb', notebook),
      inputs: [artifact('data/input.txt', 'captured')],
      kernel: 'python3',
      parameters: { multiplier: 3 },
    },
    signal,
  )
}
it.skipIf(python === undefined)(
  'executes captured data and parameters in a fresh kernel and records real environment',
  async () => {
    const result = await run("from pathlib import Path\nprint(Path('data/input.txt').read_text(), parameters['multiplier'])")
    expect(result.status).toBe('completed')
    expect(result.notebook).toContain('captured 3')
    const stringMatcher: unknown = expect.any(String)
    expect(JSON.parse(result.environment)).toMatchObject({
      runner: { python },
      kernel: { name: 'python3', language: 'python', observed: { version: stringMatcher, python: stringMatcher } },
    })
  },
  30_000,
)
it.skipIf(python === undefined)(
  'retains an executed notebook with cell failure evidence',
  async () => {
    const result = await run("print('before failure')\nraise ValueError('intentional probe')")
    expect(result.status).toBe('failed')
    expect(result.notebook).toContain('before failure')
    expect(result.notebook).toContain('intentional probe')
  },
  30_000,
)
it.skipIf(python === undefined)(
  'cancels the managed kernel range',
  async () => {
    const controller = new AbortController()
    const pending = run('import time\ntime.sleep(60)', controller.signal)
    setTimeout(() =>{  controller.abort(new Error('cancel probe')) }, 1500)
    await expect(pending).rejects.toThrow('cancel probe')
  },
  30_000,
)
