// A room's ceiling shape: flat at any height, sloping one way (shed / lean-to), or pitched both
// ways from a ridge (a vaulted gable ceiling). Gives the ceiling height at any point, the ceiling
// surface (with board coordinates unrolled along the slope), the wall above the walls' top up to a
// high ceiling (gable ends), rafters and a ridge beam, and how ceiling boards fit the room.
import { BoxGeometry, BufferGeometry, ExtrudeGeometry, Float32BufferAttribute, Matrix4, Shape, ShapeUtils, Vector2 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CeilingBeams, RoomRoof, Vec2 } from './types'

/** The room's frame: the ridge (or the slope's level lines) runs along `a`, the slope goes across `c`. */
export interface RoofFrame {
  /** The ridge runs along plan x (else along plan y). */
  alongX: boolean
  a0: number
  a1: number
  c0: number
  c1: number
  /** Ridge position across (gable). */
  mid: number
}


export function roofFrame(poly: Vec2[], roof: RoomRoof): RoofFrame {
  const xs = poly.map((p) => p[0])
  const ys = poly.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const alongX = x1 - x0 >= y1 - y0 === roof.ridgeLong
  const [a0, a1, c0, c1] = alongX ? [x0, x1, y0, y1] : [y0, y1, x0, x1]
  return { alongX, a0, a1, c0, c1, mid: (c0 + c1) / 2 }
}

const across = (f: RoofFrame, p: Vec2) => (f.alongX ? p[1] : p[0])
const along = (f: RoofFrame, p: Vec2) => (f.alongX ? p[0] : p[1])

/** Ceiling height at plan point p. */
export function ceilingAt(roof: RoomRoof, f: RoofFrame, p: Vec2): number {
  if (roof.shape === 'flat') return roof.height
  const c = across(f, p)
  const w = Math.max(1e-6, f.c1 - f.c0)
  if (roof.shape === 'shed') {
    let t = Math.max(0, Math.min(1, (c - f.c0) / w))
    if (roof.flip) t = 1 - t
    return roof.height + (roof.ridge - roof.height) * t
  }
  const d = Math.min(1, Math.abs(c - f.mid) / (w / 2))
  return roof.ridge - (roof.ridge - roof.height) * d
}

/** Highest point of the ceiling. */
export const ceilingTop = (roof: RoomRoof) => (roof.shape === 'flat' ? roof.height : Math.max(roof.height, roof.ridge))

/** Keep the part of a polygon on one side of the line across = k (Sutherland–Hodgman). */
function clip(poly: Vec2[], f: RoofFrame, k: number, keepBelow: boolean): Vec2[] {
  const inside = (p: Vec2) => (keepBelow ? across(f, p) <= k + 1e-9 : across(f, p) >= k - 1e-9)
  const out: Vec2[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const ip = inside(p)
    const iq = inside(q)
    if (ip) out.push(p)
    if (ip !== iq) {
      const t = (k - across(f, p)) / (across(f, q) - across(f, p))
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  }
  return out
}

/**
 * How ceiling boards of `tile` (m, along × across) lie in this room: whole boards from wall to wall
 * when that needs them less than 15 % bigger or smaller, joints on the beams when there are beams;
 * otherwise centred in the room. Returns the map from (along, across-unrolled) metres to texture
 * coordinates.
 */
export function boardFit(roof: RoomRoof, f: RoofFrame, tile: [number, number], beams?: CeilingBeams) {
  const fit = (len: number, t: number, start: number) => {
    const n = Math.max(1, Math.round(len / t))
    const k = (n * t) / len
    return Math.abs(k - 1) <= 0.15 ? (x: number) => (x - start) * k : (x: number) => x - (start + len / 2) + t / 2
  }
  // Along the ridge: boards between the rafters/beams if there are any.
  const La = f.a1 - f.a0
  let fu = fit(La, tile[0], f.a0)
  const rafters = beams && (roof.shape !== 'flat' || beamsAlongA(roof, f, beams))
  if (beams && rafters) {
    const n = Math.max(1, Math.round(beams.spacing / tile[0]))
    const per = beams.spacing / n
    const first = beamPositions(f, beams)[0] ?? f.a0
    fu = (x: number) => ((x - first) / per) * tile[0]
  }
  // Across: unrolled along the slope, from the ridge (gable) or the low side.
  const sec = slopeSec(roof, f)
  const Lc = roof.shape === 'gable' ? ((f.c1 - f.c0) / 2) * sec : (f.c1 - f.c0) * sec
  const fv = fit(Lc, tile[1], 0)
  return (a: number, cu: number): [number, number] => [fu(a), fv(cu)]
}

/** 1 / cos(slope). */
function slopeSec(roof: RoomRoof, f: RoofFrame) {
  if (roof.shape === 'flat') return 1
  const run = roof.shape === 'gable' ? (f.c1 - f.c0) / 2 : f.c1 - f.c0
  return Math.hypot(run, roof.ridge - roof.height) / Math.max(1e-6, run)
}

/** Distance across, unrolled along the slope, from the ridge (gable), the low side (shed) or the c0 side (flat). */
function unrolled(roof: RoomRoof, f: RoofFrame, p: Vec2) {
  const c = across(f, p)
  const sec = slopeSec(roof, f)
  if (roof.shape === 'gable') return Math.abs(c - f.mid) * sec
  if (roof.shape === 'shed' && roof.flip) return (f.c1 - c) * sec
  return (c - f.c0) * sec
}

/** The ceiling surface (facing down), with board coordinates (uv) from `uv`. */
export function ceilingGeometry(poly: Vec2[], roof: RoomRoof, f: RoofFrame, holes: Vec2[][], uv: (a: number, c: number) => [number, number]): BufferGeometry {
  const pieces = roof.shape === 'gable' ? [clip(poly, f, f.mid, true), clip(poly, f, f.mid, false)].filter((p) => p.length >= 3) : [poly]
  const pos: number[] = []
  const tex: number[] = []
  for (const piece of pieces) {
    const contour = piece.map((p) => new Vector2(p[0], p[1]))
    const hs = roof.shape === 'flat' ? holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))) : []
    const all = [...contour, ...hs.flat()]
    const tris = ShapeUtils.triangulateShape(contour, hs)
    for (const t of tris) {
      const P = t.map((i) => [all[i].x, all[i].y] as Vec2)
      const Y = P.map((p) => ceilingAt(roof, f, p))
      // Facing down: the triangle's normal must point to −y.
      const ux = P[1][0] - P[0][0]
      const uy = Y[1] - Y[0]
      const uz = P[1][1] - P[0][1]
      const vx = P[2][0] - P[0][0]
      const vy = Y[2] - Y[0]
      const vz = P[2][1] - P[0][1]
      const ny = uz * vx - ux * vz
      void uy
      void vy
      const order = ny <= 0 ? [0, 1, 2] : [0, 2, 1]
      for (const k of order) {
        pos.push(P[k][0], Y[k], P[k][1])
        tex.push(...uv(along(f, P[k]), unrolled(roof, f, P[k])))
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(tex, 2))
  g.computeVertexNormals()
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/**
 * Wall above the walls' top, up to a ceiling higher than them (the gable end under a pitched
 * ceiling, the high side of a lean-to): along each edge of the room (centre line from `a` to `b`,
 * half thickness `h`), as thick as the wall.
 */
export function infillGeometry(edges: { a: Vec2; b: Vec2; h: number; top: number }[], roof: RoomRoof, f: RoofFrame): BufferGeometry | null {
  const geos: BufferGeometry[] = []
  const m = new Matrix4()
  for (const e of edges) {
    const L = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])
    if (L < 1e-3) continue
    const d: Vec2 = [(e.b[0] - e.a[0]) / L, (e.b[1] - e.a[1]) / L]
    const at = (t: number): Vec2 => [e.a[0] + d[0] * t, e.a[1] + d[1] * t]
    // Where the edge crosses the ridge, the profile has a corner.
    const ts = [-e.h, L + e.h]
    if (roof.shape === 'gable') {
      const ca = across(f, e.a)
      const cb = across(f, e.b)
      if ((ca - f.mid) * (cb - f.mid) < 0) ts.splice(1, 0, ((f.mid - ca) / (cb - ca)) * L)
    }
    const tops = ts.map((t) => Math.max(e.top, ceilingAt(roof, f, at(Math.max(0, Math.min(L, t))))))
    if (tops.every((y) => y - e.top < 0.005)) continue
    const s = new Shape()
    s.moveTo(ts[0], e.top)
    s.lineTo(ts[ts.length - 1], e.top)
    for (let i = ts.length - 1; i >= 0; i--) s.lineTo(ts[i], tops[i])
    s.closePath()
    const g = new ExtrudeGeometry(s, { depth: e.h * 2, bevelEnabled: false })
    g.translate(0, 0, -e.h)
    g.applyMatrix4(m.makeRotationY(Math.atan2(-d[1], d[0])))
    g.translate(e.a[0], 0, e.a[1])
    geos.push(g.index ? g.toNonIndexed() : g)
  }
  if (!geos.length) return null
  const merged = mergeGeometries(geos)
  geos.forEach((g) => g.dispose())
  return merged
}

/** Flat ceilings: beams run across the short side unless asked otherwise; on slopes they are rafters. */
function beamsAlongA(roof: RoomRoof, f: RoofFrame, b: CeilingBeams) {
  if (roof.shape !== 'flat') return true
  const longIsA = f.a1 - f.a0 >= f.c1 - f.c0
  return longIsA === b.across
}

/** Where the beams (rafters) stand along the ridge: evenly spaced from the middle. */
export function beamPositions(f: RoofFrame, b: CeilingBeams) {
  const n = Math.max(1, Math.floor((f.a1 - f.a0 - b.width) / b.spacing))
  const first = (f.a0 + f.a1) / 2 - ((n - 1) * b.spacing) / 2
  return Array.from({ length: n }, (_, i) => first + i * b.spacing)
}

/**
 * Beams under the ceiling. On a sloping ceiling they are rafters running down the slope (and a
 * ridge beam under a pitched one); on a flat one, straight beams. Each is cut to the room outline.
 */
export function rafterGeometry(poly: Vec2[], roof: RoomRoof, b: CeilingBeams): BufferGeometry | null {
  // A flat ceiling's beams may run either way: use a frame whose "along" is the spacing direction.
  let f = roofFrame(poly, roof)
  if (roof.shape === 'flat' && !beamsAlongA(roof, f, b)) f = roofFrame(poly, { ...roof, ridgeLong: !roof.ridgeLong })
  const geos: BufferGeometry[] = []
  const m = new Matrix4()
  const r = new Matrix4()
  /** A beam from (c0, y0) to (c1, y1) across, at along = a, its top on that line. */
  const piece = (a: number, c0: number, y0: number, c1: number, y1: number) => {
    const L = Math.hypot(c1 - c0, y1 - y0)
    if (L < 0.05) return
    const th = Math.atan2(y1 - y0, c1 - c0)
    const g = new BoxGeometry(L, b.depth, b.width)
    // Lower it by half its depth, square to the slope.
    const cm = (c0 + c1) / 2 + Math.sin(th) * (b.depth / 2)
    const ym = (y0 + y1) / 2 - Math.cos(th) * (b.depth / 2) - 0.001
    g.applyMatrix4(r.makeRotationZ(th))
    if (f.alongX) g.applyMatrix4(m.makeRotationY(-Math.PI / 2))
    g.translate(f.alongX ? a : cm, ym, f.alongX ? cm : a)
    geos.push(g)
  }
  for (const a of beamPositions(f, b)) {
    // Where the line along = a crosses the outline: the stretches inside.
    const cuts: number[] = []
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]
      const q = poly[(k + 1) % poly.length]
      const pa = along(f, p)
      const qa = along(f, q)
      if (pa <= a === qa <= a) continue
      const t = (a - pa) / (qa - pa)
      cuts.push(across(f, p) + (across(f, q) - across(f, p)) * t)
    }
    cuts.sort((u, v) => u - v)
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const pts = [cuts[k], cuts[k + 1]]
      if (roof.shape === 'gable' && f.mid > pts[0] && f.mid < pts[1]) pts.splice(1, 0, f.mid)
      const P = (c: number): Vec2 => (f.alongX ? [a, c] : [c, a])
      for (let i = 0; i + 1 < pts.length; i++) piece(a, pts[i], ceilingAt(roof, f, P(pts[i])), pts[i + 1], ceilingAt(roof, f, P(pts[i + 1])))
    }
  }
  // Ridge beam along the top of a pitched ceiling.
  if (roof.shape === 'gable' && roof.ridge > roof.height) {
    const L = f.a1 - f.a0
    const g = new BoxGeometry(L, b.depth, b.width * 1.4)
    if (!f.alongX) g.applyMatrix4(m.makeRotationY(-Math.PI / 2))
    const am = (f.a0 + f.a1) / 2
    g.translate(f.alongX ? am : f.mid, roof.ridge - b.depth / 2 - 0.002, f.alongX ? f.mid : am)
    geos.push(g)
  }
  if (!geos.length) return null
  const merged = mergeGeometries(geos)
  geos.forEach((g) => g.dispose())
  return merged
}
