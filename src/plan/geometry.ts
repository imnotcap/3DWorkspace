// Plan geometry: wall joints, wall footprints and the rooms the walls enclose.
// Pure maths (no three.js, no '@/' imports) so it is unit-tested with Node directly.
import type { Vec2, Wall } from './types'

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
export const len = (a: Vec2) => Math.hypot(a[0], a[1])
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1
  return [a[0] / l, a[1] / l]
}
/** Left normal (90° counter-clockwise). */
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]]
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

const TOL = 2e-3 // 2 mm: points closer than this are the same joint

/** Intersection of lines p1 + λ d1 and p2 + μ d2, or null if (nearly) parallel. */
export function intersectLines(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const c = cross(d1, d2)
  if (Math.abs(c) < 1e-6) return null
  const l = cross(sub(p2, p1), d2) / c
  return add(p1, mul(d1, l))
}

export function signedArea(poly: Vec2[]) {
  let s = 0
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length])
  return s / 2
}

export function pointInPolygon(p: Vec2, poly: Vec2[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A point well inside a polygon: the centroid if it is inside, else the middle of the widest horizontal span. */
export function interiorPoint(poly: Vec2[]): Vec2 {
  const a = signedArea(poly)
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const c = cross(p, q)
    cx += (p[0] + q[0]) * c
    cy += (p[1] + q[1]) * c
  }
  const centroid: Vec2 = Math.abs(a) > 1e-9 ? [cx / (6 * a), cy / (6 * a)] : poly[0]
  if (pointInPolygon(centroid, poly) && distanceToPolygon(centroid, poly) > 0.3) return centroid
  const ys = poly.map((p) => p[1])
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  let best: { p: Vec2; w: number } | null = null
  for (let k = 1; k < 20; k++) {
    const y = minY + ((maxY - minY) * k) / 20
    const xs: number[] = []
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      if (p[1] > y !== q[1] > y) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]))
    }
    xs.sort((m, n) => m - n)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i]
      if (!best || w > best.w) best = { p: [(xs[i] + xs[i + 1]) / 2, y], w }
    }
  }
  return best?.p ?? centroid
}

export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a)
  const l2 = dot(ab, ab) || 1
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
  const point = add(a, mul(ab, t))
  return { t, point, dist: dist(p, point) }
}

export function distanceToPolygon(p: Vec2, poly: Vec2[]) {
  let d = Infinity
  for (let i = 0; i < poly.length; i++) d = Math.min(d, projectOnSegment(p, poly[i], poly[(i + 1) % poly.length]).dist)
  return d
}

// ───────────── curved walls ─────────────

export interface Arc {
  c: Vec2
  r: number
  /** Angle of a around the centre, and the signed sweep from a to b. */
  a0: number
  sweep: number
  len: number
}

/** The circle a curved wall follows, or null for a straight wall. */
export function arcOf(w: Pick<Wall, 'a' | 'b' | 'curve'>): Arc | null {
  const s = w.curve ?? 0
  const c = dist(w.a, w.b)
  if (Math.abs(s) < 1e-3 || c < 1e-3) return null
  const d = norm(sub(w.b, w.a))
  const n = perp(d)
  const m = mul(add(w.a, w.b), 0.5)
  const r = (c * c) / 4 / (2 * Math.abs(s)) + Math.abs(s) / 2
  const centre = add(m, mul(n, s - Math.sign(s) * r))
  const a0 = Math.atan2(w.a[1] - centre[1], w.a[0] - centre[0])
  const top = add(m, mul(n, s))
  let half = Math.atan2(top[1] - centre[1], top[0] - centre[0]) - a0
  while (half > Math.PI) half -= Math.PI * 2
  while (half < -Math.PI) half += Math.PI * 2
  return { c: centre, r, a0, sweep: half * 2, len: r * Math.abs(half * 2) }
}

/** Length along the wall (arc length for curved walls). */
export const wallLength = (w: Pick<Wall, 'a' | 'b' | 'curve'>) => arcOf(w)?.len ?? dist(w.a, w.b)

/** Point, direction (a → b) and left normal at `s` metres along the wall. */
export function wallFrame(w: Pick<Wall, 'a' | 'b' | 'curve'>, s: number): { p: Vec2; d: Vec2; n: Vec2 } {
  const arc = arcOf(w)
  if (!arc) {
    const d = norm(sub(w.b, w.a))
    return { p: add(w.a, mul(d, s)), d, n: perp(d) }
  }
  const t = arc.a0 + arc.sweep * Math.max(0, Math.min(1, s / arc.len))
  const p: Vec2 = [arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)]
  const k = Math.sign(arc.sweep)
  const d: Vec2 = [-Math.sin(t) * k, Math.cos(t) * k]
  return { p, d, n: perp(d) }
}

/** The closest point on a wall: how far along it, how far from it, and which side `p` is on. */
export function projectOnWall(p: Vec2, w: Pick<Wall, 'a' | 'b' | 'curve'>): { s: number; dist: number; point: Vec2; side: 'left' | 'right'; len: number } {
  const arc = arcOf(w)
  if (!arc) {
    const pr = projectOnSegment(p, w.a, w.b)
    const L = dist(w.a, w.b)
    const n = perp(norm(sub(w.b, w.a)))
    return { s: pr.t * L, dist: pr.dist, point: pr.point, side: dot(sub(p, pr.point), n) >= 0 ? 'left' : 'right', len: L }
  }
  let t = Math.atan2(p[1] - arc.c[1], p[0] - arc.c[0]) - arc.a0
  // Angle along the sweep's direction, wrapped into [0, 2π).
  t *= Math.sign(arc.sweep)
  t = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  let f = t / Math.abs(arc.sweep)
  if (f > 1) f = t - Math.abs(arc.sweep) < Math.PI * 2 - t ? 1 : 0 // past an end: snap to the nearer end
  const s = f * arc.len
  const fr = wallFrame(w, s)
  return { s, dist: dist(p, fr.p), point: fr.p, side: dot(sub(p, fr.p), fr.n) >= 0 ? 'left' : 'right', len: arc.len }
}

/** Points along a curved (or straight) wall, offset sideways by `off` (+ = left). */
export function wallPolyline(w: Pick<Wall, 'a' | 'b' | 'curve'>, s0: number, s1: number, off = 0, step = 0.05): Vec2[] {
  const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step))
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = wallFrame(w, s0 + ((s1 - s0) * i) / n)
    return add(f.p, mul(f.n, off))
  })
}

/**
 * Curved walls → short straight pieces (about 3° each) that join with mitres. The plan analysis,
 * floors, rooms and collisions all work on these; shading makes them read as one smooth curve.
 */
export function expandWalls(walls: Wall[]): Wall[] {
  const out: Wall[] = []
  for (const w of walls) {
    const arc = arcOf(w)
    if (!arc) {
      out.push(w)
      continue
    }
    const n = Math.max(4, Math.min(120, Math.ceil(Math.abs(arc.sweep) / ((3 * Math.PI) / 180)), Math.ceil(arc.len / 0.04)))
    const seg = arc.len / n
    for (let k = 0; k < n; k++) {
      const a = k === 0 ? w.a : wallFrame(w, seg * k).p
      const b = k === n - 1 ? w.b : wallFrame(w, seg * (k + 1)).p
      out.push({ ...w, id: `${w.id}~${k}`, a, b, curve: undefined, parentId: w.id, s0: seg * k, sLen: arc.len, centre: arc.c })
    }
  }
  return out
}

/** The id a wall (or a piece of a curved wall) is known by in the plan. */
export const wallIdOf = (w: Wall) => w.parentId ?? w.id

/** The straight piece of `wallId` under `s` metres along it, and where on that piece. */
export function pieceAt(geom: PlanGeom, wallId: string, s: number): { g: WallGeom; u: number } | null {
  const g = geom.walls.get(wallId)
  if (g) return { g, u: s }
  const pieces = geom.pieces.get(wallId)
  if (!pieces?.length) return null
  const seg = (pieces[0].wall.sLen ?? 0) / pieces.length
  const k = Math.max(0, Math.min(pieces.length - 1, Math.floor(s / (seg || 1))))
  const p = pieces[k]
  return { g: p, u: ((s - (p.wall.s0 ?? 0)) / (seg || 1)) * p.len }
}

// ───────────── analysis ─────────────

export interface WallGeom {
  wall: Wall
  /** Unit direction a → b, its left normal, length and half thickness. */
  d: Vec2
  n: Vec2
  len: number
  h: number
  /** Footprint corners: left/right side at the a and b ends (mitred or trimmed at joints). */
  la: Vec2
  lb: Vec2
  ra: Vec2
  rb: Vec2
  /** Unconnected ends get an end face. */
  freeA: boolean
  freeB: boolean
  /** Stretches between joints, with the room on each side (face index, or null = outside). */
  segments: { u0: number; u1: number; left: number | null; right: number | null }[]
}

export interface FaceEdge {
  wallId: string
  from: Vec2
  to: Vec2
  /** Which side of the wall faces this room. */
  side: 'left' | 'right'
  h: number
}

export interface Face {
  index: number
  /** Centreline outline, counter-clockwise (positive area). */
  polygon: Vec2[]
  edges: FaceEdge[]
  /** Outline at the wall surfaces (inside the walls). */
  inner: Vec2[]
  /** Floor area inside the walls, m². */
  area: number
  /** A good spot for the label / camera target. */
  center: Vec2
}

export interface PlanGeom {
  walls: Map<string, WallGeom>
  faces: Face[]
  /** Tops of joints where 3+ walls meet. */
  caps: Vec2[][]
  /** Curved walls: their straight pieces in order, by the curved wall's id. */
  pieces: Map<string, WallGeom[]>
}

interface Node {
  p: Vec2
  out: HalfEdge[]
}
interface HalfEdge {
  from: number
  to: number
  wallId: string
  forward: boolean
  u0: number
  u1: number
  angle: number
  face: number
  twin?: HalfEdge
}

export function analyse(input: Wall[]): PlanGeom {
  const walls = expandWalls(input.filter((w) => dist(w.a, w.b) > 1e-3))
  const geoms = new Map<string, WallGeom>()
  for (const w of walls) {
    const L = dist(w.a, w.b)
    const d = norm(sub(w.b, w.a))
    const n = perp(d)
    const h = Math.max(0.01, w.thickness / 2)
    geoms.set(w.id, { wall: w, d, n, len: L, h, la: add(w.a, mul(n, h)), ra: sub(w.a, mul(n, h)), lb: add(w.b, mul(n, h)), rb: sub(w.b, mul(n, h)), freeA: true, freeB: true, segments: [] })
  }

  // 1. Where walls touch or cross, both are split.
  const splits = new Map<string, number[]>(walls.map((w) => [w.id, [0, geoms.get(w.id)!.len]]))
  for (let i = 0; i < walls.length; i++)
    for (let j = i + 1; j < walls.length; j++) {
      const A = walls[i]
      const B = walls[j]
      const gA = geoms.get(A.id)!
      const gB = geoms.get(B.id)!
      const r = sub(A.b, A.a)
      const s = sub(B.b, B.a)
      const den = cross(r, s)
      if (Math.abs(den) < 1e-9) {
        // Parallel: only collinear overlaps join (endpoints lying on the other wall).
        for (const [P, G, list] of [[B.a, gA, splits.get(A.id)!], [B.b, gA, splits.get(A.id)!], [A.a, gB, splits.get(B.id)!], [A.b, gB, splits.get(B.id)!]] as const) {
          const pr = projectOnSegment(P, G.wall.a, G.wall.b)
          if (pr.dist < TOL) list.push(pr.t * G.len)
        }
        continue
      }
      const qp = sub(B.a, A.a)
      const t = cross(qp, s) / den
      const u = cross(qp, r) / den
      const tolA = TOL / gA.len
      const tolB = TOL / gB.len
      if (t >= -tolA && t <= 1 + tolA && u >= -tolB && u <= 1 + tolB) {
        splits.get(A.id)!.push(Math.min(gA.len, Math.max(0, t * gA.len)))
        splits.get(B.id)!.push(Math.min(gB.len, Math.max(0, u * gB.len)))
      }
    }

  // 2. Joints (nodes), shared within 2 mm.
  const nodes: Node[] = []
  const nodeAt = (p: Vec2) => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i].p, p) < TOL) return i
    nodes.push({ p, out: [] })
    return nodes.length - 1
  }
  const wallParams = new Map<string, { u: number; node: number }[]>()
  for (const w of walls) {
    const g = geoms.get(w.id)!
    const us = [...splits.get(w.id)!].sort((x, y) => x - y)
    const merged: number[] = []
    for (const u of us) if (!merged.length || u - merged[merged.length - 1] > TOL) merged.push(u)
    merged[0] = 0
    merged[merged.length - 1] = g.len
    if (merged.length === 1) merged.push(g.len)
    wallParams.set(w.id, merged.map((u) => ({ u, node: nodeAt(add(w.a, mul(g.d, u))) })))
  }

  // 3. Half-edges, sorted by angle around each node.
  const halfEdges: HalfEdge[] = []
  for (const w of walls) {
    const ps = wallParams.get(w.id)!
    for (let k = 0; k + 1 < ps.length; k++) {
      const p0 = ps[k]
      const p1 = ps[k + 1]
      if (p0.node === p1.node) continue
      const f: HalfEdge = { from: p0.node, to: p1.node, wallId: w.id, forward: true, u0: p0.u, u1: p1.u, angle: 0, face: -1 }
      const b: HalfEdge = { from: p1.node, to: p0.node, wallId: w.id, forward: false, u0: p0.u, u1: p1.u, angle: 0, face: -1 }
      f.twin = b
      b.twin = f
      for (const e of [f, b]) {
        const dv = sub(nodes[e.to].p, nodes[e.from].p)
        e.angle = Math.atan2(dv[1], dv[0])
        nodes[e.from].out.push(e)
        halfEdges.push(e)
      }
    }
  }
  for (const nd of nodes) nd.out.sort((x, y) => x.angle - y.angle)

  // 4. Faces: walk with the face on the left; at each joint take the next edge clockwise from the way back.
  const rawFaces: { edges: HalfEdge[]; area: number }[] = []
  for (const start of halfEdges) {
    if (start.face !== -1) continue
    const loop: HalfEdge[] = []
    let e = start
    let guard = 0
    while (e.face === -1 && guard++ < 10000) {
      e.face = rawFaces.length
      loop.push(e)
      const out = nodes[e.to].out
      const back = out.indexOf(e.twin!)
      e = out[(back - 1 + out.length) % out.length]
    }
    rawFaces.push({ edges: loop, area: signedArea(loop.map((h) => nodes[h.from].p)) })
  }

  const faces: Face[] = []
  const faceIndex = new Map<number, number>()
  rawFaces.forEach((rf, i) => {
    if (rf.area < 0.05) return // the outside, or slivers
    // Walls sticking into a room (not closing anything) appear as out-and-back spikes: drop them.
    const edges = rf.edges.slice()
    let changed = true
    while (changed && edges.length > 2) {
      changed = false
      for (let k = 0; k < edges.length; k++) {
        const e = edges[k]
        const nx = edges[(k + 1) % edges.length]
        if (nx === e.twin) {
          edges.splice(Math.max(k, (k + 1) % edges.length), 1)
          edges.splice(Math.min(k, (k + 1) % edges.length), 1)
          changed = true
          break
        }
      }
    }
    if (edges.length < 3) return
    const fe: FaceEdge[] = edges.map((h) => ({ wallId: h.wallId, from: nodes[h.from].p, to: nodes[h.to].p, side: h.forward ? 'left' : 'right', h: geoms.get(h.wallId)!.h }))
    const polygon = fe.map((e) => e.from)
    const inner = insetPolygon(fe)
    const index = faces.length
    faceIndex.set(i, index)
    faces.push({ index, polygon, edges: fe, inner, area: Math.abs(signedArea(inner)), center: interiorPoint(inner.length >= 3 ? inner : polygon) })
  })

  // 5. Which room is on each side of each wall stretch.
  for (const h of halfEdges) {
    if (!h.forward) continue
    const g = geoms.get(h.wallId)!
    const left = faceIndex.get(h.face) ?? null
    const right = faceIndex.get(h.twin!.face) ?? null
    g.segments.push({ u0: h.u0, u1: h.u1, left, right })
  }
  for (const g of geoms.values()) {
    g.segments.sort((x, y) => x.u0 - y.u0)
    if (!g.segments.length) g.segments.push({ u0: 0, u1: g.len, left: null, right: null })
  }

  // 6. Corners at joints: mitred where wall ends meet, trimmed to the face of a wall that runs through.
  const caps: Vec2[][] = []
  nodes.forEach((nd, ni) => {
    type End = { g: WallGeom; at: 'a' | 'b'; dir: Vec2; nrm: Vec2; h: number; angle: number }
    const ends: End[] = []
    const through: WallGeom[] = []
    for (const g of geoms.values()) {
      const ps = wallParams.get(g.wall.id)!
      for (let k = 0; k < ps.length; k++) {
        if (ps[k].node !== ni) continue
        if (k === 0) ends.push({ g, at: 'a', dir: g.d, nrm: g.n, h: g.h, angle: Math.atan2(g.d[1], g.d[0]) })
        else if (k === ps.length - 1) {
          const dir = mul(g.d, -1)
          ends.push({ g, at: 'b', dir, nrm: perp(dir), h: g.h, angle: Math.atan2(dir[1], dir[0]) })
        } else if (!through.includes(g)) through.push(g)
      }
    }
    const setCorner = (e: End, side: 'left' | 'right', p: Vec2) => {
      // An end's own left/right, mapped to the wall's sides (at b the wall points back towards the joint).
      if (e.at === 'a') side === 'left' ? (e.g.la = p) : (e.g.ra = p)
      else side === 'left' ? (e.g.rb = p) : (e.g.lb = p)
    }
    const mark = (e: End) => (e.at === 'a' ? (e.g.freeA = false) : (e.g.freeB = false))
    const limit = (e: End, p: Vec2 | null, fallback: Vec2) => (p && dist(p, nd.p) < 4 * e.h + 0.3 ? p : fallback)

    if (through.length) {
      for (const e of ends) {
        const t = through[0]
        const s = dot(e.dir, t.n) >= 0 ? 1 : -1
        const facePoint = add(t.wall.a, mul(t.n, t.h * s))
        const lp = add(nd.p, mul(e.nrm, e.h))
        const rp = sub(nd.p, mul(e.nrm, e.h))
        setCorner(e, 'left', limit(e, intersectLines(lp, e.dir, facePoint, t.d), lp))
        setCorner(e, 'right', limit(e, intersectLines(rp, e.dir, facePoint, t.d), rp))
        mark(e)
      }
      return
    }
    if (ends.length < 2) return
    ends.sort((x, y) => x.angle - y.angle)
    const corners: Vec2[] = []
    for (let i = 0; i < ends.length; i++) {
      const e = ends[i]
      const f = ends[(i + 1) % ends.length]
      const lp = add(nd.p, mul(e.nrm, e.h))
      const rp = sub(nd.p, mul(f.nrm, f.h))
      const c = intersectLines(lp, e.dir, rp, f.dir)
      setCorner(e, 'left', limit(e, c, lp))
      setCorner(f, 'right', limit(f, c, rp))
      corners.push(limit(e, c, lp))
      mark(e)
    }
    if (ends.length >= 3) caps.push(corners)
  })

  const pieces = new Map<string, WallGeom[]>()
  for (const g of geoms.values()) if (g.wall.parentId) pieces.set(g.wall.parentId, [...(pieces.get(g.wall.parentId) ?? []), g])
  return { walls: geoms, faces, caps, pieces }
}

/** Room outline at the wall surfaces: each centreline edge moved in by its wall's half thickness. */
export function insetPolygon(edges: FaceEdge[]): Vec2[] {
  const n = edges.length
  const lines = edges.map((e) => {
    const d = norm(sub(e.to, e.from))
    return { p: add(e.from, mul(perp(d), e.h)), d }
  })
  const out: Vec2[] = []
  for (let k = 0; k < n; k++) {
    const prev = lines[(k - 1 + n) % n]
    const cur = lines[k]
    out.push(intersectLines(prev.p, prev.d, cur.p, cur.d) ?? cur.p)
  }
  return out
}

/** Keep an opening of `width` inside a wall of length `len`, clear of the ends. */
export function clampOpening(t: number, width: number, wallLen: number, margin = 0.05) {
  const lo = width / 2 + margin
  const hi = wallLen - width / 2 - margin
  return hi < lo ? wallLen / 2 : Math.min(hi, Math.max(lo, t))
}
