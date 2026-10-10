/**
 * Explain profile selection with heuristic recent, bright, corridor-hit, and strong-evidence labels.
 * Prepend an XML annotation so the agent knows why each memory was included.
 * Log model-visible rationale together with the profile contents.
 * @module @kenz1117/dsh-engram/selection-rationale
 */

import type { MemoryRecord } from './types.ts'

/** Selection reasons for a memory; multiple reasons may apply. */
export type Reason = 'recent' | 'bright' | 'corridor-hit' | 'strong-evidence'

/** Build selection-rationale XML; an empty record list returns an empty string. */
export function buildSelectionRationale(records: readonly MemoryRecord[]): string {
  if (records.length === 0) return ''
  const now = Date.now()
  const lines: string[] = [
    '<engram_selection_rationale>',
    `This profile contains ${String(records.length)} memories, selected for the following reasons:`,
    '',
  ]
  for (const record of records) {
    const reasons = classifyRecord(record, now)
    lines.push(`- #${record.id.slice(0, 8)} [${record.kind}/${record.scope}] ${reasonsLabel(reasons)}: ${record.content.slice(0, 40)}${record.content.length > 40 ? '…' : ''}`)
  }
  lines.push('', 'If a selection reason is incorrect, provide feedback through engram_report to improve profile accuracy.', '</engram_selection_rationale>')
  return lines.join('\n')
}

/** Combine profile contents with selection rationale for injection. */
export function wrapWithRationale(profileText: string, records: readonly MemoryRecord[]): string {
  const rationale = buildSelectionRationale(records)
  return rationale === '' ? profileText : `${rationale}\n\n${profileText}`
}

/** Classify four overlapping reasons using fixed heuristic thresholds. */
function classifyRecord(record: MemoryRecord, now: number): Reason[] {
  const reasons: Reason[] = []
  // recent: accessed within seven days
  if (now - record.lastAccessedAt < 7 * 86_400_000) reasons.push('recent')
  // bright: importance multiplied by confidence is at least 0.7
  if (record.importance * record.confidence >= 0.7) reasons.push('bright')
  // corridor-hit: at least five accesses
  if (record.accessCount >= 5) reasons.push('corridor-hit')
  // strong-evidence: reported successful use
  if (record.outcome === 'success') reasons.push('strong-evidence')
  return reasons
}

/** English display labels for stable reason identifiers. */
function reasonsLabel(reasons: readonly Reason[]): string {
  if (reasons.length === 0) return 'Baseline selection'
  const LABELS: Record<Reason, string> = {
    recent: 'Recently visited',
    bright: 'Bright landmark',
    'corridor-hit': 'Frequent corridor visitor',
    'strong-evidence': 'Verified useful',
  }
  return reasons.map(r => LABELS[r]).join(' / ')
}
