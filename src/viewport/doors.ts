// Doors in the walkthrough: shut, and opening as the camera comes up to them (see tourDoorsAt).
// The leaves are moved in place (no rebuild of the house); outside the tour they stand as the plan has them.
import type { Object3D } from 'three'
import type { DoorPart } from '@/plan/build'
import { tourDistance, tourDoorCrossings, tourDoorsAt, tourPath } from '@/plan/tour'
import type { Project } from '@/store/workspace'

/** Set every door leaf under `root`: `open(id)` (0..1), or the plan's own value when it gives null. */
export function applyDoors(root: Object3D, open: (id: string) => number | null) {
  root.traverse((o) => {
    const d = o.userData.door as DoorPart | undefined
    if (!d) return
    const v = open(d.id) ?? d.base
    if (d.swing !== undefined) o.rotation.y = d.swing * v
    if (d.slide) o.position.x = d.slide[0] + d.slide[1] * v
  })
}

/** How open each door is at `frame` of the tour (every door not listed is shut). */
export function doorsAtFrame(p: Project, frame: number): Map<string, number> {
  const path = tourPath(p)
  const s = tourDistance(p, frame - p.animation.start, p.animation.fps, path)
  return tourDoorsAt(tourDoorCrossings(p, path), s)
}

/** A short key of the doors' state at a frame (to know when the path tracer must re-bake). */
export const doorsKey = (m: Map<string, number>) => [...m].map(([id, v]) => `${id}:${v.toFixed(3)}`).join('|')
