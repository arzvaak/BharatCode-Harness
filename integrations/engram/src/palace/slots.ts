/**
 * Assign memories to permanent palace locations using the method of loci.
 * Map kinds to default rooms; each room holds nine memories and expands with numbered suffixes.
 * Slot indices only increase; removed memories leave empty locations rather than relocating others.
 * @module @kenz1117/dsh-engram/palace/slots
 */

import type { EngramKind, Slot } from '../types.ts'

/** Room capacity follows the upper end of the 7-plus-or-minus-2 working-memory guideline. */
export const ROOM_CAPACITY = 9

/** Stable persisted kind-to-room identifiers keep memories of the same theme together. */
export const KIND_ROOMS: Readonly<Record<EngramKind, string>> = {
  fact: '事实厅',
  preference: '偏好阁',
  decision: '决策堂',
  episode: '往事廊',
  skill: '技法坊',
}

/** Occupancy snapshot for one room from slotCountsByRoom. */
export interface RoomOccupancy {
  /** Occupied locations excluding forgotten memories, which immediately free capacity. */
  readonly count: number
  /** Largest allocated index, including empty locations, determines the next index. */
  readonly maxIndex: number
}

/**
 * Allocate a location for a new memory.
 * @param kind - Memory kind, which determines its default room.
 * @param occupancy - Snapshot from store.slotCountsByRoom().
 * @returns Location and whether expansion opened a new room; callers may log naming/splitting guidance.
 */
export function assignSlot(
  kind: EngramKind,
  occupancy: Readonly<Record<string, RoomOccupancy>>,
): { slot: Slot; openedNewRoom: boolean } {
  const base = KIND_ROOMS[kind]
  // Find the first non-full room in the base, base-2, base-3 sequence.
  for (let n = 1; ; n += 1) {
    const room = n === 1 ? base : `${base}-${n}`
    const state = occupancy[room]
    if (state === undefined) {
      // A missing base room is first use; a missing numbered room extends full predecessors.
      return { slot: { room, index: 1 }, openedNewRoom: n > 1 }
    }
    if (state.count < ROOM_CAPACITY) {
      // Use maxIndex+1, not count+1: never recycle forgotten locations or change their stable meaning.
      return { slot: { room, index: state.maxIndex + 1 }, openedNewRoom: false }
    }
  }
}
