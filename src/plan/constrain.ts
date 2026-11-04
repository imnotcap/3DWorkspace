import type { Project, SceneObject, Transform } from '@/store/workspace'
import { clearOfWalls } from './collide'
import { catalogItemOf, objectSize } from './footprint'
import { analyse, type PlanGeom } from './geometry'
import type { Wall } from './types'

// Wall analysis per level, cached on the walls array (it only changes when the plan does).
const cache = new WeakMap<Wall[], Map<string, PlanGeom>>()
function geomFor(walls: Wall[], levelId: string) {
  let byLevel = cache.get(walls)
  if (!byLevel) cache.set(walls, (byLevel = new Map()))
  let g = byLevel.get(levelId)
  if (!g) byLevel.set(levelId, (g = analyse(walls.filter((w) => w.levelId === levelId))))
  return g
}

/** Pieces that are kept out of walls: top-level, not animated, with a known size; rugs lie under everything. */
function constrained(o: SceneObject) {
  if (o.parentId || o.keys?.length || o.furniture?.item === 'rug') return false
  return !!(o.furniture || o.stats?.size || catalogItemOf(o))
}

/**
 * The object's transform moved the shortest way out of any wall it cuts into (it may touch a
 * wall, never go inside one). Unchanged when it is clear, or for objects that aren't constrained.
 */
export function wallSafeTransform(project: Pick<Project, 'walls' | 'openings' | 'levels'>, o: SceneObject, t: Transform = o.transform): Transform {
  if (!constrained(o) || !project.walls.length) return t
  const level = project.levels.find((l) => l.id === o.levelId) ?? project.levels[0]
  if (!level) return t
  const geom = geomFor(project.walls, level.id)
  if (!geom.walls.size) return t
  const [w, h, d] = objectSize({ ...o, transform: t })
  const c = clearOfWalls({ c: [t.position[0], t.position[2]], w, d, yaw: t.rotation[1], y0: t.position[1], y1: t.position[1] + h }, geom.walls.values(), (g) => g.wall.height ?? level.height, project.openings)
  if (Math.abs(c[0] - t.position[0]) < 1e-9 && Math.abs(c[1] - t.position[2]) < 1e-9) return t
  return { ...t, position: [c[0], t.position[1], c[1]] }
}
