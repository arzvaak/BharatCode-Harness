#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { lstat } from 'node:fs/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { listSessionLogFiles } from './session-log-files.js'
import { repairSessionLog } from './session-log-repair.js'

async function main() {
  const { values } = parseArgs({ options: {
    write: { type: 'boolean', default: false },
    'sessions-root': { type: 'string' }, 'host-modules': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } })
  if (values.help) {
    console.log('dsh-cost-meter-repair-sessions [--sessions-root <directory>] [--write] [--host-modules <node_modules>]
Default: inspect only. Exit every host process before passing --write. Each changed log gets an unchanged backup first.
Writes require @deepseek-ai/dsh with the command or --host-modules pointing to an existing host installation.
`${values.write ? "Repair" : "Read-only inspection"}：${root}`)
  for (const path of listSessionLogFiles(root, null, true)) {
    totals.scanned++
    try {
      const result = await repairSessionLog(path, { write: values.write, acquireLease })
      if (!result.changedEvents) continue
      totals.affected++; totals.events += result.changedEvents
      if (result.written) totals.repaired++
      console.log(JSON.stringify({ path, events: result.changedEvents, written: result.written, backup: result.backup }))
    } catch (error) {
      totals.failed++
      console.error(JSON.stringify({ path, error: error.message }))
    }
  }
  console.log(JSON.stringify(totals))
  if (totals.failed) process.exitCode = 1
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
