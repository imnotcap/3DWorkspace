import { CATALOG, itemById } from '@/furniture/catalog'
import type { SceneObject, Vec3 } from '@/store/workspace'
import type { Vec2 } from './types'

/** The catalog entry an object came from (parametric piece or model). */
export const catalogItemOf = (o: Pick<SceneObject, 'furniture' | 'modelFile'>) => itemById(o.furniture?.item) ?? (o.modelFile ? CATALOG.find((c) => c.model?.file === o.modelFile) : undefined)

/** The object's size in metres as it stands (catalog size or measured mesh, times its scale). */
export function objectSize(o: SceneObject): Vec3 {
  const base: Vec3 = o.furniture?.size ?? o.stats?.size ?? catalogItemOf(o)?.size ?? [0.5, 0.5, 0.5]
  return [base[0] * o.transform.scale[0], base[1] * o.transform.scale[1], base[2] * o.transform.scale[2]]
}

/** Footprint on the plan: centre, size, yaw and the four corners (plan coordinates). */
export function footprint(o: SceneObject) {
  const [w, , d] = objectSize(o)
  const yaw = o.transform.rotation[1]
  const c: Vec2 = [o.transform.position[0], o.transform.position[2]]
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  // three.js yaw: local (x, z) → world (x cos + z sin, −x sin + z cos)
  const at = (lx: number, lz: number): Vec2 => [c[0] + lx * cos + lz * sin, c[1] - lx * sin + lz * cos]
  const corners = [at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)]
  return { c, w, d, yaw, corners, at }
}
