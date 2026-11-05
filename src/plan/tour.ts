// Walkthrough tours: a smooth path through the rooms, and the camera pose at any frame.
import type { CameraPose, Project } from '@/store/workspace'
import { analyse, add, dist, distanceToPolygon, mul, norm, pieceAt, pointInPolygon, sub, wallFrame, type Face } from './geometry'
import { levelElevations } from './levels'
import { OPENING_DEFAULTS, type TourPoint, type Vec2 } from './types'

type P3 = [number, number, number]

/** A sample along the walk: arc length, where the camera looks (unit, plan x/z) and when it is there. */
interface Sample {
  s: number
  hx: number
  hz: number
  t: number
}

export interface TourPath {
  line: P3[]
  cum: number[]
  length: number
  samples: Sample[]
  /** Seconds for the whole walk. */
  duration: number
}

/** Steadicam limits: how fast the view may turn, and how gently the walk speeds up and slows down. */
const TURN_RATE = (40 * Math.PI) / 180
const ACCEL = 0.5
const STEP = 0.04

const cache = new WeakMap<object, { levels: unknown; path: TourPath }>()

/**
 * The walk: a centripetal Catmull–Rom through the tour points (hairpins turned into small loops,
 * so it never doubles back on itself), with the view direction and the timing along it. The
 * camera looks a little ahead along the path, never more than 55° off the way it moves, and
 * slows down in turns so it never swings round faster than a person turning their head.
 */
export function tourPath(project: Pick<Project, 'tour' | 'levels'>): TourPath {
  const hit = cache.get(project.tour)
  if (hit && hit.levels === project.levels) return hit.path
  const path = buildPath(project)
  cache.set(project.tour, { levels: project.levels, path })
  return path
}

function buildPath(project: Pick<Project, 'tour' | 'levels'>): TourPath {
  const elev = levelElevations(project.levels)
  const raw: P3[] = project.tour.points.map((p) => [p.p[0], (elev.get(p.levelId) ?? 0) + project.tour.eyeHeight, p.p[1]])
  const pts = withoutHairpins(raw)
  const line: P3[] = []
  if (pts.length < 2) return { line: pts, cum: pts.map(() => 0), length: 0, samples: [], duration: 0 }
  const P = [pts[0], ...pts, pts[pts.length - 1]]
  for (let i = 1; i + 2 < P.length; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]]
    const steps = Math.max(12, Math.ceil(dist3(p1, p2) / 0.02))
    for (let k = 0; k < steps; k++) line.push(catmull(p0, p1, p2, p3, k / steps))
  }
  line.push(pts[pts.length - 1])
  const cum = [0]
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist3(line[i - 1], line[i]))
  const base = { line, cum, length: cum[cum.length - 1] }

  // Direction of travel every few cm.
  const n = Math.max(2, Math.ceil(base.length / STEP) + 1)
  const ds = base.length / (n - 1)
  const tan: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const s = i * ds
    const a = at(base, Math.max(0, s - 0.03))
    const b = at(base, Math.min(base.length, s + 0.03))
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1
    tan.push([(b[0] - a[0]) / l, (b[2] - a[2]) / l])
  }
  // View: the travel direction averaged a little ahead (a person looks where they are going).
  const look: [number, number][] = []
  const back = Math.round(0.3 / ds)
  const ahead = Math.round(1.4 / ds)
  for (let i = 0; i < n; i++) {
    let x = 0
    let z = 0
    for (let j = Math.max(0, i - back); j <= Math.min(n - 1, i + ahead); j++) {
      const d = (j - i) * ds
      const w = Math.exp(-((d - 0.35) ** 2) / 0.35)
      x += tan[j][0] * w
      z += tan[j][1] * w
    }
    const l = Math.hypot(x, z) || 1
    look.push([x / l, z / l])
  }
  // Once more, evenly both ways: turns start and end softly.
  const heading: [number, number][] = []
  const soft = Math.round(0.5 / ds)
  for (let i = 0; i < n; i++) {
    let x = 0
    let z = 0
    for (let j = Math.max(0, i - soft); j <= Math.min(n - 1, i + soft); j++) {
      const w = Math.exp(-(((j - i) * ds) ** 2) / 0.08)
      x += look[j][0] * w
      z += look[j][1] * w
    }
    const l = Math.hypot(x, z) || 1
    x /= l
    z /= l
    // Never more than 55° off the way it moves.
    const [tx, tz] = tan[i]
    const c = x * tx + z * tz
    const lim = Math.cos((55 * Math.PI) / 180)
    if (c < lim) {
      const side = Math.sign(tx * z - tz * x) || 1
      const a = Math.atan2(tz, tx) + side * Math.acos(lim)
      x = Math.cos(a)
      z = Math.sin(a)
    }
    heading.push([x, z])
  }
  // Speed: slower where the view turns, gentle start and stop.
  const v = project.tour.speed
  const turn: number[] = heading.map((h, i) => {
    if (i === 0) return 0
    const [px, pz] = heading[i - 1]
    return Math.abs(Math.atan2(px * h[1] - pz * h[0], px * h[0] + pz * h[1])) / ds
  })
  const win = Math.round(0.4 / ds)
  const vmax = turn.map((_, i) => {
    let k = 0
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) k = Math.max(k, turn[j])
    return Math.min(v, TURN_RATE / Math.max(1e-6, k))
  })
  const sp = vmax.slice()
  sp[0] = 0
  sp[n - 1] = 0
  for (let i = 1; i < n; i++) sp[i] = Math.min(sp[i], Math.sqrt(sp[i - 1] ** 2 + 2 * ACCEL * ds))
  for (let i = n - 2; i >= 0; i--) sp[i] = Math.min(sp[i], Math.sqrt(sp[i + 1] ** 2 + 2 * ACCEL * ds))
  const samples: Sample[] = [{ s: 0, hx: heading[0][0], hz: heading[0][1], t: 0 }]
  for (let i = 1; i < n; i++) {
    const vv = Math.max(0.02, (sp[i - 1] + sp[i]) / 2)
    samples.push({ s: i * ds, hx: heading[i][0], hz: heading[i][1], t: samples[i - 1].t + ds / vv })
  }
  // Finally smooth the view in time (≈ 0.2 s), like a steadicam: the turn rate itself changes gently.
  const ang: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(samples[i].hz, samples[i].hx)
    if (!i) ang.push(a)
    else {
      let d = a - (ang[i - 1] % (2 * Math.PI))
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      ang.push(ang[i - 1] + d)
    }
  }
  let j0 = 0
  for (let i = 0; i < n; i++) {
    const ti = samples[i].t
    while (samples[j0].t < ti - 0.6) j0++
    let sum = 0
    let wsum = 0
    for (let j = j0; j < n && samples[j].t <= ti + 0.6; j++) {
      const dt = (j + 1 < n ? samples[j + 1].t : samples[j].t) - (j > 0 ? samples[j - 1].t : samples[j].t)
      const w = Math.exp(-((samples[j].t - ti) ** 2) / (2 * 0.2 ** 2)) * Math.max(1e-4, dt)
      sum += ang[j] * w
      wsum += w
    }
    const a = sum / wsum
    samples[i].hx = Math.cos(a)
    samples[i].hz = Math.sin(a)
  }
  return { ...base, samples, duration: samples[n - 1].t }
}

/**
 * A point where the walk would double back (turning more than ~110°) becomes a small loop beside
 * it, so the camera turns round while walking instead of stopping and reversing.
 */
function withoutHairpins(pts: P3[], r = 0.45): P3[] {
  const out: P3[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (i === 0 || i === pts.length - 1) {
      out.push(p)
      continue
    }
    const a = pts[i - 1]
    const b = pts[i + 1]
    const ix = p[0] - a[0]
    const iz = p[2] - a[2]
    const ox = b[0] - p[0]
    const oz = b[2] - p[2]
    const il = Math.hypot(ix, iz)
    const ol = Math.hypot(ox, oz)
    if (il < 1e-3 || ol < 1e-3 || (ix * ox + iz * oz) / (il * ol) > Math.cos((110 * Math.PI) / 180)) {
      out.push(p)
      continue
    }
    const d = [ix / il, iz / il]
    // Loop towards the side the walk goes on to (left if it reverses exactly).
    const cr = ix * oz - iz * ox
    const sgn = Math.abs(cr) / (il * ol) > 0.05 ? Math.sign(cr) : 1
    const nrm = [-d[1] * sgn * -1, d[0] * sgn * -1]
    const rr = Math.min(r, il * 0.45, ol * 0.45)
    const c = [p[0] - d[0] * rr * 0.5 + nrm[0] * rr, p[2] - d[1] * rr * 0.5 + nrm[1] * rr]
    for (const deg of [0, 60, 120, 180]) {
      const th = (deg * Math.PI) / 180
      out.push([c[0] + rr * (-nrm[0] * Math.cos(th) + d[0] * Math.sin(th)), p[1], c[1] + rr * (-nrm[1] * Math.cos(th) + d[1] * Math.sin(th))])
    }
  }
  return out
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

function at(path: { line: P3[]; cum: number[]; length: number }, s: number): P3 {
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

export function tourFrames(project: Pick<Project, 'tour' | 'levels'>, fps: number) {
  const path = tourPath(project)
  return Math.max(2, Math.ceil(path.duration * fps) + 1)
}

/** The sample pair around time t and how far between them. */
function sampleAt(path: TourPath, t: number) {
  const S = path.samples
  let lo = 0
  let hi = S.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (S[m].t <= t) lo = m
    else hi = m
  }
  return { lo, hi, k: Math.max(0, Math.min(1, (t - S[lo].t) / (S[hi].t - S[lo].t || 1))) }
}

/** How far along the walk (m) the camera is at `frame`. */
export function tourDistance(project: Pick<Project, 'tour' | 'levels'>, frame: number, fps: number, path = tourPath(project)) {
  const S = path.samples
  if (S.length < 2) return 0
  const { lo, hi, k } = sampleAt(path, Math.max(0, Math.min(path.duration, frame / fps)))
  return S[lo].s + (S[hi].s - S[lo].s) * k
}

/** A pass through a door: `s` at the doorway, and the stretch [s0, s1] where the camera is within reach of its leaves. */
export interface DoorPass {
  id: string
  s: number
  s0: number
  s1: number
}

const doorCache = new WeakMap<TourPath, { openings: unknown; walls: unknown; list: DoorPass[] }>()

/**
 * Where the walk goes through a door: every pass (in and out of a room are two), with the stretch
 * of the walk where the camera is close enough for a swinging leaf to touch it. Passes close
 * together are one (the door stays open between them).
 */
export function tourDoorCrossings(project: Pick<Project, 'tour' | 'levels' | 'walls' | 'openings'>, path = tourPath(project)): DoorPass[] {
  const hit = doorCache.get(path)
  if (hit && hit.openings === project.openings && hit.walls === project.walls) return hit.list
  const elev = levelElevations(project.levels)
  const list: DoorPass[] = []
  const step = 0.04
  for (const o of project.openings) {
    if (!['door', 'double-door', 'sliding-door', 'french-window'].includes(o.kind)) continue
    const w = project.walls.find((x) => x.id === o.wallId)
    if (!w) continue
    const c = wallFrame(w, o.t).p
    const y = (elev.get(w.levelId) ?? 0) + project.tour.eyeHeight
    // The leaves: their hinges and widths (a sliding door just needs its doorway).
    const leaf = o.kind === 'door' ? o.width : o.width / 2
    const hinges = o.kind === 'sliding-door' ? [] : o.kind === 'door' ? [wallFrame(w, o.hinge === 'a' ? o.t - o.width / 2 : o.t + o.width / 2).p] : [wallFrame(w, o.t - o.width / 2).p, wallFrame(w, o.t + o.width / 2).p]
    const through = Math.max(0.6, o.width / 2 + 0.25)
    const n = Math.floor(path.length / step) + 1
    const near: boolean[] = []
    const passD: number[] = []
    for (let i = 0; i < n; i++) {
      const p = at(path, i * step)
      if (Math.abs(p[1] - y) > 0.6) {
        near.push(false)
        passD.push(Infinity)
        continue
      }
      const d = Math.hypot(p[0] - c[0], p[2] - c[1])
      passD.push(d)
      near.push(d < through || hinges.some((h) => Math.hypot(p[0] - h[0], p[2] - h[1]) < leaf + 0.3))
    }
    // Each run of "near" that actually goes through the doorway is a pass.
    const mine: DoorPass[] = []
    for (let i = 0; i < n; ) {
      if (!near[i]) {
        i++
        continue
      }
      let j = i
      let best = i
      while (j < n && near[j]) {
        if (passD[j] < passD[best]) best = j
        j++
      }
      if (passD[best] < through) mine.push({ id: o.id, s: best * step, s0: i * step, s1: (j - 1) * step })
      i = j
    }
    for (const m of mine) {
      const last = list.at(-1)
      if (last && last.id === m.id && m.s0 - last.s1 < 2.5) last.s1 = m.s1
      else list.push(m)
    }
  }
  doorCache.set(path, { openings: project.openings, walls: project.walls, list })
  return list
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * How open each door is with the camera `s` metres along the walk: shut until the camera comes
 * near, then swinging open over the 1.2 m before it is within reach of a leaf, fully open all the
 * time it is (so a leaf never moves through the camera), closing again once it has moved on.
 * Doors the walk doesn't go through stay shut.
 */
export function tourDoorsAt(crossings: DoorPass[], s: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of crossings) {
    const v = Math.min(smooth(c.s0 - 1.35, c.s0 - 0.15, s), 1 - smooth(c.s1 + 0.15, c.s1 + 1.35, s))
    out.set(c.id, Math.max(out.get(c.id) ?? 0, v))
  }
  return out
}

/** Camera at frame `frame` of the walk: eye height, looking ahead along the path. */
export function tourPose(project: Pick<Project, 'tour' | 'levels'>, frame: number, fps: number, path = tourPath(project)): CameraPose {
  const S = path.samples
  let pos: P3
  let fx: number
  let fz: number
  if (S.length < 2) {
    pos = path.line[0] ?? [0, project.tour.eyeHeight, 0]
    fx = 0
    fz = -1
  } else {
    const { lo, hi, k } = sampleAt(path, Math.max(0, Math.min(path.duration, frame / fps)))
    pos = at(path, S[lo].s + (S[hi].s - S[lo].s) * k)
    // Turn the view between the two samples (by angle, so it never cuts across).
    const a0 = Math.atan2(S[lo].hz, S[lo].hx)
    let da = Math.atan2(S[hi].hz, S[hi].hx) - a0
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    fx = Math.cos(a0 + da * k)
    fz = Math.sin(a0 + da * k)
  }
  // Look slightly down (about 6°) like a person walking through.
  const fy = -0.1
  const nn = Math.hypot(fx, fy, fz)
  const f: P3 = [fx / nn, fy / nn, fz / nn]
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
  const dedup: Vec2[] = []
  for (const p of pts) if (!dedup.length || dist(dedup[dedup.length - 1], p) > 0.35) dedup.push(p)
  // A room you leave the way you came in: walk round its middle instead of turning on the spot.
  const clean: Vec2[] = []
  dedup.forEach((p, i) => {
    const f = faces.find((x) => dist(x.center, p) < 1e-6)
    const a = dedup[i - 1]
    const b = dedup[i + 1]
    if (!f || !a || !b) return void clean.push(p)
    const din = norm(sub(p, a))
    const dout = norm(sub(b, p))
    if (din[0] * dout[0] + din[1] * dout[1] > Math.cos((100 * Math.PI) / 180)) return void clean.push(p)
    const room = distanceToPolygon(p, f.inner)
    const r = Math.max(0.4, Math.min(1.1, room * 0.55))
    const nrm: Vec2 = [-din[1], din[0]]
    // Round the side with more space.
    const free = (sgn: number) => [0.5, 1].every((k) => pointInPolygon(add(p, mul(nrm, sgn * r * k)), f.inner))
    const sgn = free(1) ? 1 : free(-1) ? -1 : 1
    for (const deg of [-50, 20, 90, 160, 230]) {
      const th = (deg * Math.PI) / 180
      // Around the middle, starting on the near side and coming back to it.
      clean.push(add(p, add(mul(din, r * Math.sin(th)), mul(nrm, -sgn * r * Math.cos(th)))))
    }
  })
  return { points: clean.map((p) => ({ id: uid(), levelId, p })), doors: [...used] }
}
