import { BoxGeometry, Matrix4, type BufferGeometry } from 'three'
import type { WallGeom } from './geometry'
import type { RoomTrim } from './types'

/**
 * Wall panelling and skirting along one wall face, as plain boxes (merged by the caller).
 * Positions along the wall are in run coordinates `s` (metres along the wall, or along a curved
 * wall's arc); this piece of wall covers `[pieceA, pieceB]` of the run, mapped to its own u by
 * `u = (s − s0) · k`. Openings interrupt everything they overlap in height.
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
  openings: { a: number; b: number; sill: number; top: number }[]
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
  const free = (v0: number, v1: number, minLen = 0.05) => {
    let spans: [number, number][] = [[t.run[0], t.run[1]]]
    for (const o of t.openings) {
      if (o.sill >= v1 || o.top <= v0) continue
      spans = spans.flatMap(([a, b]) => (o.b <= a || o.a >= b ? [[a, b] as [number, number]] : ([[a, o.a], [o.b, b]] as [number, number][]).filter(([x, y]) => y - x > minLen)))
    }
    return spans
  }

  // ── Skirting ──
  const H = trim.skirting === 'none' ? 0 : trim.skirtHeight
  if (trim.skirting !== 'none')
    for (const [a, b] of free(0, H)) {
      if (trim.skirting === 'flat') box(a, b, 0, H, 0.015)
      else if (trim.skirting === 'classic') {
        box(a, b, 0, H - 0.015, 0.015)
        box(a, b, H - 0.02, H, 0.022)
      } else {
        box(a, b, 0, H, 0.018)
        box(a, b, H - 0.03, H - 0.012, 0.026)
        box(a, b, H - 0.012, H, 0.021)
      }
    }

  if (trim.panels === 'none') return out

  // ── Panelling up to the rail ──
  const top = Math.min(trim.panelHeight, t.ceiling - 0.1)
  const zb = H + 0.06
  const zt = top - 0.07
  // Rail along the top.
  for (const [a, b] of free(top - 0.05, top)) {
    box(a, b, top - 0.05, top - 0.01, 0.028)
    box(a, b, top - 0.012, top + 0.008, 0.038)
  }

  /** Panel frames laid out evenly in each free stretch, between heights v0 and v1. */
  const frames = (v0: number, v1: number, width: number, gap: number) => {
    const res: [number, number][] = []
    for (const [a, b] of free(v0, v1, 0.25)) {
      const L = b - a
      const n = Math.max(1, Math.round((L - gap) / (width + gap)))
      const pw = (L - gap * (n + 1)) / n
      if (pw < 0.12) continue
      for (let i = 0; i < n; i++) res.push([a + gap + i * (pw + gap), a + gap + i * (pw + gap) + pw])
    }
    return res
  }
  const moulding = (a: number, b: number, v0: number, v1: number, w: number, depth: number, off = 0) => {
    box(a, b, v0, v0 + w, depth, off)
    box(a, b, v1 - w, v1, depth, off)
    box(a, a + w, v0 + w, v1 - w, depth, off)
    box(b - w, b, v0 + w, v1 - w, depth, off)
  }

  if (trim.panels === 'frames' || trim.panels === 'tall-frames') {
    for (const [a, b] of frames(zb, zt, 0.6, 0.1)) moulding(a, b, zb, zt, 0.032, 0.014)
    if (trim.panels === 'tall-frames') {
      // A second, tall row of frames above the rail, up to near the ceiling.
      const u0 = top + 0.12
      const u1 = t.ceiling - 0.22
      if (u1 - u0 > 0.3) for (const [a, b] of frames(u0, u1, 0.6, 0.1)) moulding(a, b, u0, u1, 0.032, 0.014)
    }
  } else if (trim.panels === 'raised') {
    for (const [a, b] of free(H, top - 0.05)) box(a, b, H, top - 0.05, 0.01)
    for (const [a, b] of frames(zb, zt, 0.55, 0.12)) {
      moulding(a, b, zb, zt, 0.028, 0.012, 0.01)
      box(a + 0.06, b - 0.06, zb + 0.06, zt - 0.06, 0.008, 0.01)
    }
  } else if (trim.panels === 'shaker') {
    for (const [a, b] of free(H, top - 0.05)) {
      box(a, b, H, top - 0.05, 0.01)
      box(a, b, H, zb + 0.04, 0.012, 0.01)
      box(a, b, zt, top - 0.05, 0.012, 0.01)
    }
    for (const [a, b] of frames(zb, zt, 0.55, 0.09)) {
      box(a - 0.09, a, zb + 0.04, zt, 0.012, 0.01)
      box(b, b + 0.09, zb + 0.04, zt, 0.012, 0.01)
    }
  } else if (trim.panels === 'beadboard') {
    for (const [a, b] of free(H, top - 0.05)) {
      box(a, b, H, top - 0.05, 0.008)
      for (let s = a + 0.05; s < b - 0.02; s += 0.1) box(s - 0.004, s + 0.004, H + 0.01, top - 0.06, 0.004, 0.008)
    }
  }
  return out
}
