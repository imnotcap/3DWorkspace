import type { Level, RoomInfo, Vec2 } from './types'
import { pointInPolygon, type Face } from './geometry'

/** Floor heights follow from the levels below: each floor sits on its slab, on top of the one below. */
export function levelElevations(levels: Level[]): Map<string, number> {
  const out = new Map<string, number>()
  let y = 0
  levels.forEach((l, i) => {
    if (i > 0) y += l.slab
    out.set(l.id, y)
    y += l.height
  })
  return out
}

/** The saved settings (name, finishes) of the room a face is, matched by a point inside it. */
export function roomFor(face: Face, rooms: RoomInfo[], levelId: string): RoomInfo | undefined {
  return rooms.find((r) => r.levelId === levelId && pointInPolygon(r.anchor, face.polygon))
}

export const roomKey = (levelId: string, center: Vec2) => `${levelId}@${center[0].toFixed(2)},${center[1].toFixed(2)}`
