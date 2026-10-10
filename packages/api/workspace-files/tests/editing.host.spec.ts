import { afterEach, expect, it } from 'vitest'
import { readFile, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { openWorkspace, signal, failureOf, type Harness } from './harness.ts'

let harness: Harness | undefined
afterEach(async () => {
  await harness?.dispose()
})

it('reads complete Unicode content and preserves concurrent agent edits through version-checked saves', async () => {
  harness = await openWorkspace('bharatcode-editor-')
  const path = join(harness.workspace, '章.md')
  await writeFile(path, '# Chapter\r\nनमस्ते\n')
  const api = harness.endpoint()
  const original = await api.readEditable(harness.scope, path, signal())
  expect(original.text).toBe('# Chapter\r\nनमस्ते\n')
  await writeFile(path, 'Agent edit\n')
  const conflict = await api.saveEditable(
    harness.scope,
    path,
    { text: 'My draft\n', expectedVersion: original.version },
    signal(),
  )
  expect(conflict).toMatchObject({ status: 'conflict', current: { text: 'Agent edit\n' } })
  expect(await readFile(path, 'utf8')).toBe('Agent edit\n')
  if (conflict.status !== 'conflict') throw new Error('expected conflict')
  const saved = await api.saveEditable(
    harness.scope,
    path,
    { text: 'Merged\n', expectedVersion: conflict.current.version },
    signal(),
  )
  expect(saved.status).toBe('saved')
  expect(await readFile(path, 'utf8')).toBe('Merged\n')
})

it('refuses edits outside the project, binary text and symlink targets', async () => {
  harness = await openWorkspace('bharatcode-editor-boundaries-')
  const outside = join(harness.outside, 'keep.md')
  await writeFile(outside, 'Keep')
  const api = harness.endpoint()
  const viewed = await api.stat(harness.scope, outside, signal())
  expect(
    await failureOf(
      api.saveEditable(harness.scope, outside, { text: 'Changed', expectedVersion: viewed.version }, signal()),
    ),
  ).toMatchObject({ code: 'workspace-file/outside-workspace' })
  const binary = join(harness.workspace, 'binary.md')
  await writeFile(binary, new Uint8Array([65, 0, 66]))
  expect(await failureOf(api.readEditable(harness.scope, binary, signal()))).toMatchObject({
    code: 'workspace-file/not-text',
  })
  const link = join(harness.workspace, 'link.md')
  await symlink(outside, link)
  expect(
    await failureOf(
      api.saveEditable(harness.scope, link, { text: 'Changed', expectedVersion: viewed.version }, signal()),
    ),
  ).toMatchObject({ code: 'workspace-file/not-regular-file' })
  expect(await readFile(outside, 'utf8')).toBe('Keep')
})
