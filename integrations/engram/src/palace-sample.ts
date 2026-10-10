/**
 * Onboarding scaffold: add four example memories to an empty user palace.
 * Skip when active memories exist to avoid overwriting real data.
 * @module @kenz1117/dsh-engram/palace-sample
 */

import type { EngramStore } from './store/interface.ts'
import type { ImageryLabel } from './types.ts'

/** Four sample memories, one for each of four memory kinds. */
const SAMPLE_MEMORIES: readonly { kind: 'fact' | 'preference' | 'decision' | 'episode'; content: string; importance: number; imagery: ImageryLabel }[] = [
  {
    kind: 'preference',
    content: 'I prefer concise command-line interfaces and keyboard workflows over mouse clicks.',
    importance: 0.7,
    imagery: { caption: 'Turning bamboo pages', sensoryTags: ['Paper scent', 'Wooden desk'], emotionalValence: 0.4, provisional: false },
  },
  {
    kind: 'fact',
    content: 'My default platform is macOS, with zsh and oh-my-zsh for the shell and Neovim for editing.',
    importance: 0.6,
    imagery: { caption: 'Brushed aluminum machine', sensoryTags: ['Cool metal', 'Crisp keystrokes'], emotionalValence: 0.2, provisional: false },
  },
  {
    kind: 'decision',
    content: 'Since 2024, all my personal projects use TypeScript and pnpm workspaces for reliable collaboration across packages in a single repository.',
    importance: 0.8,
    imagery: { caption: 'White-painted chessboard', sensoryTags: ['Cool glaze'], emotionalValence: 0.3, provisional: false },
  },
  {
    kind: 'episode',
    content: 'I first finished reading The Memory Palace in a library corner during secondary school, with rain outside the window.',
    importance: 0.5,
    imagery: { caption: 'Rain window and bronze bell', sensoryTags: ['Bell ringing', 'Damp air'], emotionalValence: 0.7, provisional: false },
  },
]

/**
 * Write four examples when the user palace has no active memories, returning their identifiers.
 * Otherwise return an empty array without overwriting existing entries.
 */
export async function initPalaceSample(store: EngramStore): Promise<readonly string[]> {
  const stats = await store.stats()
  if (stats.active > 0) return []
  const ids: string[] = []
  for (const memory of SAMPLE_MEMORIES) {
    const record = await store.write({
      scope: 'user',
      kind: memory.kind,
      content: memory.content,
      importance: memory.importance,
      sourceSessionId: null,
      imagery: memory.imagery,
    })
    ids.push(record.id)
  }
  return ids
}