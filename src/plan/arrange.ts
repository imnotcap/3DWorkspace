// Smart placement: a piece put down near something it belongs with is turned (and moved) the way
// it would really stand. A chair is pulled up to the nearest side of a table, facing it, slid along
// so it doesn't overlap the chairs already there; a nightstand goes beside the head of a bed; a
// coffee table in front of the sofa; a pendant over the table; a range hood over the hob…
import { roleOf, type CatalogItem } from '@/furniture/catalog'
import type { SceneObject, Vec3 } from '@/store/workspace'
import { catalogItemOf, footprint } from './footprint'
import type { Vec2 } from './types'

export interface Arranged {
  c: Vec2
  yaw: number
  /** What it was arranged against (shown while placing). */
  label: string
}

type Fp = ReturnType<typeof footprint> & { o: SceneObject; id: string }

const SOFAS = ['sofa', 'loveseat', 'glam-sofa', 'leather-sofa']
const BEDS = ['bed-double', 'bed-single']

/** How a piece relates to others: which it goes with, and how. */
const RULES: Record<string, { to: string[]; how: 'pull-up' | 'bedside' | 'in-front' | 'beside' | 'over' | 'under' | 'face'; tuck?: number }[]> = {
  'dining-chair': [{ to: ['dining-table', 'round-table', 'kitchen-island', 'desk', 'sit-stand-desk'], how: 'pull-up', tuck: 0.1 }],
  'damask-chair': [{ to: ['dining-table', 'round-table', 'desk'], how: 'pull-up', tuck: 0.08 }],
  'bar-stool': [{ to: ['kitchen-island', 'dining-table', 'round-table'], how: 'pull-up', tuck: 0.16 }],
  'office-chair': [{ to: ['desk', 'sit-stand-desk', 'dining-table'], how: 'pull-up', tuck: 0.14 }],
  nightstand: [{ to: BEDS, how: 'bedside' }],
  'side-table': [{ to: [...SOFAS, 'armchair', 'sheen-chair', ...BEDS], how: 'beside' }],
  'floor-lamp': [{ to: [...SOFAS, 'armchair', 'sheen-chair'], how: 'beside' }],
  'coffee-table': [{ to: SOFAS, how: 'in-front' }],
  'silk-pouf': [{ to: SOFAS, how: 'in-front' }],
  pendant: [{ to: ['dining-table', 'round-table', 'kitchen-island'], how: 'over' }],
  'barn-lamp': [{ to: ['dining-table', 'round-table', 'kitchen-island'], how: 'over' }],
  'range-hood': [{ to: ['hob-cabinet'], how: 'over' }],
  mirror: [{ to: ['vanity'], how: 'over' }],
  'wall-cabinet': [{ to: ['base-cabinet', 'drawer-cabinet', 'sink-cabinet', 'hob-cabinet'], how: 'over' }],
  tv: [{ to: ['tv-unit'], how: 'over' }],
  rug: [{ to: ['dining-table', 'round-table'], how: 'under' }, { to: SOFAS, how: 'under' }, { to: BEDS, how: 'under' }],
  armchair: [{ to: ['coffee-table', ...SOFAS, 'tv-unit', 'tv'], how: 'face' }],
  'sheen-chair': [{ to: ['coffee-table', ...SOFAS, 'tv-unit', 'tv'], how: 'face' }],
  sofa: [{ to: ['coffee-table', 'tv-unit', 'tv'], how: 'face' }],
  loveseat: [{ to: ['coffee-table', 'tv-unit', 'tv'], how: 'face' }],
  'glam-sofa': [{ to: ['coffee-table', 'tv-unit', 'tv'], how: 'face' }],
  'leather-sofa': [{ to: ['coffee-table', 'tv-unit', 'tv'], how: 'face' }],
  'tv-unit': [{ to: SOFAS, how: 'face' }],
}

const yawFacing = (dir: Vec2) => Math.atan2(dir[0], dir[1])

/** The piece's own axes on the plan: right (local +x) and front (local +z). */
const axes = (yaw: number): { right: Vec2; front: Vec2 } => ({ right: [Math.cos(yaw), -Math.sin(yaw)], front: [Math.sin(yaw), Math.cos(yaw)] })
const local = (f: Fp, p: Vec2) => {
  const { right, front } = axes(f.yaw)
  const v: Vec2 = [p[0] - f.c[0], p[1] - f.c[1]]
  return { x: v[0] * right[0] + v[1] * right[1], z: v[0] * front[0] + v[1] * front[1] }
}
const fromLocal = (f: Fp, x: number, z: number): Vec2 => {
  const { right, front } = axes(f.yaw)
  return [f.c[0] + right[0] * x + front[0] * z, f.c[1] + right[1] * x + front[1] * z]
}
/** Distance from p to the piece's footprint (0 inside). */
const distTo = (f: Fp, p: Vec2) => {
  const l = local(f, p)
  return Math.hypot(Math.max(0, Math.abs(l.x) - f.w / 2), Math.max(0, Math.abs(l.z) - f.d / 2))
}

/**
 * Where and how to stand `item` (size `size`) put down at `p`, given the pieces already there
 * (`objects`, on the same floor, not including itself). Null: nothing near it belongs with it.
 */
export function arrange(item: CatalogItem, size: Vec3, p: Vec2, objects: SceneObject[], opts: { wallSnapped?: boolean } = {}): Arranged | null {
  const rules = RULES[roleOf(item)]
  if (!rules) return null
  const fps: Fp[] = objects
    .filter((o) => !o.parentId && o.visible !== false)
    .map((o) => {
      const it = catalogItemOf(o)
      return { ...footprint(o), o, id: it ? roleOf(it) : '' }
    })
  const [w, , d] = size
  for (const r of rules) {
    const near = fps.filter((f) => r.to.includes(f.id)).sort((a, b) => distTo(a, p) - distTo(b, p))
    const f = near[0]
    if (!f) continue
    const gap = distTo(f, p)
    const name = catalogItemOf(f.o)?.name.toLowerCase() ?? 'it'

    if (r.how === 'pull-up' && gap < 0.9) {
      const tuck = r.tuck ?? 0.1
      // Round tables: around the rim, facing the middle.
      if (f.id === 'round-table') {
        const v: Vec2 = [p[0] - f.c[0], p[1] - f.c[1]]
        const l = Math.hypot(v[0], v[1]) || 1
        const u: Vec2 = [v[0] / l, v[1] / l]
        const R = f.w / 2 + d / 2 - tuck
        return { c: [f.c[0] + u[0] * R, f.c[1] + u[1] * R], yaw: yawFacing([-u[0], -u[1]]), label: `At the ${name}` }
      }
      // The nearest side: along it, clear of the chairs already there.
      const l = local(f, p)
      const side = Math.abs(l.x) / (f.w / 2) > Math.abs(l.z) / (f.d / 2) ? 'x' : 'z'
      const sgn = Math.sign(side === 'x' ? l.x : l.z) || 1
      const half = side === 'x' ? f.d / 2 : f.w / 2
      const out = (side === 'x' ? f.w / 2 : f.d / 2) + d / 2 - tuck
      const lim = Math.max(0, half - w / 2 - 0.02)
      const at = (s: number): Vec2 => (side === 'x' ? fromLocal(f, sgn * out, s) : fromLocal(f, s, sgn * out))
      const others = fps.filter((o) => ['dining-chair', 'damask-chair', 'bar-stool', 'office-chair'].includes(o.id))
      const free = (q: Vec2) => others.every((o) => Math.hypot(o.c[0] - q[0], o.c[1] - q[1]) > Math.max(w, o.w) * 0.95)
      const s0 = Math.max(-lim, Math.min(lim, side === 'x' ? l.z : l.x))
      let s = s0
      for (let k = 1; !free(at(s)) && k < 12; k++) {
        const step = (Math.ceil(k / 2) * (w + 0.06)) * (k % 2 ? 1 : -1)
        if (Math.abs(s0 + step) <= lim + 1e-6) s = s0 + step
      }
      const n = axes(f.yaw)
      const outward: Vec2 = side === 'x' ? [n.right[0] * sgn, n.right[1] * sgn] : [n.front[0] * sgn, n.front[1] * sgn]
      return { c: at(s), yaw: yawFacing([-outward[0], -outward[1]]), label: `At the ${name}` }
    }

    if (r.how === 'bedside' && gap < 1.0) {
      const l = local(f, p)
      const sgn = Math.sign(l.x) || 1
      // At the head end (the bed's back), beside it, facing the same way.
      return { c: fromLocal(f, sgn * (f.w / 2 + w / 2 + 0.04), -f.d / 2 + d / 2 + 0.02), yaw: f.yaw, label: `Beside the ${name}` }
    }

    if (r.how === 'beside' && gap < 0.8) {
      const l = local(f, p)
      const sgn = Math.sign(l.x) || 1
      return { c: fromLocal(f, sgn * (f.w / 2 + w / 2 + 0.06), Math.max(-f.d / 2 + d / 2, Math.min(f.d / 2 - d / 2, l.z))), yaw: f.yaw, label: `Beside the ${name}` }
    }

    if (r.how === 'in-front') {
      const l = local(f, p)
      if (l.z > 0 && gap < 1.4) return { c: fromLocal(f, 0, f.d / 2 + 0.42 + d / 2), yaw: f.yaw, label: `In front of the ${name}` }
    }

    if (r.how === 'over' && gap < 0.6) {
      // Lamps over the middle; hoods, mirrors, TVs and wall cabinets over the piece, flush at its back.
      if (item.mount === 'ceiling') return { c: f.c, yaw: f.yaw, label: `Over the ${name}` }
      const l = local(f, p)
      const along = item.id === 'wall-cabinet' ? Math.max(-f.w / 2, Math.min(f.w / 2, l.x)) : 0
      const z = item.id === 'tv' ? 0 : -f.d / 2 + d / 2
      return { c: fromLocal(f, along, z), yaw: f.yaw, label: `Over the ${name}` }
    }

    if (r.how === 'under' && gap < 0.6) {
      if (BEDS.includes(f.id)) return { c: fromLocal(f, 0, f.d * 0.2), yaw: f.yaw, label: `Under the ${name}` }
      if (SOFAS.includes(f.id)) return { c: fromLocal(f, 0, f.d / 2 + 0.55), yaw: f.yaw, label: `In front of the ${name}` }
      return { c: f.c, yaw: f.yaw, label: `Under the ${name}` }
    }

    if (r.how === 'face' && !opts.wallSnapped && gap < 3.5 && gap > 0.2) {
      return { c: p, yaw: yawFacing([f.c[0] - p[0], f.c[1] - p[1]]), label: `Facing the ${name}` }
    }
  }
  return null
}
