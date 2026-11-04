// Editing operations on the plan (pure functions over plan data).
import { add, dist, dot, len, mul, norm, projectOnSegment, projectOnWall, sub, type WallGeom } from './geometry'
import type { Opening, Vec2, Wall } from './types'

const EP = 2e-3

export const same = (a: Vec2, b: Vec2) => dist(a, b) < EP

/** Move every wall end at `from` (on this level) to `to`: connected walls follow. */
export function moveEndpoints(walls: Wall[], levelId: string, from: Vec2, to: Vec2): Wall[] {
  return walls.map((w) => (w.levelId !== levelId ? w : same(w.a, from) ? { ...w, a: to, ...(same(w.b, from) ? { b: to } : {}) } : same(w.b, from) ? { ...w, b: to } : w))
}

/**
 * Move a whole wall by `delta`. Walls joined to its ends follow (they stretch), and walls that
 * end on it (T-joints) slide with it, so the plan stays connected.
 */
export function moveWall(original: Wall[], id: string, delta: Vec2): Wall[] {
  const w = original.find((x) => x.id === id)
  if (!w) return original
  const moved = (p: Vec2) => add(p, delta)
  const onWall = (p: Vec2) => {
    const pr = projectOnSegment(p, w.a, w.b)
    return pr.dist < EP && pr.t > 1e-3 && pr.t < 1 - 1e-3
  }
  return original.map((x) => {
    if (x.levelId !== w.levelId) return x
    if (x.id === id) return { ...x, a: moved(x.a), b: moved(x.b) }
    const a = same(x.a, w.a) || same(x.a, w.b) || onWall(x.a) ? moved(x.a) : x.a
    const b = same(x.b, w.a) || same(x.b, w.b) || onWall(x.b) ? moved(x.b) : x.b
    return a === x.a && b === x.b ? x : { ...x, a, b }
  })
}

/** Is segment a–b already covered by an existing wall (collinear)? */
function covered(a: Vec2, b: Vec2, walls: Wall[]) {
  return walls.some((w) => projectOnSegment(a, w.a, w.b).dist < EP && projectOnSegment(b, w.a, w.b).dist < EP)
}

/** Four walls around a rectangle (skipping sides that already have a wall). */
export function rectWalls(p0: Vec2, p1: Vec2, thickness: number, levelId: string, existing: Wall[], uid: () => string): Wall[] {
  const x0 = Math.min(p0[0], p1[0])
  const x1 = Math.max(p0[0], p1[0])
  const y0 = Math.min(p0[1], p1[1])
  const y1 = Math.max(p0[1], p1[1])
  if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return []
  const c: Vec2[] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
  const level = existing.filter((w) => w.levelId === levelId)
  return c
    .map((a, i) => [a, c[(i + 1) % 4]] as const)
    .filter(([a, b]) => !covered(a, b, level))
    .map(([a, b]) => ({ id: uid(), levelId, a, b, thickness }))
}

export interface SnapResult {
  p: Vec2
  /** Alignment guides to draw (x = vertical line, y = horizontal line). */
  guideX?: number
  guideY?: number
  kind: 'endpoint' | 'wall' | 'grid' | 'free'
}

/**
 * Snap a pointer position: to wall ends, onto walls (T-joints), to alignment with other ends,
 * then to the grid. From a previous point, angles snap to 15° unless `free`.
 */
export function snapPoint(p: Vec2, o: { walls: Wall[]; grid: number; pxPerM: number; from?: Vec2 | null; free?: boolean }): SnapResult {
  const tol = 12 / o.pxPerM
  let best: { d: number; p: Vec2 } | null = null
  for (const w of o.walls)
    for (const e of [w.a, w.b]) {
      const d = dist(p, e)
      if (d < tol && (!best || d < best.d)) best = { d, p: e }
    }
  if (best) return { p: best.p, kind: 'endpoint' }
  if (o.free) return { p, kind: 'free' }

  let q: Vec2 = p
  if (o.from) {
    const v = sub(p, o.from)
    const L = len(v)
    if (L > 1e-6) {
      const step = Math.PI / 12
      const ang = Math.round(Math.atan2(v[1], v[0]) / step) * step
      const Ls = Math.max(o.grid, Math.round(L / o.grid) * o.grid)
      q = add(o.from, [Math.cos(ang) * Ls, Math.sin(ang) * Ls])
      // Clean up floating point on axis-aligned walls.
      q = [Math.round(q[0] * 1e4) / 1e4, Math.round(q[1] * 1e4) / 1e4]
    }
  } else q = [Math.round(p[0] / o.grid) * o.grid, Math.round(p[1] / o.grid) * o.grid]

  // Onto an existing wall (a T-joint). Curved walls only join at their ends.
  for (const w of o.walls) {
    if (w.curve) continue
    const pr = projectOnSegment(q, w.a, w.b)
    if (pr.dist < tol * 0.8 && pr.t > 0.01 && pr.t < 0.99) {
      if (!o.from) return { p: pr.point, kind: 'wall' }
      // Keep the snapped angle: intersect the drawing direction with the wall.
      const dir = norm(sub(q, o.from))
      const wd = sub(w.b, w.a)
      const den = dir[0] * wd[1] - dir[1] * wd[0]
      if (Math.abs(den) > 1e-6) {
        const t = ((w.a[0] - o.from[0]) * wd[1] - (w.a[1] - o.from[1]) * wd[0]) / den
        if (t > 0) return { p: add(o.from, mul(dir, t)), kind: 'wall' }
      }
      return { p: pr.point, kind: 'wall' }
    }
  }

  // Alignment with other wall ends.
  let guideX: number | undefined
  let guideY: number | undefined
  if (!o.from || Math.abs(q[0] - o.from[0]) > 1e-6) {
    for (const w of o.walls)
      for (const e of [w.a, w.b])
        if (Math.abs(e[0] - q[0]) < tol * 0.6 && (!o.from || Math.abs(o.from[0] - q[0]) > tol)) {
          q = [e[0], q[1]]
          guideX = e[0]
        }
  }
  if (!o.from || Math.abs(q[1] - o.from[1]) > 1e-6) {
    for (const w of o.walls)
      for (const e of [w.a, w.b])
        if (Math.abs(e[1] - q[1]) < tol * 0.6 && (!o.from || Math.abs(o.from[1] - q[1]) > tol)) {
          q = [q[0], e[1]]
          guideY = e[1]
        }
  }
  return { p: q, guideX, guideY, kind: 'grid' }
}

/** The wall nearest to `p` (within `max` metres): distance along it and which side `p` is on. */
export function nearestWall(p: Vec2, walls: Wall[], max: number) {
  let best: { wall: Wall; t: number; dist: number; side: 'left' | 'right'; len: number } | null = null
  for (const w of walls) {
    // Along the wall, following its curve: `t` and `len` are arc lengths on curved walls.
    const pr = projectOnWall(p, w)
    if (pr.dist > max || (best && pr.dist >= best.dist)) continue
    best = { wall: w, t: pr.s, dist: pr.dist, side: pr.side, len: pr.len }
  }
  return best
}

/**
 * Turn the walls between corners `a` and `c` into one curved wall bowing out by `curve`:
 * an existing wall a–c is bent; two walls a–b–c (a corner) are replaced by one rounded wall;
 * otherwise a new curved wall is drawn. Doors and windows on replaced walls are dropped.
 */
export function roundBetween(walls: Wall[], openings: Opening[], levelId: string, a: Vec2, c: Vec2, curve: number, thickness: number, uid: () => string): { walls: Wall[]; openings: Opening[]; id: string } {
  const level = walls.filter((w) => w.levelId === levelId)
  const direct = level.find((w) => (same(w.a, a) && same(w.b, c)) || (same(w.a, c) && same(w.b, a)))
  if (direct) {
    const sign = same(direct.a, a) ? 1 : -1
    return { walls: walls.map((w) => (w === direct ? { ...w, curve: curve * sign } : w)), openings, id: direct.id }
  }
  const touching = (p: Vec2) => level.filter((w) => !w.curve && (same(w.a, p) || same(w.b, p)))
  const other = (w: Wall, p: Vec2) => (same(w.a, p) ? w.b : w.a)
  for (const wa of touching(a))
    for (const wc of touching(c)) {
      if (wa === wc || !same(other(wa, a), other(wc, c))) continue
      const gone = new Set([wa.id, wc.id])
      const wall: Wall = { id: uid(), levelId, a, b: c, thickness: wa.thickness, height: wa.height, curve, paint: wa.paint }
      return { walls: [...walls.filter((w) => !gone.has(w.id)), wall], openings: openings.filter((o) => !gone.has(o.wallId)), id: wall.id }
    }
  const wall: Wall = { id: uid(), levelId, a, b: c, thickness, curve }
  return { walls: [...walls, wall], openings, id: wall.id }
}

/**
 * Put a piece with its back against the nearest wall face (if one is close): returns the
 * centre and yaw so its front faces into the room.
 */
export function snapToWall(p: Vec2, depth: number, geoms: Iterable<WallGeom>, max = 0.45): { c: Vec2; yaw: number } | null {
  let best: { c: Vec2; yaw: number; d: number } | null = null
  for (const g of geoms) {
    const pr = projectOnSegment(p, g.wall.a, g.wall.b)
    if (pr.t <= 0 || pr.t >= 1) continue
    const s = dot(sub(p, pr.point), g.n) >= 0 ? 1 : -1
    const face = add(pr.point, mul(g.n, s * g.h))
    const gap = Math.abs(dot(sub(p, face), g.n)) - depth / 2
    if (gap > max || (best && gap >= best.d)) continue
    const nf = mul(g.n, s)
    best = { c: add(face, mul(nf, depth / 2 + 0.005)), yaw: Math.atan2(nf[0], nf[1]), d: gap }
  }
  return best ? { c: best.c, yaw: best.yaw } : null
}
