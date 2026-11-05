import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  ShapeUtils,
  Vector2,
  Vector3,
  type Material,
} from 'three'
import { surfaceFor } from '@/viewport/shading'
import { presetById } from '@/viewport/materialPresets'
import { analyse, clampOpening, interiorPoint, pointInPolygon, wallIdOf, type PlanGeom, type WallGeom } from './geometry'
import { roomFor } from './levels'
import { trimGeometry } from './trim'
import { boardFit, ceilingGeometry, ceilingTop, infillGeometry, rafterGeometry, roofFrame } from './roof'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEFAULT_CEILING_FINISH, DEFAULT_FLOOR_FINISH, flatRoof, DEFAULT_TRIM, DEFAULT_WALL_FINISH, EXTERIOR_FINISH, OPENING_DEFAULTS, type Finish, type Level, type Opening, type RoomInfo, type Vec2, type Wall } from './types'

/**
 * Plan → 3D. Walls are built face by face so every stretch of wall surface knows which room
 * it faces (and takes that room's paint), and openings are cut exactly with a grid of quads
 * rather than CSG. Everything is in the level's local space (floor at y = 0); plan y → world z.
 */

export interface PickInfo {
  kind: 'wall' | 'room' | 'opening'
  id: string
  side?: 'left' | 'right'
  /** Room (face index) a wall surface faces. */
  face?: number | null
}

// ───────────── materials ─────────────

const matCache = new Map<string, Material>()
export function finishMaterial(f: Finish, kind: 'wall' | 'floor' | 'ceiling' | 'frame' | 'plaster', onUpgrade?: () => void): Material {
  const key = `${kind}|${f.color}|${f.preset ?? ''}`
  let m = matCache.get(key)
  if (!m) {
    const preset = presetById(f.preset)
    const rough = kind === 'frame' ? 0.45 : kind === 'floor' ? 0.6 : 0.92
    const base = new MeshStandardMaterial({ name: kind, color: f.color, roughness: rough, metalness: 0 })
    m = f.preset
      ? surfaceFor(base, { color: f.color, roughness: preset?.roughness ?? rough, metalness: preset?.metalness ?? 0, keepTexture: false, preset: f.preset }, { metric: true, onUpgrade })
      : base
    m.name = kind
    matCache.set(key, m)
  }
  return m
}

// Real glass: thin, clear, refractive (transmission), so daylight comes through in the path tracer.
const GLASS = new MeshPhysicalMaterial({ name: 'glass', color: '#f4f8fa', roughness: 0.01, metalness: 0, transmission: 1, thickness: 0, ior: 1.5, side: DoubleSide, envMapIntensity: 1.2 })
const STEEL = new MeshStandardMaterial({ name: 'handle', color: '#c9cbcd', roughness: 0.28, metalness: 1 })
const ALU = new MeshStandardMaterial({ name: 'aluminium', color: '#3a3d40', roughness: 0.4, metalness: 0.6 })

// ───────────── geometry helpers ─────────────

class Builder {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []
  private push(p: Vector3, n: Vector3, u: number, v: number) {
    this.pos.push(p.x, p.y, p.z)
    this.nor.push(n.x, n.y, n.z)
    this.uv.push(u, v)
  }
  /** Quad p0 p1 p2 p3 (in order around it), facing `n`; uv given per corner. `ns`: per-corner normals (smooth curves). */
  quad(p: Vector3[], n: Vector3, uv: [number, number][], ns?: Vector3[]) {
    const c = new Vector3().subVectors(p[1], p[0]).cross(new Vector3().subVectors(p[2], p[0]))
    const order = c.dot(n) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
    for (const i of order) this.push(p[i], ns?.[i] ?? n, uv[i][0], uv[i][1])
  }
  /** Flat polygon at height y facing up or down; uv = plan coordinates (metres). */
  polygon(points: Vec2[], y: number, up: boolean, holes: Vec2[][] = []) {
    const contour = points.map((p) => new Vector2(p[0], p[1]))
    const hs = holes.map((h) => h.map((p) => new Vector2(p[0], p[1])))
    const all = [...contour, ...hs.flat()]
    const tris = ShapeUtils.triangulateShape(contour, hs)
    const n = new Vector3(0, up ? 1 : -1, 0)
    for (const [a, b, c] of tris) {
      const P = [all[a], all[b], all[c]].map((q) => new Vector3(q.x, y, q.y))
      const cr = new Vector3().subVectors(P[1], P[0]).cross(new Vector3().subVectors(P[2], P[0]))
      const tri = cr.dot(n) >= 0 ? [0, 1, 2] : [0, 2, 1]
      for (const i of tri) this.push(P[i], n, P[i].x, P[i].z)
    }
  }
  get empty() {
    return this.pos.length === 0
  }
  geometry() {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
}

const V3 = (p: Vec2, y: number) => new Vector3(p[0], y, p[1])

function mesh(g: BufferGeometry, m: Material, name: string, pick?: PickInfo) {
  const o = new Mesh(g, m)
  o.name = name
  o.castShadow = o.receiveShadow = true
  if (pick) o.userData.pick = pick
  return o
}

function box(w: number, h: number, d: number, m: Material, x: number, y: number, z: number) {
  const o = new Mesh(new BoxGeometry(w, h, d), m)
  o.position.set(x, y, z)
  o.castShadow = o.receiveShadow = true
  return o
}

// ───────────── walls ─────────────

interface Hole {
  u0: number
  u1: number
  v0: number
  v1: number
  /** The hole really starts / ends here (on a curved wall a hole spans several pieces). */
  cap0?: boolean
  cap1?: boolean
  /** Where the wall faces are cut (wider than u0..u1 where the hole runs on into the next piece, so the mitred joint leaves no sliver). */
  cut0?: number
  cut1?: number
}

function wallSide(g: WallGeom, side: 'left' | 'right', bottom: number, top: number, holes: Hole[], segments: { u0: number; u1: number }[]): Builder[] {
  const s = side === 'left' ? 1 : -1
  const c0 = !!g.wall.centre
  const n = new Vector3(g.n[0] * s, 0, g.n[1] * s)
  const origin: Vec2 = [g.wall.a[0] + g.n[0] * g.h * s, g.wall.a[1] + g.n[1] * g.h * s]
  const P = (u: number, v: number) => new Vector3(origin[0] + g.d[0] * u, v, origin[1] + g.d[1] * u)
  // Pieces of a curved wall: normals point straight out from (or in to) the circle's centre at
  // every corner, so neighbouring pieces shade as one smooth surface, without facets.
  const ctr = g.wall.centre
  const radial = (q: Vector3) => {
    const r = new Vector3(q.x - ctr![0], 0, q.z - ctr![1]).normalize()
    return r.dot(n) >= 0 ? r : r.negate()
  }
  // Texture u keeps running along the whole curved wall.
  const uOff = g.wall.s0 ?? 0
  return segments.map(({ u0, u1 }) => {
    const b = new Builder()
    const us = new Set([u0, u1])
    const vs = new Set([bottom, top])
    for (const h of holes) {
      const c0 = h.cut0 ?? h.u0
      const c1 = h.cut1 ?? h.u1
      if (c1 <= u0 || c0 >= u1) continue
      us.add(Math.max(u0, c0)).add(Math.min(u1, c1))
      vs.add(Math.max(bottom, Math.min(top, h.v0))).add(Math.max(bottom, Math.min(top, h.v1)))
    }
    const U = [...us].sort((x, y) => x - y)
    const Vs = [...vs].sort((x, y) => x - y)
    for (let i = 0; i + 1 < U.length; i++)
      for (let j = 0; j + 1 < Vs.length; j++) {
        const cu = (U[i] + U[i + 1]) / 2
        const cv = (Vs[j] + Vs[j + 1]) / 2
        if (holes.some((h) => cu > (h.cut0 ?? h.u0) && cu < (h.cut1 ?? h.u1) && cv > h.v0 && cv < h.v1)) continue
        const a = U[i]
        const c = U[i + 1]
        const lo = Vs[j]
        const hi = Vs[j + 1]
        const corners = [P(a, lo), P(c, lo), P(c, hi), P(a, hi)]
        b.quad(corners, n, [
          [(a + uOff) * s, lo],
          [(c + uOff) * s, lo],
          [(c + uOff) * s, hi],
          [(a + uOff) * s, hi],
        ], c0 ? corners.map(radial) : undefined)
      }
    return b
  })
}

export interface LevelBuildInput {
  level: Level
  levelIndex: number
  walls: Wall[]
  openings: Opening[]
  rooms: RoomInfo[]
  /** Openings in this floor (stairwells), plan polygons. */
  floorHoles?: Vec2[][]
  /** Openings in this level's ceiling (stairs going up). */
  ceilingHoles?: Vec2[][]
  /** Radiators and the like against the walls: wall panels go around them. Plan centre, size, yaw, height range. */
  obstacles?: { c: Vec2; w: number; d: number; yaw: number; y0: number; y1: number }[]
  onUpgrade?: () => void
}

/** An opening as the panelling sees it: with the door casing (7 cm) or the window board around it. */
export function trimHole(o: Opening) {
  const c = OPENING_DEFAULTS[o.kind].door ? 0.07 : o.sill > 0.05 ? 0.03 : 0
  return { a: o.t - o.width / 2 - c, b: o.t + o.width / 2 + c, sill: o.sill - (c && o.sill > 0.05 ? 0.03 : 0), top: o.sill + o.height + c }
}

/** Obstacles standing with their back against one face of a straight wall, in its run coordinates. */
export function obstaclesOn(g: WallGeom, side: 'left' | 'right', list: LevelBuildInput['obstacles'] = []) {
  const sgn = side === 'left' ? 1 : -1
  const out: { a: number; b: number; sill: number; top: number }[] = []
  for (const o of list) {
    const rel: Vec2 = [o.c[0] - g.wall.a[0], o.c[1] - g.wall.a[1]]
    const s = rel[0] * g.d[0] + rel[1] * g.d[1]
    const off = (rel[0] * g.n[0] + rel[1] * g.n[1]) * sgn
    // Facing away from this face (front = (sin yaw, cos yaw)), back within a few cm of it.
    const front: Vec2 = [Math.sin(o.yaw), Math.cos(o.yaw)]
    const facing = (front[0] * g.n[0] + front[1] * g.n[1]) * sgn
    if (facing < 0.9 || Math.abs(off - g.h - o.d / 2) > 0.12 || s < -o.w / 2 || s > g.len + o.w / 2) continue
    out.push({ a: s - o.w / 2 - 0.05, b: s + o.w / 2 + 0.05, sill: o.y0 - 0.05, top: o.y1 + 0.05 })
  }
  return out
}

/** Daylight coming in through an outside opening: where, facing which way (into the room), how big. */
export interface WindowPortal {
  c: [number, number, number]
  n: Vec2
  w: number
  h: number
}

export function buildLevel(input: LevelBuildInput): { group: Group; geom: PlanGeom; portals: WindowPortal[] } {
  const { level, walls, openings, rooms, onUpgrade } = input
  const geom = analyse(walls)
  const group = new Group()
  group.name = `level:${level.id}`
  const bottom = input.levelIndex > 0 ? -level.slab : 0
  const plaster = finishMaterial(DEFAULT_WALL_FINISH, 'plaster', onUpgrade)
  const portals: WindowPortal[] = []
  const exterior = finishMaterial(EXTERIOR_FINISH, 'wall', onUpgrade)

  const faceRoom = geom.faces.map((f) => roomFor(f, rooms, level.id))
  const wallFinishFor = (face: number | null) => (face === null ? EXTERIOR_FINISH : (faceRoom[face]?.walls ?? DEFAULT_WALL_FINISH))

  // Panelling and skirting, merged per room and colour.
  const trims = new Map<string, { geos: BufferGeometry[]; color: string; face: number }>()

  for (const g of geom.walls.values()) {
    const w = g.wall
    const top = Math.max(0.1, w.height ?? level.height)
    const id = wallIdOf(w)
    // Openings stay inside the wall even after it was shortened. On a curved wall they are placed
    // along the whole curve (arc length) and each straight piece cuts its share of the hole.
    const fullLen = w.sLen ?? g.len
    const placed = openings.filter((o) => o.wallId === id).map((o) => ({ ...o, t: clampOpening(o.t, Math.min(o.width, fullLen - 0.1), fullLen), width: Math.min(o.width, fullLen - 0.1) }))
    const pieceCount = w.parentId ? (geom.pieces.get(w.parentId)?.length ?? 1) : 1
    const segArc = fullLen / pieceCount
    const k = w.parentId ? g.len / segArc : 1
    const s0 = w.s0 ?? 0
    const clipped = placed
      .map((o) => {
        const a = Math.max(o.t - o.width / 2, s0)
        const e = Math.min(o.t + o.width / 2, s0 + (w.parentId ? segArc : g.len))
        return e - a > 1e-4 ? { o, u0: (a - s0) * k, u1: (e - s0) * k, cap0: o.t - o.width / 2 >= s0 - 1e-6, cap1: o.t + o.width / 2 <= s0 + segArc + 1e-6 || !w.parentId } : null
      })
      .filter((x) => !!x)
    const holes: Hole[] = clipped.map((c) => ({ u0: c.u0, u1: c.u1, v0: c.o.sill, v1: Math.min(top - 0.01, c.o.sill + c.o.height), cap0: c.cap0, cap1: c.cap1, cut0: c.cap0 ? c.u0 : c.u0 - 1, cut1: c.cap1 ? c.u1 : c.u1 + 1 }))

    for (const side of ['left', 'right'] as const) {
      const corner0 = side === 'left' ? g.la : g.ra
      const corner1 = side === 'left' ? g.lb : g.rb
      const uStart = (corner0[0] - w.a[0]) * g.d[0] + (corner0[1] - w.a[1]) * g.d[1]
      const uEnd = (corner1[0] - w.a[0]) * g.d[0] + (corner1[1] - w.a[1]) * g.d[1]
      const segs = g.segments.map((sg, i) => ({ u0: i === 0 ? uStart : sg.u0, u1: i === g.segments.length - 1 ? uEnd : sg.u1, face: side === 'left' ? sg.left : sg.right }))
      const builders = wallSide(g, side, bottom, top, holes, segs)
      // Skirting boards and wall panels on faces that look into a room.
      for (const sg of segs) {
        if (sg.face === null) continue
        const trim = faceRoom[sg.face]?.trim ?? DEFAULT_TRIM
        if (trim.panels === 'none' && trim.skirting === 'none') continue
        const run: [number, number] = w.parentId ? [g.h, fullLen - g.h] : [sg.u0, sg.u1]
        const piece: [number, number] = w.parentId ? [s0 + sg.u0 / k, s0 + sg.u1 / k] : [sg.u0, sg.u1]
        const geos = trimGeometry({ g, side, trim, ceiling: top, run, piece, s0: w.parentId ? s0 : 0, k, openings: placed.map(trimHole), obstacles: w.parentId ? [] : obstaclesOn(g, side, input.obstacles) })
        if (!geos.length) continue
        const key = `${sg.face}|${trim.color}`
        const e = trims.get(key) ?? { geos: [], color: trim.color, face: sg.face }
        e.geos.push(...geos)
        trims.set(key, e)
      }
      builders.forEach((b, i) => {
        if (b.empty) return
        const face = segs[i].face
        const accent = w.paint?.[side]
        const f = accent ?? wallFinishFor(face)
        const m = face === null && !accent ? exterior : finishMaterial(f, 'wall', onUpgrade)
        group.add(mesh(b.geometry(), m, `wall ${side}`, { kind: 'wall', id, side, face }))
      })
    }

    // Top, free ends and the reveals of every opening.
    const b = new Builder()
    b.polygon([g.la, g.lb, g.rb, g.ra], top, true)
    const up = new Vector3(0, 1, 0)
    if (g.freeA) b.quad([V3(g.la, bottom), V3(g.ra, bottom), V3(g.ra, top), V3(g.la, top)], new Vector3(-g.d[0], 0, -g.d[1]), [[0, bottom], [1, bottom], [1, top], [0, top]])
    if (g.freeB) b.quad([V3(g.lb, bottom), V3(g.rb, bottom), V3(g.rb, top), V3(g.lb, top)], new Vector3(g.d[0], 0, g.d[1]), [[0, bottom], [1, bottom], [1, top], [0, top]])
    const L = (u: number, v: number) => new Vector3(w.a[0] + g.d[0] * u + g.n[0] * g.h, v, w.a[1] + g.d[1] * u + g.n[1] * g.h)
    const R = (u: number, v: number) => new Vector3(w.a[0] + g.d[0] * u - g.n[0] * g.h, v, w.a[1] + g.d[1] * u - g.n[1] * g.h)
    for (const h of holes) {
      const dn = new Vector3(g.d[0], 0, g.d[1])
      if (h.cap0 !== false) b.quad([L(h.u0, h.v0), L(h.u0, h.v1), R(h.u0, h.v1), R(h.u0, h.v0)], dn, [[0, h.v0], [0, h.v1], [1, h.v1], [1, h.v0]])
      if (h.cap1 !== false) b.quad([L(h.u1, h.v0), L(h.u1, h.v1), R(h.u1, h.v1), R(h.u1, h.v0)], dn.clone().negate(), [[0, h.v0], [0, h.v1], [1, h.v1], [1, h.v0]])
      b.quad([L(h.u0, h.v1), L(h.u1, h.v1), R(h.u1, h.v1), R(h.u0, h.v1)], up.clone().negate(), [[h.u0, 0], [h.u1, 0], [h.u1, 1], [h.u0, 1]])
      if (h.v0 > 0.001) b.quad([L(h.u0, h.v0), L(h.u1, h.v0), R(h.u1, h.v0), R(h.u0, h.v0)], up, [[h.u0, 0], [h.u1, 0], [h.u1, 1], [h.u0, 1]])
    }
    group.add(mesh(b.geometry(), plaster, 'wall top', { kind: 'wall', id }))

    // Doors and windows.
    for (const c of clipped) {
      const o = c.o
      const H = Math.min(top - 0.01, o.sill + o.height) - o.sill
      let model: Group | null = null
      let u: number
      if (!w.parentId) {
        u = o.t
        const segAt = g.segments.find((sg) => u >= sg.u0 && u <= sg.u1) ?? g.segments[0]
        model = buildOpening(o, g, H, segAt.left !== null ? 'left' : segAt.right !== null ? 'right' : 'left', onUpgrade)
      } else {
        u = (c.u0 + c.u1) / 2
        const segAt = g.segments.find((sg) => u >= sg.u0 && u <= sg.u1) ?? g.segments[0]
        const interior = segAt.left !== null ? 'left' : segAt.right !== null ? 'right' : 'left'
        const window = !OPENING_DEFAULTS[o.kind].door && o.kind !== 'french-window'
        if (window) model = windowPiece(o, g, c.u1 - c.u0, H, c.cap0, c.cap1, interior, onUpgrade)
        else if (o.t >= s0 && o.t < s0 + segArc) {
          // Doors on a curve: one flat door across the opening, on the piece at its middle.
          u = (o.t - s0) * k
          model = buildOpening(o, g, H, interior, onUpgrade)
        }
      }
      if (!model) continue
      // An opening to the outside lets daylight in (into the room side).
      if (!w.parentId) {
        const sg = g.segments.find((x) => u >= x.u0 && u <= x.u1) ?? g.segments[0]
        if ((sg.left === null) !== (sg.right === null) && (o.kind !== 'door' && o.kind !== 'double-door')) {
          const inward: Vec2 = sg.left !== null ? [g.n[0], g.n[1]] : [-g.n[0], -g.n[1]]
          const p: Vec2 = [w.a[0] + g.d[0] * u + inward[0] * (g.h + 0.03), w.a[1] + g.d[1] * u + inward[1] * (g.h + 0.03)]
          portals.push({ c: [p[0], o.sill + H / 2, p[1]], n: inward, w: Math.max(0.2, o.width - 0.1), h: Math.max(0.2, H - 0.1) })
        }
      }
      model.position.set(w.a[0] + g.d[0] * u, o.sill, w.a[1] + g.d[1] * u)
      model.rotation.y = -Math.atan2(g.d[1], g.d[0])
      model.traverse((x) => (x.userData.pick = { kind: 'opening', id: o.id } satisfies PickInfo))
      group.add(model)
    }
  }

  for (const e of trims.values()) {
    const merged = mergeGeometries(e.geos)
    e.geos.forEach((x) => x.dispose())
    if (!merged) continue
    const info = faceRoom[e.face]
    group.add(mesh(merged, finishMaterial({ color: e.color }, 'frame', onUpgrade), 'wall trim', { kind: 'room', id: info?.id ?? `face:${e.face}`, face: e.face }))
  }

  if (geom.caps.length) {
    const b = new Builder()
    for (const c of geom.caps) b.polygon(c, Math.max(...walls.map((w) => w.height ?? level.height)), true)
    group.add(mesh(b.geometry(), plaster, 'wall joints'))
  }

  // Floors, slabs and ceilings for every room the walls enclose.
  geom.faces.forEach((f, i) => {
    const info = faceRoom[i]
    const fh = (input.floorHoles ?? []).filter((h) => h.every((p) => pointInPolygon(p, f.polygon)))
    const ch = (input.ceilingHoles ?? []).filter((h) => h.every((p) => pointInPolygon(p, f.polygon)))
    const pick: PickInfo = { kind: 'room', id: info?.id ?? `face:${i}`, face: i }
    const fb = new Builder()
    fb.polygon(f.polygon, 0, true, fh)
    const fgeo = fb.geometry()
    // Floor patterns (boards, herringbone, tiles) start from the middle of the room: the cuts at
    // opposite walls match.
    if ((info?.floor ?? DEFAULT_FLOOR_FINISH).preset) {
      const xs = f.inner.map((p) => p[0])
      const ys = f.inner.map((p) => p[1])
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2
      const uvs = fgeo.attributes.uv
      for (let k = 0; k < uvs.count; k++) uvs.setXY(k, uvs.getX(k) - cx, uvs.getY(k) - cy)
    }
    group.add(mesh(fgeo, finishMaterial(info?.floor ?? DEFAULT_FLOOR_FINISH, 'floor', onUpgrade), 'floor', pick))
    if (input.levelIndex > 0) {
      const shape = new Shape(f.polygon.map((p) => new Vector2(p[0], -p[1])))
      for (const h of fh) shape.holes.push(new Shape(h.map((p) => new Vector2(p[0], -p[1]))))
      const slab = new ExtrudeGeometry(shape, { depth: level.slab - 0.002, bevelEnabled: false })
      slab.rotateX(-Math.PI / 2) // extrude along +z → +y, shape y → -z (so plan y → +z)
      slab.translate(0, -level.slab, 0)
      group.add(mesh(slab, plaster, 'slab'))
    }
    // Ceiling: flat at the room's height, or sloping / pitched. Boards fit the room (whole boards
    // wall to wall, joints on the beams); the frame is the room's inner outline.
    const roof = info?.roof ?? flatRoof(level.height)
    const frame = roofFrame(f.inner, roof)
    const ceilFinish = info?.ceiling ?? DEFAULT_CEILING_FINISH
    const spec = presetById(ceilFinish.preset)?.ceiling
    const uv = spec ? boardFit(roof, frame, spec.tile, info?.beams) : (a: number, c: number): [number, number] => [a, c]
    const ceil = mesh(ceilingGeometry(f.polygon, roof, frame, ch, uv), finishMaterial(ceilFinish, 'ceiling', onUpgrade), 'ceiling', pick)
    // Ceilings shade the rooms from the sun when they are shown (the roof is on).
    ceil.userData.ceiling = true
    group.add(ceil)
    // Walls up to a ceiling higher than their top (gable ends, the high side of a lean-to).
    if (ceilingTop(roof) > level.height + 1e-3) {
      const edges = f.edges.map((e) => {
        const w = walls.find((x) => x.id === e.wallId)
        return { a: e.from, b: e.to, h: e.h, top: Math.max(0.1, w?.height ?? level.height) }
      })
      const ig = infillGeometry(edges, roof, frame)
      if (ig) {
        const im = mesh(ig, finishMaterial(info?.walls ?? DEFAULT_WALL_FINISH, 'wall', onUpgrade), 'gable wall', pick)
        im.userData.ceiling = true
        group.add(im)
      }
    }
    if (info?.beams) {
      const bg = rafterGeometry(f.inner, roof, info.beams)
      if (bg) {
        const bm = mesh(bg, finishMaterial({ color: info.beams.color }, 'frame', onUpgrade), 'ceiling beams', pick)
        bm.userData.ceiling = true
        group.add(bm)
      }
    }
  })

  // Glass lets the sun through: it must not cast shadows (in the real-time view).
  group.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh && m.material === GLASS) m.castShadow = false
  })
  return { group, geom, portals }
}

// ───────────── doors and windows ─────────────

/**
 * One opening's joinery, in local space: x along the wall, y up from the sill, z through the
 * wall towards its left side. The interior side gets the window board.
 */
function buildOpening(o: Opening, g: WallGeom, height: number, interior: 'left' | 'right', onUpgrade?: () => void): Group {
  const grp = new Group()
  grp.name = OPENING_DEFAULTS[o.kind].label
  const W = o.width
  const H = height
  const T = g.h * 2
  const frameM = finishMaterial(o.frame, 'frame', onUpgrade)
  const jamb = 0.02
  const zIn = interior === 'left' ? 1 : -1

  // Lining inside the hole.
  grp.add(box(jamb, H, T + 0.004, frameM, -W / 2 + jamb / 2, H / 2, 0))
  grp.add(box(jamb, H, T + 0.004, frameM, W / 2 - jamb / 2, H / 2, 0))
  grp.add(box(W, jamb, T + 0.004, frameM, 0, H - jamb / 2, 0))

  const isDoor = OPENING_DEFAULTS[o.kind].door
  // Architraves (casing) around doors, on both faces.
  if (isDoor) {
    const cw = 0.07
    const ct = 0.015
    for (const s of [1, -1]) {
      const z = s * (T / 2 + ct / 2)
      grp.add(box(cw, H + cw, ct, frameM, -W / 2 - cw / 2, (H + cw) / 2, z))
      grp.add(box(cw, H + cw, ct, frameM, W / 2 + cw / 2, (H + cw) / 2, z))
      grp.add(box(W + cw * 2, cw, ct, frameM, 0, H + cw / 2, z))
    }
  }

  const leafSide = o.side === 'left' ? 1 : -1
  const open = Math.max(0, Math.min(1, o.open))

  const doorLeaf = (w: number, hingeX: number, dir: 1 | -1, glass: boolean) => {
    // dir: +1 = hinge on the left edge (leaf extends to +x), -1 = hinge on the right edge.
    const pivot = new Group()
    pivot.position.set(hingeX, 0, leafSide * (T / 2 - 0.025))
    const leafT = 0.04
    const lh = H - jamb - 0.008
    const leaf = new Group()
    leaf.position.set((dir * w) / 2, 0, 0)
    if (glass) {
      const fw = 0.06
      leaf.add(box(w, fw, leafT, frameM, 0, fw / 2 + 0.005, 0))
      leaf.add(box(w, fw * 1.6, leafT, frameM, 0, lh - fw * 0.8, 0))
      leaf.add(box(fw, lh, leafT, frameM, -w / 2 + fw / 2, lh / 2, 0))
      leaf.add(box(fw, lh, leafT, frameM, w / 2 - fw / 2, lh / 2, 0))
      const pane = new Mesh(new BoxGeometry(w - fw * 2, lh - fw * 2.6, 0.006), GLASS)
      pane.position.set(0, (lh - fw * 1.6) / 2 + fw / 2, 0)
      leaf.add(pane)
    } else {
      leaf.add(box(w, lh, leafT, frameM, 0, lh / 2 + 0.005, 0))
      // Two shallow raised panels on each face.
      for (const s of [1, -1])
        for (const [py, ph] of [
          [lh * 0.27, lh * 0.36],
          [lh * 0.72, lh * 0.4],
        ] as const)
          leaf.add(box(w * 0.66, ph, 0.006, frameM, 0, py, (s * leafT) / 2 + s * 0.002))
    }
    // Lever handles on both faces, at the latch edge.
    const hx = dir * (w / 2 - 0.07)
    for (const s of [1, -1]) {
      const rose = new Mesh(new CylinderGeometry(0.026, 0.026, 0.01, 24), STEEL)
      rose.rotation.x = Math.PI / 2
      rose.position.set(hx, 1.0, s * (leafT / 2 + 0.005))
      const lever = new Mesh(new CylinderGeometry(0.009, 0.009, 0.13, 16), STEEL)
      lever.rotation.z = Math.PI / 2
      lever.position.set(hx - dir * 0.055, 1.0, s * (leafT / 2 + 0.05))
      const neck = new Mesh(new CylinderGeometry(0.009, 0.009, 0.05, 16), STEEL)
      neck.rotation.x = Math.PI / 2
      neck.position.set(hx, 1.0, s * (leafT / 2 + 0.03))
      leaf.add(rose, lever, neck)
    }
    pivot.add(leaf)
    // Opening swings the leaf towards its side.
    pivot.rotation.y = -dir * leafSide * open * (Math.PI / 2) * 0.95
    return pivot
  }

  const inner = W - jamb * 2
  if (o.kind === 'door') grp.add(o.hinge === 'a' ? doorLeaf(inner, -inner / 2, 1, false) : doorLeaf(inner, inner / 2, -1, false))
  if (o.kind === 'double-door') grp.add(doorLeaf(inner / 2, -inner / 2, 1, false), doorLeaf(inner / 2, inner / 2, -1, false))
  if (o.kind === 'french-window') grp.add(doorLeaf(inner / 2, -inner / 2, 1, true), doorLeaf(inner / 2, inner / 2, -1, true))
  if (o.kind === 'sliding-door') {
    const pw = inner / 2 + 0.03
    const lh = H - jamb - 0.01
    for (const [i, x] of [
      [0, -inner / 4],
      [1, inner / 4 - open * (inner / 2 - 0.05)],
    ] as const) {
      const p = new Group()
      p.position.set(x, 0, (i === 0 ? 1 : -1) * 0.025)
      const fw = 0.05
      p.add(box(pw, fw, 0.04, ALU, 0, fw / 2, 0), box(pw, fw, 0.04, ALU, 0, lh - fw / 2, 0), box(fw, lh, 0.04, ALU, -pw / 2 + fw / 2, lh / 2, 0), box(fw, lh, 0.04, ALU, pw / 2 - fw / 2, lh / 2, 0))
      const pane = new Mesh(new BoxGeometry(pw - fw * 2, lh - fw * 2, 0.006), GLASS)
      pane.position.set(0, lh / 2, 0)
      p.add(pane)
      grp.add(p)
    }
  }
  if (o.kind === 'window' || o.kind === 'wide-window' || o.kind === 'floor-window') {
    const fw = 0.06
    const depth = 0.07
    // Outer frame.
    grp.add(box(inner, fw, depth, frameM, 0, fw / 2, 0), box(inner, fw, depth, frameM, 0, H - jamb - fw / 2, 0))
    grp.add(box(fw, H - jamb, depth, frameM, -inner / 2 + fw / 2, (H - jamb) / 2, 0), box(fw, H - jamb, depth, frameM, inner / 2 - fw / 2, (H - jamb) / 2, 0))
    const n = W > 2.2 ? 3 : W > 1.15 ? 2 : 1
    const sw = (inner - fw * 2) / n
    for (let i = 1; i < n; i++) grp.add(box(fw, H - jamb - fw * 2, depth, frameM, -inner / 2 + fw + sw * i, (H - jamb) / 2, 0))
    for (let i = 0; i < n; i++) {
      const sash = new Group()
      const sx = -inner / 2 + fw + sw * i + sw / 2
      const sh = H - jamb - fw * 2
      const sf = 0.045
      sash.add(box(sw, sf, 0.05, frameM, 0, sf / 2, 0), box(sw, sf, 0.05, frameM, 0, sh - sf / 2, 0), box(sf, sh, 0.05, frameM, -sw / 2 + sf / 2, sh / 2, 0), box(sf, sh, 0.05, frameM, sw / 2 - sf / 2, sh / 2, 0))
      const pane = new Mesh(new BoxGeometry(sw - sf * 2, sh - sf * 2, 0.006), GLASS)
      pane.position.set(0, sh / 2, 0)
      sash.add(pane)
      sash.position.set(sx, fw, 0)
      grp.add(sash)
    }
    // Window board inside, sill outside (not on a window down to the floor). Their tops stand 4 mm
    // proud of the hole's bottom (not in the same plane as the wall's reveal, which would flicker).
    if (o.sill > 0.05) grp.add(box(W + 0.06, 0.025, T / 2 + 0.04, frameM, 0, -0.0125 + 0.004, zIn * (T / 4 + 0.02)))
    if (o.sill > 0.05) grp.add(box(W + 0.04, 0.03, T / 2 + 0.05, ALU, 0, -0.015 + 0.004, -zIn * (T / 4 + 0.025)))
  }
  if (o.kind === 'french-window') grp.add(box(W, 0.02, T + 0.004, frameM, 0, 0.01, 0))
  return grp
}

/**
 * One piece of a window on a curved wall: rails, glass and window board along this piece, with the
 * jamb and frame stile only where the window really starts or ends. Side by side, the pieces make a
 * window that follows the curve.
 */
function windowPiece(o: Opening, g: WallGeom, len: number, H: number, cap0: boolean, cap1: boolean, interior: 'left' | 'right', onUpgrade?: () => void): Group {
  const grp = new Group()
  grp.name = `${OPENING_DEFAULTS[o.kind].label} (curved)`
  const T = g.h * 2
  const frameM = finishMaterial(o.frame, 'frame', onUpgrade)
  const jamb = 0.02
  const fw = 0.06
  const depth = 0.07
  const zIn = interior === 'left' ? 1 : -1
  // A hair longer than the piece so neighbouring pieces overlap instead of leaving a seam.
  const L = len + 0.004
  grp.add(box(L, jamb, T + 0.004, frameM, 0, H - jamb / 2, 0))
  grp.add(box(L, fw, depth, frameM, 0, fw / 2, 0), box(L, fw, depth, frameM, 0, H - jamb - fw / 2, 0))
  for (const [cap, sx] of [
    [cap0, -1],
    [cap1, 1],
  ] as const) {
    if (!cap) continue
    grp.add(box(jamb, H, T + 0.004, frameM, sx * (len / 2 - jamb / 2), H / 2, 0))
    grp.add(box(fw, H - jamb, depth, frameM, sx * (len / 2 - jamb - fw / 2), (H - jamb) / 2, 0))
  }
  // Glass: a thin sheet exactly as long as the piece, on the wall's centre line, so neighbouring
  // pieces meet edge to edge and read as one bent pane (no overlaps, no edges showing as lines).
  const sheet = new PlaneGeometry(len, Math.max(0.01, H - jamb - fw * 2))
  // Normals follow the circle (like the wall), so reflections glide smoothly across the pieces.
  const c = g.wall.centre
  if (c) {
    const mid: Vec2 = [(g.wall.a[0] + g.wall.b[0]) / 2, (g.wall.a[1] + g.wall.b[1]) / 2]
    const cz = (c[0] - mid[0]) * g.n[0] + (c[1] - mid[1]) * g.n[1] // the centre, in the piece's local z
    const pos = sheet.attributes.position
    const nor = sheet.attributes.normal
    for (let i = 0; i < pos.count; i++) {
      const v = new Vector3(pos.getX(i), 0, -cz).normalize()
      if (v.z < 0) v.negate()
      nor.setXYZ(i, v.x, 0, v.z)
    }
    nor.needsUpdate = true
  }
  const pane = new Mesh(sheet, GLASS)
  pane.position.set(0, (H - jamb) / 2, 0)
  grp.add(pane)
  if (o.sill > 0.05) {
    grp.add(box(L, 0.025, T / 2 + 0.04, frameM, 0, -0.0125 + 0.004, zIn * (T / 4 + 0.02)))
    grp.add(box(L, 0.03, T / 2 + 0.05, ALU, 0, -0.015 + 0.004, -zIn * (T / 4 + 0.025)))
  }
  return grp
}

/** The interior point of a room face, for labels and cameras (re-exported for the UI). */
export { interiorPoint }
