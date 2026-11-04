// Keeps furniture out of walls. Pure maths (type-only imports) so it is unit-tested with Node directly.
import type { WallGeom } from './geometry'
import type { Opening, Vec2 } from './types'

/** A piece as it stands: footprint centre, size along its own axes, yaw (three.js), and its height range. */
export interface Body {
  c: Vec2
  w: number
  d: number
  yaw: number
  y0: number
  y1: number
}

/** How close a piece may come to a wall face: touching, never inside it (no z-fighting). */
export const WALL_GAP = 0.003

/** Footprint corners (same convention as plan/footprint.ts). */
export function corners(b: Body): Vec2[] {
  const cos = Math.cos(b.yaw)
  const sin = Math.sin(b.yaw)
  const at = (lx: number, lz: number): Vec2 => [b.c[0] + lx * cos + lz * sin, b.c[1] - lx * sin + lz * cos]
  return [at(-b.w / 2, -b.d / 2), at(b.w / 2, -b.d / 2), at(b.w / 2, b.d / 2), at(-b.w / 2, b.d / 2)]
}

const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]

function axes(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const L = Math.hypot(ex, ey)
    if (L > 1e-9) out.push([-ey / L, ex / L])
  }
  return out
}

function project(poly: Vec2[], axis: Vec2) {
  let min = Infinity
  let max = -Infinity
  for (const p of poly) {
    const v = dot(p, axis)
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max }
}

/**
 * Separating-axis test between two convex polygons. Returns the shortest push that moves `a`
 * clear of `b` by `gap`, or null when they are already that far apart.
 */
export function pushOut(a: Vec2[], b: Vec2[], gap = WALL_GAP): Vec2 | null {
  let best: { depth: number; axis: Vec2 } | null = null
  for (const axis of [...axes(a), ...axes(b)]) {
    const pa = project(a, axis)
    const pb = project(b, axis)
    // Overlap along this axis, counting the gap as part of the wall.
    const right = pb.max + gap - pa.min // push a towards +axis
    const left = pa.max - (pb.min - gap) // push a towards -axis
    if (right <= 1e-9 || left <= 1e-9) return null
    const depth = Math.min(right, left)
    if (!best || depth < best.depth) best = { depth, axis: right < left ? axis : [-axis[0], -axis[1]] }
  }
  return best ? [best.axis[0] * best.depth, best.axis[1] * best.depth] : null
}

/** The wall's solid footprint at the piece's height, or null where an opening lets it through. */
function blocks(g: WallGeom, wallTop: number, body: Body, pts: Vec2[], openings: Opening[]) {
  if (body.y0 >= wallTop - 1e-4 || body.y1 <= 1e-4) return false
  // Entirely within a doorway or a window's hole (along the wall and in height): no wall there.
  let u0 = Infinity
  let u1 = -Infinity
  for (const p of pts) {
    const u = (p[0] - g.wall.a[0]) * g.d[0] + (p[1] - g.wall.a[1]) * g.d[1]
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
  }
  for (const o of openings) {
    if (o.wallId !== g.wall.id) continue
    const inside = u0 >= o.t - o.width / 2 && u1 <= o.t + o.width / 2 && body.y0 >= o.sill - 1e-4 && body.y1 <= o.sill + o.height + 1e-4
    if (inside) return false
  }
  return true
}

/**
 * Move a piece the shortest way out of every wall it cuts into, so it can stand against a wall
 * (or in a corner) but never inside one. Returns the new centre (unchanged if it was clear).
 */
export function clearOfWalls(body: Body, walls: Iterable<WallGeom>, wallHeight: (g: WallGeom) => number, openings: Opening[] = []): Vec2 {
  const list = [...walls]
  let c: Vec2 = [body.c[0], body.c[1]]
  for (let pass = 0; pass < 8; pass++) {
    const pts = corners({ ...body, c })
    let deepest: Vec2 | null = null
    for (const g of list) {
      if (!blocks(g, wallHeight(g), body, pts, openings)) continue
      const push = pushOut(pts, [g.la, g.lb, g.rb, g.ra])
      if (push && (!deepest || Math.hypot(...push) > Math.hypot(...deepest))) deepest = push
    }
    if (!deepest) break
    c = [c[0] + deepest[0], c[1] + deepest[1]]
  }
  return c
}
