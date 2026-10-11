/** Internal, keyless audit of settled requests; no profile launch or provider call. */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { SessionId } from '@deepseek-ai/dsh-session'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { reconstructRequest, diffRequests, replayWithoutTools } from '../packages/api/workspace-controller/src/request-review.ts'
const { values } = parseArgs({
  options: {
    log: { type: 'string' },
    before: { type: 'string' },
    after: { type: 'string' },
    snapshot: { type: 'boolean' },
    'remove-tools': { type: 'string' },
    help: { type: 'boolean' },
  },
})
if (values.help) {
  console.log(
    'pnpm exec tsx scripts/workflow-request-review.ts --log PATH --before TURN:STEP [--after TURN:STEP] [--snapshot] [--remove-tools NAME,NAME]\nOffline comparison only. Paid replay uses the authenticated internal knowledge.replayRequest Remote with explicit paid-replay consent; it never dispatches tool calls.',
  )
} else {
  if (values.log === undefined || values.before === undefined) throw new Error('--log and --before are required')
  const coordinate = (value: string): [number, number] => {
    const match = /^(\d+):(\d+)$/.exec(value)
    if (match === null) throw new Error('Request coordinate must be TURN:STEP')
    return [Number(match[1]), Number(match[2])]
  }
  const events = parseSessionLog(await readFile(values.log, 'utf8'))
  const before = reconstructRequest(SessionId('offline-review'), events, ...coordinate(values.before))
  const after =
    values.after === undefined
      ? replayWithoutTools(before, values['remove-tools']?.split(',').filter(Boolean) ?? [])
      : reconstructRequest(SessionId('offline-review'), events, ...coordinate(values.after))
  console.log(JSON.stringify(values.snapshot ? before : diffRequests(before, after), null, 2))
}
