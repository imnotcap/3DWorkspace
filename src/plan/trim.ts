import { BoxGeometry, Matrix4, type BufferGeometry } from 'three'
import type { WallGeom } from './geometry'
import type { RoomTrim } from './types'

/** Something on the wall that panelling stops around (a radiator): along-wall span and height. */
export interface TrimObstacle {
  a: number
  b: number
  sill: number
  top: number
}

/**
 * Wall panelling and skirting along one wall face, as plain boxes (merged by the caller).
 * Positions along the wall are in run coordinates `s` (metres along the wall, or along a curved
 * wall's arc); this piece of wall covers `[pieceA, pieceB]` of the run, mapped to its own u by
 * `u = (s − s0) · k`. Openings interrupt everything they overlap in height; frames line up with
 * the windows and doors above or below them and go around radiators.
 */
export interface TrimInput {
  g: WallGeom
  side: 'left' | 'right'
  trim: RoomTrim
  ceiling: number
  /** The whole face being panelled, in run coordinates. */
  run: [number, number]
  /** This piece's share of it. */
  piece: [number, number]
  s0: number
  k: number
  openings: TrimObstacle[]
  /** Radiators and the like on this face. */
  obstacles?: TrimObstacle[]
}

/** Heights of the panelling: skirting top, frame zone, rail. */
export function trimLevels(trim: RoomTrim, ceiling: number) {
  const H = trim.skirting === 'none' ? 0 : trim.skirtHeight
  const full = trim.panels === 'full-height'
  const top = full ? ceiling - 0.12 : Math.min(trim.panelHeight, ceiling - 0.1)
  return { H, top, zb: H + 0.06, zt: full ? top - 0.08 : top - 0.07 }
}

/** The spans of [run] not interrupted by `holes` in the height band v0..v1. */
function freeSpans(run: [number, number], holes: TrimObstacle[], v0: number, v1: number, minLen = 0.05) {
  let spans: [number, number][] = [[run[0], run[1]]]
  for (const o of holes) {
    if (o.sill >= v1 || o.top <= v0) continue
    spans = spans.flatMap(([a, b]) => (o.b <= a || o.a >= b ? [[a, b] as [number, number]] : ([[a, o.a], [o.b, b]] as [number, number][]).filter(([x, y]) => y - x > minLen)))
  }
  return spans
}

/**
 * Panel frames between heights v0 and v1: each free stretch is split at the edges of the openings
 * above or below the band (a frame sits exactly under a window), then filled with frames of about
 * `width`, `gap` apart.
 */
export function frameLayout(run: [number, number], openings: TrimObstacle[], obstacles: TrimObstacle[], v0: number, v1: number, width: number, gap: number): [number, number][] {
  const res: [number, number][] = []
  for (const [a, b] of freeSpans(run, [...openings, ...obstacles], v0, v1, 0.25)) {
    // Openings clear of the band but over (or under) this stretch: frames follow their edges.
    const marks = openings
      .filter((o) => (o.sill >= v1 || o.top <= v0) && o.a > a + gap + 0.15 && o.b < b - gap - 0.15)
      .sort((p, q) => p.a - q.a)
    const segs: { a: number; b: number; inA: number; inB: number; one?: boolean }[] = []
    let cur = a
    let inA = gap
    for (const o of marks) {
      if (o.a - cur < 0.12) continue
      segs.push({ a: cur, b: o.a, inA, inB: gap })
      segs.push({ a: o.a, b: o.b, inA: 0, inB: 0, one: o.b - o.a < 1.9 })
      cur = o.b
      inA = gap
    }
    segs.push({ a: cur, b, inA, inB: gap })
    for (const s of segs) {
      const L = s.b - s.a - s.inA - s.inB
      if (L < 0.12) continue
      // Under (or over) a window: one frame, as wide as the window.
      const n = s.one ? 1 : Math.max(1, Math.round((L + gap) / (width + gap)))
      const pw = (L - gap * (n - 1)) / n
      if (pw < 0.12) continue
      for (let i = 0; i < n; i++) {
        const x = s.a + s.inA + i * (pw + gap)
        res.push([x, x + pw])
      }
    }
  }
  return res
}

/** The lower row of frames of a style (where sockets are centred), or null for styles without frames. */
export function lowerFrames(trim: RoomTrim, ceiling: number, run: [number, number], openings: TrimObstacle[], obstacles: TrimObstacle[] = []) {
  const { zb, zt } = trimLevels(trim, ceiling)
  switch (trim.panels) {
    case 'frames':
    case 'tall-frames':
      return { v0: zb, v1: zt, spans: frameLayout(run, openings, obstacles, zb, zt, 0.6, 0.1) }
    case 'raised':
      return { v0: zb, v1: zt, spans: frameLayout(run, openings, obstacles, zb, zt, 0.55, 0.12) }
    case 'two-tier': {
      const mid = zb + (zt - zb) * 0.3
      return { v0: zb, v1: mid - 0.05, spans: frameLayout(run, openings, obstacles, zb, mid - 0.05, 0.9, 0.1) }
    }
    case 'full-height': {
      const low = zb + Math.min(0.75, (zt - zb) * 0.3)
      return { v0: zb, v1: low, spans: frameLayout(run, openings, obstacles, zb, low, 0.6, 0.1) }
    }
    default:
      return null
  }
}

export function trimGeometry(t: TrimInput): BufferGeometry[] {
  const { g, trim } = t
  const out: BufferGeometry[] = []
  const sgn = t.side === 'left' ? 1 : -1
  const nx = g.n[0] * sgn
  const ny = g.n[1] * sgn
  const yaw = -Math.atan2(g.d[1], g.d[0])
  const m = new Matrix4()
  const r = new Matrix4()
  const obstacles = t.obstacles ?? []

  /** A box from sA to sB along the wall, v0..v1 high, `depth` out of the wall (standing `off` proud). */
  const box = (sA: number, sB: number, v0: number, v1: number, depth: number, off = 0) => {
    const a = Math.max(sA, t.piece[0])
    const b = Math.min(sB, t.piece[1])
    if (b - a < 1e-4 || v1 - v0 < 1e-4) return
    const u = ((a + b) / 2 - t.s0) * t.k
    const len = (b - a) * t.k + 0.0015 // a hair long so pieces of a curved wall meet
    const geo = new BoxGeometry(len, v1 - v0, depth)
    const px = g.wall.a[0] + g.d[0] * u + nx * (g.h + off + depth / 2)
    const pz = g.wall.a[1] + g.d[1] * u + ny * (g.h + off + depth / 2)
    geo.applyMatrix4(m.makeTranslation(px, (v0 + v1) / 2, pz).multiply(r.makeRotationY(yaw)))
    out.push(geo)
  }

  /** The run minus whatever openings reach into the height band v0..v1. */
  const free = (v0: number, v1: number, minLen = 0.05) => freeSpans(t.run, t.openings, v0, v1, minLen)
  const frames = (v0: number, v1: number, width: number, gap: number) => frameLayout(t.run, t.openings, obstacles, v0, v1, width, gap)

  const { H, top, zb, zt } = trimLevels(trim, t.ceiling)

  /**
   * Windows whose board comes down into the panelling: under them the panelling goes on up to the
   * window board (which then serves as the rail). Not where a radiator stands.
   */
  const under = (v0: number, v1: number, behindRadiators = false) =>
    t.openings
      .filter((o) => o.sill > v0 + 0.12 && o.sill < v1 && o.top > v1)
      .map((o) => ({ a: o.a, b: o.b, top: o.sill }))
      .filter((u) => behindRadiators || !obstacles.some((x) => x.a < u.b && x.b > u.a && x.sill < u.top && x.top > v0))
  /** Frames under those windows, lined up with the window's edges. */
  const underFrames = (v0: number, w: number, depth: number, off = 0) => {
    for (const u of under(v0, zt + 0.07)) if (u.top - 0.06 - v0 > 0.15) moulding(u.a + 0.04, u.b - 0.04, v0, u.top - 0.06, w, depth, off)
  }

  // ── Skirting ──
  if (trim.skirting !== 'none')
    for (const [a, b] of free(0, H)) {
      if (trim.skirting === 'flat') box(a, b, 0, H, 0.015)
      else if (trim.skirting === 'classic') {
        box(a, b, 0, H - 0.015, 0.015)
        box(a, b, H - 0.02, H, 0.022)
      } else if (trim.skirting === 'tall') {
        box(a, b, 0, H, 0.018)
        box(a, b, H - 0.03, H - 0.012, 0.026)
        box(a, b, H - 0.012, H, 0.021)
      } else if (trim.skirting === 'ogee') {
        // A stepped ogee: deep at the foot, a cove, a bead and a thin top edge.
        box(a, b, 0, H * 0.55, 0.02)
        box(a, b, H * 0.55, H * 0.7, 0.024)
        box(a, b, H * 0.7, H * 0.78, 0.018)
        box(a, b, H * 0.78, H * 0.9, 0.022)
        box(a, b, H * 0.9, H, 0.014)
      } else if (trim.skirting === 'shadow') {
        // Modern: a flat board standing off the floor on a dark shadow gap.
        box(a, b, 0, 0.012, 0.006)
        box(a, b, 0.012, H, 0.014)
      }
    }

  if (trim.panels === 'none') return out

  function moulding(a: number, b: number, v0: number, v1: number, w: number, depth: number, off = 0) {
    box(a, b, v0, v0 + w, depth, off)
    box(a, b, v1 - w, v1, depth, off)
    box(a, a + w, v0 + w, v1 - w, depth, off)
    box(b - w, b, v0 + w, v1 - w, depth, off)
  }
  /** A dado rail along the top of the panelling. */
  const rail = (y: number) => {
    for (const [a, b] of free(y - 0.05, y)) {
      box(a, b, y - 0.05, y - 0.01, 0.028)
      box(a, b, y - 0.012, y + 0.008, 0.038)
    }
  }

  switch (trim.panels) {
    case 'frames':
    case 'tall-frames': {
      rail(top)
      for (const [a, b] of frames(zb, zt, 0.6, 0.1)) moulding(a, b, zb, zt, 0.032, 0.014)
      underFrames(zb, 0.032, 0.014)
      if (trim.panels === 'tall-frames') {
        // A second, tall row of frames above the rail, up to near the ceiling.
        const u0 = top + 0.12
        const u1 = t.ceiling - 0.22
        if (u1 - u0 > 0.3) for (const [a, b] of frames(u0, u1, 0.6, 0.1)) moulding(a, b, u0, u1, 0.032, 0.014)
      }
      break
    }
    case 'two-tier': {
      // A low row of wide frames, a mid rail, and the main row of frames above it.
      rail(top)
      const mid = zb + (zt - zb) * 0.3
      for (const [a, b] of frames(zb, mid - 0.05, 0.9, 0.1)) moulding(a, b, zb, mid - 0.05, 0.03, 0.013)
      for (const [a, b] of free(mid - 0.02, mid + 0.02)) box(a, b, mid - 0.018, mid + 0.018, 0.02)
      for (const [a, b] of frames(mid + 0.05, zt, 0.6, 0.1)) moulding(a, b, mid + 0.05, zt, 0.03, 0.013)
      for (const u of under(H, top)) {
        if (mid - 0.05 - zb > 0.1) moulding(u.a + 0.04, u.b - 0.04, zb, mid - 0.05, 0.03, 0.013)
        box(u.a, u.b, mid - 0.018, mid + 0.018, 0.02)
        if (u.top - 0.06 - (mid + 0.05) > 0.12) moulding(u.a + 0.04, u.b - 0.04, mid + 0.05, u.top - 0.06, 0.03, 0.013)
      }
      break
    }
    case 'full-height': {
      // Floor-to-ceiling: a low row and tall frames above, under a frieze rail near the ceiling.
      const low = zb + Math.min(0.75, (zt - zb) * 0.3)
      for (const [a, b] of frames(zb, low, 0.6, 0.1)) moulding(a, b, zb, low, 0.032, 0.014)
      for (const [a, b] of free(low + 0.02, low + 0.08)) box(a, b, low + 0.03, low + 0.07, 0.022)
      for (const [a, b] of frames(low + 0.1, zt, 0.6, 0.1)) moulding(a, b, low + 0.1, zt, 0.032, 0.014)
      for (const [a, b] of free(top, top + 0.06)) {
        box(a, b, top, top + 0.06, 0.016)
        box(a, b, top + 0.045, top + 0.06, 0.03)
      }
      break
    }
    case 'raised': {
      // Fielded panels: a board, frames, and each field raised in two bevelled steps.
      rail(top)
      for (const [a, b] of free(H, top - 0.05)) box(a, b, H, top - 0.05, 0.01)
      const fielded = (a: number, b: number, v0: number, v1: number) => {
        moulding(a, b, v0, v1, 0.028, 0.012, 0.01)
        box(a + 0.05, b - 0.05, v0 + 0.05, v1 - 0.05, 0.006, 0.01)
        box(a + 0.08, b - 0.08, v0 + 0.08, v1 - 0.08, 0.006, 0.016)
      }
      for (const [a, b] of frames(zb, zt, 0.55, 0.12)) fielded(a, b, zb, zt)
      for (const u of under(H, top)) {
        box(u.a, u.b, H, u.top, 0.01)
        if (u.top - 0.06 - zb > 0.2) fielded(u.a + 0.05, u.b - 0.05, zb, u.top - 0.06)
      }
      break
    }
    case 'shaker': {
      rail(top)
      for (const [a, b] of free(H, top - 0.05)) {
        box(a, b, H, top - 0.05, 0.01)
        box(a, b, H, zb + 0.04, 0.012, 0.01)
        box(a, b, zt, top - 0.05, 0.012, 0.01)
      }
      for (const [a, b] of frames(zb, zt, 0.55, 0.09)) {
        box(a - 0.09, a, zb + 0.04, zt, 0.012, 0.01)
        box(b, b + 0.09, zb + 0.04, zt, 0.012, 0.01)
      }
      for (const u of under(H, top)) {
        box(u.a, u.b, H, u.top, 0.01)
        box(u.a, u.b, H, zb + 0.04, 0.012, 0.01)
        box(u.a, u.a + 0.09, zb + 0.04, u.top, 0.012, 0.01)
        box(u.b - 0.09, u.b, zb + 0.04, u.top, 0.012, 0.01)
      }
      break
    }
    case 'beadboard': {
      rail(top)
      const boards = (a: number, b: number, v1: number) => {
        box(a, b, H, v1, 0.008)
        for (let s = a + 0.05; s < b - 0.02; s += 0.1) box(s - 0.004, s + 0.004, H + 0.01, v1 - 0.01, 0.004, 0.008)
      }
      for (const [a, b] of free(H, top - 0.05)) boards(a, b, top - 0.05)
      for (const u of under(H, top, true)) boards(u.a, u.b, u.top)
      break
    }
    case 'board-batten': {
      // Wide boards with battens over the joints, and a ledge on top.
      const battens = (a: number, b: number, v1: number) => {
        box(a, b, H, v1, 0.008)
        const n = Math.max(1, Math.round((b - a) / 0.4))
        for (let i = 0; i <= n; i++) {
          const s = a + ((b - a) * i) / n
          box(Math.max(a, s - 0.03), Math.min(b, s + 0.03), H, v1, 0.012, 0.008)
        }
      }
      for (const [a, b] of free(H, top)) battens(a, b, top - 0.04)
      for (const u of under(H, top, true)) battens(u.a, u.b, u.top)
      for (const [a, b] of free(top - 0.04, top)) {
        box(a, b, top - 0.04, top, 0.03)
        box(a, b, top - 0.012, top, 0.05)
      }
      break
    }
  }
  return out
}
