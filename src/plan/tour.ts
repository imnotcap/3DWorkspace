// Walkthrough tours: a smooth path through the rooms, and the camera pose at any frame.
import type { CameraPose, Project } from '@/store/workspace'
import { analyse, add, dist, mul, pieceAt, pointInPolygon, type Face } from './geometry'
import { levelElevations } from './levels'
import { OPENING_DEFAULTS, type Tour, type TourPoint, type Vec2 } from './types'

type P3 = [number, number, number]

/** Centripetal Catmull–Rom through the tour points, sampled into a polyline with arc lengths. */
export function tourPath(project: Pick<Project, 'tour' | 'levels'>) {
  const elev = levelElevations(project.levels)
  const pts: P3[] = project.tour.points.map((p) => [p.p[0], (elev.get(p.levelId) ?? 0) + project.tour.eyeHeight, p.p[1]])
  const line: P3[] = []
  if (pts.length < 2) return { line: pts, cum: pts.map(() => 0), length: 0 }
  const P = [pts[0], ...pts, pts[pts.length - 1]]
  for (let i = 1; i + 2 < P.length; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]]
    const steps = Math.max(12, Math.ceil(dist3(p1, p2) / 0.02))
    for (let k = 0; k < steps; k++) line.push(catmull(p0, p1, p2, p3, k / steps))
  }
  line.push(pts[pts.length - 1])
  const cum = [0]
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist3(line[i - 1], line[i]))
  return { line, cum, length: cum[cum.length - 1] }
}

const dist3 = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function catmull(p0: P3, p1: P3, p2: P3, p3: P3, t: number): P3 {
  // Centripetal parameterisation (alpha = 0.5): no loops or overshoot at sharp corners.
  const tj = (a: P3, b: P3, ti: number) => ti + Math.max(1e-4, Math.sqrt(dist3(a, b)))
  const t0 = 0
  const t1 = tj(p0, p1, t0)
  const t2 = tj(p1, p2, t1)
  const t3 = tj(p2, p3, t2)
  const u = t1 + (t2 - t1) * t
  const L = (a: P3, b: P3, ta: number, tb: number): P3 => {
    const k = tb - ta < 1e-9 ? 0 : (u - ta) / (tb - ta)
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
  }
  const A1 = L(p0, p1, t0, t1)
  const A2 = L(p1, p2, t1, t2)
  const A3 = L(p2, p3, t2, t3)
  const B1 = L(A1, A2, t0, t2)
  const B2 = L(A2, A3, t1, t3)
  return L(B1, B2, t1, t2)
}

function at(path: ReturnType<typeof tourPath>, s: number): P3 {
  const { line, cum } = path
  if (s <= 0) return line[0]
  if (s >= path.length) return line[line.length - 1]
  let lo = 0
  let hi = cum.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (cum[m] <= s) lo = m
    else hi = m
  }
  const k = (s - cum[lo]) / (cum[hi] - cum[lo] || 1)
  const a = line[lo]
  const b = line[hi]
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

/** Seconds for the whole walk: constant speed with a gentle start and stop. */
export function tourDuration(tour: Tour, length: number) {
  const ramp = Math.min(1.5, length / tour.speed / 3)
  return length / tour.speed + ramp
}

export function tourFrames(project: Pick<Project, 'tour' | 'levels'>, fps: number) {
  const path = tourPath(project)
  return Math.max(2, Math.ceil(tourDuration(project.tour, path.length) * fps) + 1)
}

/** Camera at frame `frame` of the walk: eye height, looking ahead along the path. */
export function tourPose(project: Pick<Project, 'tour' | 'levels'>, frame: number, fps: number, path = tourPath(project)): CameraPose {
  const v = project.tour.speed
  const T = tourDuration(project.tour, path.length)
  const ta = Math.min(1.5, path.length / v / 3)
  const t = Math.max(0, Math.min(T, frame / fps))
  const s = t < ta ? (0.5 * v * t * t) / ta : t > T - ta ? path.length - (0.5 * v * (T - t) * (T - t)) / ta : 0.5 * v * ta + v * (t - ta)
  const pos = at(path, s)
  // Heading: the path's direction averaged over the next ~2 m (Gaussian weights), so the camera
  // turns into corners gently instead of snapping to each bend, like a steadicam operator.
  let fx = 0
  let fz = 0
  const span = Math.min(2.2, Math.max(0.2, path.length * 0.5))
  for (let k = 0; k <= 16; k++) {
    const d = (k / 16) * span
    const u = Math.max(0.03, Math.min(path.length - 0.03, s + d))
    const p0 = at(path, u - 0.03)
    const p1 = at(path, u + 0.03)
    const tx = p1[0] - p0[0]
    const tz = p1[2] - p0[2]
    const tl = Math.hypot(tx, tz) || 1
    const w = Math.exp(-((d / span - 0.25) ** 2) / 0.12)
    fx += (tx / tl) * w
    fz += (tz / tl) * w
  }
  const fl = Math.hypot(fx, fz) || 1
  fx /= fl
  fz /= fl
  // Look slightly down (about 6°) like a person walking through.
  const fy = -0.1
  const n = Math.hypot(fx, fy, fz)
  const f: P3 = [fx / n, fy / n, fz / n]
  const target: P3 = [pos[0] + f[0], pos[1] + f[1], pos[2] + f[2]]
  return { target, radius: 1, polar: Math.acos(-f[1]), azimuth: Math.atan2(-f[0], -f[2]), focal: project.tour.focal }
}

/**
 * A tour of a level that walks through every room it can reach, room to room through the doors
 * (starting at the front door if there is one), pausing in the middle of each room.
 */
export function autoTour(project: Project, levelId: string, uid: () => string): { points: TourPoint[]; doors: string[] } {
  const walls = project.walls.filter((w) => w.levelId === levelId)
  const geom = analyse(walls)
  const faces = geom.faces
  if (!faces.length) return { points: [], doors: [] }
  type Door = { id: string; a: number | null; b: number | null; c: Vec2; n: Vec2 }
  const doors: Door[] = []
  for (const o of project.openings) {
    if (!OPENING_DEFAULTS[o.kind].door && o.kind !== 'french-window') continue
    const at = pieceAt(geom, o.wallId, o.t)
    if (!at) continue
    const { g, u } = at
    const seg = g.segments.find((s) => u >= s.u0 - 1e-6 && u <= s.u1 + 1e-6)
    if (!seg) continue
    doors.push({ id: o.id, a: seg.left, b: seg.right, c: add(g.wall.a, mul(g.d, u)), n: g.n })
  }
  const adj = new Map<number, { to: number; door: Door }[]>()
  for (const d of doors)
    if (d.a !== null && d.b !== null) {
      adj.set(d.a, [...(adj.get(d.a) ?? []), { to: d.b, door: d }])
      adj.set(d.b, [...(adj.get(d.b) ?? []), { to: d.a, door: d }])
    }
  const entrance = doors.find((d) => (d.a === null) !== (d.b === null))
  const largest = faces.reduce((x: Face, y: Face) => (y.area > x.area ? y : x)).index
  const start = entrance ? (entrance.a ?? entrance.b)! : largest

  // Visit order: depth-first from the start, nearest doors first.
  const order: number[] = []
  const seen = new Set<number>()
  const dfs = (f: number) => {
    seen.add(f)
    order.push(f)
    for (const e of (adj.get(f) ?? []).slice().sort((x, y) => dist(x.door.c, faces[f].center) - dist(y.door.c, faces[f].center))) if (!seen.has(e.to)) dfs(e.to)
  }
  dfs(start)

  const route = (from: number, to: number) => {
    const prev = new Map<number, { f: number; door: Door }>()
    const q = [from]
    const vis = new Set([from])
    while (q.length) {
      const f = q.shift()!
      if (f === to) break
      for (const e of adj.get(f) ?? []) if (!vis.has(e.to)) (vis.add(e.to), prev.set(e.to, { f, door: e.door }), q.push(e.to))
    }
    const steps: { from: number; door: Door }[] = []
    for (let f = to; f !== from && prev.has(f); f = prev.get(f)!.f) steps.unshift({ from: prev.get(f)!.f, door: prev.get(f)!.door })
    return steps
  }
  // A point just through a door, on the side of room `f`.
  const side = (d: Door, f: number, k: number): Vec2 => {
    const p = add(d.c, mul(d.n, k))
    const inF = pointInPolygon(p, faces[f].polygon)
    return inF ? p : add(d.c, mul(d.n, -k))
  }

  // Start just inside the front door (or in the largest room), walk through every door on the way.
  const pts: Vec2[] = []
  const used = new Set<string>()
  if (entrance) pts.push(side(entrance, start, 0.7))
  pts.push(faces[start].center)
  for (let i = 1; i < order.length; i++) {
    let cur = order[i - 1]
    for (const st of route(cur, order[i])) {
      const next = st.door.a === st.from ? st.door.b! : st.door.a!
      pts.push(side(st.door, st.from, 0.6), side(st.door, next, 0.6))
      used.add(st.door.id)
      cur = next
    }
    pts.push(faces[order[i]].center)
  }
  const clean: Vec2[] = []
  for (const p of pts) if (!clean.length || dist(clean[clean.length - 1], p) > 0.35) clean.push(p)
  return { points: clean.map((p) => ({ id: uid(), levelId, p })), doors: [...used] }
}
