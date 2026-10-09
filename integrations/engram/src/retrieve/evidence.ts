









import type { Slot } from '../types.ts'


export const MAX_EVIDENCE_REFS = 8


export const MAX_MISSING_CHARS = 160


export const MAX_BATCHES_PER_SESSION = 20


export const NEXT_STRATEGIES = ['answer', 'search_keyword', 'search_room', 'search_timeline', 'ask_user', 'stop'] as const


export type NextStrategy = (typeof NEXT_STRATEGIES)[number]


export interface EvidenceBatch {
  
  readonly batchId: string
  
  readonly refs: ReadonlySet<string>
  
  readonly createdAt: number
  
  verdict?: AssessVerdict
}


export const INSUFFICIENT_HINT_THRESHOLD = 2







export function buildAssessReminder(pendingCount: number, insufficientStreak: number): string | undefined {
  if (pendingCount <= 0) return undefined
  const base = `Evidence gate: ${pendingCount} search batch(es) from this conversation have not been assessed. `
    + 'Before answering, call engram_assess with the batchId and your evidence refs — or briefly state why assessment is not needed.'
  if (insufficientStreak < INSUFFICIENT_HINT_THRESHOLD) return base
  return `${base} Multiple insufficient verdicts in a row — try a different room (engram_search room=), engram_timeline, or ask the user for the missing details.`
}


export interface AssessRequest {
  
  readonly sufficient: boolean
  
  readonly evidenceRefs: readonly string[]
  
  readonly missing: string
  
  readonly nextStrategy: string
}


export interface AssessVerdict {
  
  readonly sufficient: boolean
  
  readonly evidenceRefs: readonly string[]
  
  readonly rejectedRefs: readonly string[]
  
  readonly droppedRefs: readonly string[]
  
  readonly missing: string
  
  readonly missingTruncated: boolean
  
  readonly nextStrategy: NextStrategy
  
  readonly requestedStrategy: string
  
  readonly forced: boolean
}





export function isNextStrategy(value: string): value is NextStrategy {
  return (NEXT_STRATEGIES as readonly string[]).includes(value)
}








export function evidenceRefOf(scope: string, id: string, slot: Slot | undefined): string {
  return slot === undefined ? `${scope}/#${id.slice(0, 8)}` : `${scope}/${slot.room}#${slot.index}`
}


export class EvidenceBatches {
  private readonly bySession = new Map<string, Map<string, EvidenceBatch>>()

  
  private readonly insufficientStreaks = new Map<string, number>()

  private counter = 0

  






  register(sessionId: string, refs: readonly string[], now: number = Date.now()): EvidenceBatch {
    this.counter += 1
    const batch: EvidenceBatch = { batchId: `batch-${String(this.counter)}`, refs: new Set(refs), createdAt: now }
    const batches = this.bySession.get(sessionId) ?? new Map<string, EvidenceBatch>()
    batches.set(batch.batchId, batch)
    while (batches.size > MAX_BATCHES_PER_SESSION) {
      const oldest = batches.keys().next().value
      if (oldest === undefined) break
      batches.delete(oldest)
    }
    this.bySession.set(sessionId, batches)
    return batch
  }

  





  get(sessionId: string, batchId: string): EvidenceBatch | undefined {
    return this.bySession.get(sessionId)?.get(batchId)
  }

  





  recordVerdict(sessionId: string, batchId: string, verdict: AssessVerdict): void {
    const batch = this.get(sessionId, batchId)
    if (batch === undefined) return
    batch.verdict = verdict
    const streak = this.insufficientStreaks.get(sessionId) ?? 0
    this.insufficientStreaks.set(sessionId, verdict.sufficient ? 0 : streak + 1)
  }

  



  pendingBatches(sessionId: string): readonly EvidenceBatch[] {
    const batches = this.bySession.get(sessionId)
    if (batches === undefined) return []
    return [...batches.values()].filter(batch => batch.verdict === undefined)
  }

  



  insufficientStreak(sessionId: string): number {
    return this.insufficientStreaks.get(sessionId) ?? 0
  }

  



  clear(sessionId: string): void {
    this.bySession.delete(sessionId)
    this.insufficientStreaks.delete(sessionId)
  }
}


export const evidenceBatches = new EvidenceBatches()









export function assessEvidence(batch: EvidenceBatch, request: AssessRequest): AssessVerdict {
  const submitted = request.evidenceRefs
    .filter((ref): ref is string => typeof ref === 'string')
    .map(ref => ref.trim())
    .filter(ref => ref !== '')
  const unique = [...new Set(submitted)]
  const limited = unique.slice(0, MAX_EVIDENCE_REFS)
  const droppedRefs = unique.slice(MAX_EVIDENCE_REFS)
  const accepted: string[] = []
  const rejectedRefs: string[] = []
  for (const ref of limited) {
    if (batch.refs.has(ref)) accepted.push(ref)
    else rejectedRefs.push(ref)
  }

  const rawMissing = typeof request.missing === 'string' ? request.missing.trim() : ''
  const missingTruncated = rawMissing.length > MAX_MISSING_CHARS
  const missing = missingTruncated ? `${rawMissing.slice(0, MAX_MISSING_CHARS)}…` : rawMissing

  const requestedStrategy = typeof request.nextStrategy === 'string' ? request.nextStrategy.trim() : ''
  const strategy: NextStrategy = isNextStrategy(requestedStrategy) ? requestedStrategy : 'search_keyword'
  const claimed = request.sufficient === true
  const sufficient = claimed && accepted.length > 0 && strategy === 'answer'

  const nextStrategy: NextStrategy = sufficient || strategy !== 'answer' ? strategy : 'search_keyword'
  return {
    sufficient,
    evidenceRefs: accepted,
    rejectedRefs,
    droppedRefs,
    missing,
    missingTruncated,
    nextStrategy,
    requestedStrategy,
    forced: claimed !== sufficient || strategy !== requestedStrategy || nextStrategy !== strategy,
  }
}
