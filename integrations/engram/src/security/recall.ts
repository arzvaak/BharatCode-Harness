/**
 * Replace recalled-memory tool output in ingestion slices with placeholders to prevent
 * memory-to-ingestion feedback loops that reinforce existing memories. This is defensive:
 * collectTexts currently reads only user and assistant text, not tool results.
 * If ingestion expands later, recalled contents still cannot become new memories.
 * @module @kenz1117/dsh-engram/security/recall
 */

import type { SessionEventLike } from '../llm/client.ts'

/** Tools whose output includes existing memory contents that must not reinforce themselves. */
export const RECALL_TOOL_NAMES: ReadonlySet<string> = new Set(['engram_search', 'engram_review', 'engram_timeline'])

/** Determine whether a value names a recall tool. */
export function isRecallToolName(name: unknown): boolean {
  return typeof name === 'string' && RECALL_TOOL_NAMES.has(name)
}

/** Detect recall calls in an ingestion slice to trigger an explanatory annotation. */
export function hasRecallToolCalls(events: readonly SessionEventLike[]): boolean {
  return events.some(event => {
    if (event.type !== 'tool/call') return false
    return isRecallToolName((event.data as { name?: unknown } | null)?.name)
  })
}

/** Build a recall placeholder using the omitted-from-capture format. */
export function recallPlaceholder(name: unknown): string {
  return `[engram memory result omitted from capture: ${isRecallToolName(name) ? name : 'engram_memory'}]`
}

/**
 * Replace text blocks in recall-tool results with placeholders.
 * Resolve tool names through callId mappings built from tool/call events in the slice.
 * Preserve unmapped results and results from non-recall tools.
 * @param events - Readonly ingestion-slice events.
 * @returns Original array when no recall occurred, otherwise a transformed array.
 */
export function omitRecallToolResults(events: readonly SessionEventLike[]): readonly SessionEventLike[] {
  const callNames = new Map<string, string>()
  let hasRecall = false
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const data = event.data as { callId?: unknown; name?: unknown } | null
    if (typeof data?.callId === 'string' && typeof data.name === 'string') {
      callNames.set(data.callId, data.name)
      if (isRecallToolName(data.name)) hasRecall = true
    }
  }
  if (!hasRecall) return events
  return events.map(event => {
    if (event.type !== 'tool/result') return event
    const data = event.data as {
      callId?: unknown
      message?: { content?: { content?: { type?: unknown; text?: unknown }[] }[] } | null
    } | null
    const name = typeof data?.callId === 'string' ? callNames.get(data.callId) : undefined
    if (data === null || data === undefined || name === undefined || !isRecallToolName(name)) return event
    // message.content contains segments, each with its own content-block array.
    // Replace only text-block contents, retaining the surrounding structure.
    const message = data.message
    if (message === null || message === undefined) return event
    return {
      ...event,
      data: {
        ...data,
        message: {
          ...message,
          content: (message.content ?? []).map(segment => ({
            ...segment,
            content: (segment.content ?? []).map(block =>
              block?.type === 'text' ? { ...block, text: recallPlaceholder(name) } : block),
          })),
        },
      },
    }
  })
}
