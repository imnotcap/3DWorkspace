// Sockets and switches for a room, placed the way an electrician usually would: a double socket
// on each stretch of wall, one more per 3.6 m on long walls (centre 30 cm above the floor), never
// in a door or window, never behind a radiator, and centred in a wall-panel field when the room
// is panelled; a light switch by each door on the handle side (centre 105 cm,
// 20 cm from the frame). Bathrooms get one socket by the basin height (110 cm).
import { itemById } from '@/furniture/catalog'
import { slotOverrides } from './place'
import { footprint } from './footprint'
import { obstaclesOn, trimHole } from './build'
import { lowerFrames } from './trim'
import type { PlanGeom, WallGeom } from './geometry'
import { DEFAULT_TRIM, type Level, type Opening, type RoomInfo, type Vec2 } from './types'
import type { SceneObject } from '@/store/workspace'

export const ELECTRICAL = new Set(['socket', 'double-socket', 'switch', 'double-switch', 'data-socket'])

interface Spot {
  item: 'double-socket' | 'switch'
  g: WallGeom
  side: 'left' | 'right'
  s: number
  y: number
}

/** The faces of the room: straight wall sides that look into it, with their run along the wall. */
function roomFaces(geom: PlanGeom, face: number) {
  const out: { g: WallGeom; side: 'left' | 'right'; u0: number; u1: number }[] = []
  for (const g of geom.walls.values()) {
    if (g.wall.parentId) continue
    for (const side of ['left', 'right'] as const) {
      const c0 = side === 'left' ? g.la : g.ra
      const c1 = side === 'left' ? g.lb : g.rb
      const uStart = (c0[0] - g.wall.a[0]) * g.d[0] + (c0[1] - g.wall.a[1]) * g.d[1]
      const uEnd = (c1[0] - g.wall.a[0]) * g.d[0] + (c1[1] - g.wall.a[1]) * g.d[1]
      g.segments.forEach((sg, i) => {
        if ((side === 'left' ? sg.left : sg.right) !== face) return
        // Inner joints (T-junctions) are at the crossing wall's centre: keep clear of its thickness.
        const u0 = i === 0 ? uStart : sg.u0 + 0.08
        const u1 = i === g.segments.length - 1 ? uEnd : sg.u1 - 0.08
        if (u1 - u0 > 0.3) out.push({ g, side, u0, u1 })
      })
    }
  }
  return out
}

/** Where the sockets and switches go in one room (by face index). */
export function electricalFor(input: { geom: PlanGeom; face: number; info?: RoomInfo; level: Level; openings: Opening[]; objects: SceneObject[] }): Omit<SceneObject, 'id'>[] {
  const { geom, face, info, level } = input
  const trim = info?.trim ?? DEFAULT_TRIM
  const radiators = input.objects
    .filter((o) => o.furniture?.item === 'radiator')
    .map((o) => {
      const f = footprint(o)
      const y0 = o.transform.position[1]
      return { c: f.c, w: f.w, d: f.d, yaw: f.yaw, y0, y1: y0 + o.furniture!.size[1] * o.transform.scale[1] }
    })
  const wet = /\b(bad|wc|toilet|bath|badeværelse)/i.test(info?.name ?? '')
  const spots: Spot[] = []
  const faces = roomFaces(geom, face)

  for (const f of faces) {
    const id = f.g.wall.id
    const holes = input.openings.filter((o) => o.wallId === id).map((o) => ({ a: o.t - o.width / 2, b: o.t + o.width / 2, sill: o.sill, top: o.sill + o.height, o }))
    // Switches: by each door or passage into the room, on the handle side.
    for (const h of holes) {
      if (!['door', 'double-door', 'sliding-door', 'archway'].includes(h.o.kind)) continue
      const latchB = h.o.kind !== 'door' || h.o.hinge === 'a'
      const cands = latchB ? [h.b + 0.2, h.a - 0.2] : [h.a - 0.2, h.b + 0.2]
      const s = cands.find((x) => x > f.u0 + 0.1 && x < f.u1 - 0.1 && !holes.some((o) => x > o.a - 0.08 && x < o.b + 0.08))
      if (s !== undefined) spots.push({ item: 'switch', g: f.g, side: f.side, s, y: 1.05 })
    }
  }

  // Sockets: blocked where openings reach down to socket height, and behind radiators.
  const y = wet ? 1.1 : 0.3
  const free = (f: (typeof faces)[number]) => {
    const id = f.g.wall.id
    const blocked = [
      ...input.openings.filter((o) => o.wallId === id && o.sill < y + 0.1).map((o) => [o.t - o.width / 2 - 0.15, o.t + o.width / 2 + 0.15] as [number, number]),
      ...obstaclesOn(f.g, f.side, radiators).filter((o) => o.sill < y + 0.1 && o.top > y - 0.1).map((o) => [o.a - 0.05, o.b + 0.05] as [number, number]),
      ...spots.filter((p) => p.g === f.g && p.side === f.side).map((p) => [p.s - 0.15, p.s + 0.15] as [number, number]),
    ]
    let spans: [number, number][] = [[f.u0 + 0.25, f.u1 - 0.25]]
    for (const [a, b] of blocked) spans = spans.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q] as [number, number]] : ([[p, a], [b, q]] as [number, number][]).filter(([x, z]) => z - x > 0.1)))
    return spans
  }
  const sockets: { f: (typeof faces)[number]; s: number }[] = []
  if (wet) {
    // One, on the longest free stretch.
    let best: { f: (typeof faces)[number]; s: number; L: number } | null = null
    for (const f of faces) for (const [a, b] of free(f)) if (!best || b - a > best.L) best = { f, s: (a + b) / 2, L: b - a }
    if (best) sockets.push(best)
  } else
    for (const f of faces)
      for (const [a, b] of free(f)) {
        const L = b - a
        // One per stretch of wall up to 3.6 m (in its middle); longer ones get one more per 3.6 m, spread out.
        if (L < 0.3) continue
        const n = L < 3.6 ? 1 : 1 + Math.ceil((L - 3.6) / 3.6)
        for (let i = 0; i < n; i++) sockets.push({ f, s: n === 1 ? (a + b) / 2 : a + 0.3 + ((L - 0.6) * i) / (n - 1) })
      }

  // In a panelled room, a socket sits in the middle of the panel field it falls in.
  for (const p of sockets) {
    const holes = input.openings.filter((o) => o.wallId === p.f.g.wall.id).map(trimHole)
    const fr = lowerFrames(trim, p.f.g.wall.height ?? level.height, [p.f.u0, p.f.u1], holes, obstaclesOn(p.f.g, p.f.side, radiators))
    if (fr && fr.v0 < y - 0.045 && fr.v1 > y + 0.045) {
      const span = fr.spans.find(([a, b]) => p.s >= a - 0.05 && p.s <= b + 0.05) ?? fr.spans.reduce<[number, number] | null>((m, x) => (!m || Math.abs((x[0] + x[1]) / 2 - p.s) < Math.abs((m[0] + m[1]) / 2 - p.s) ? x : m), null)
      if (span && Math.abs((span[0] + span[1]) / 2 - p.s) < 0.6) p.s = (span[0] + span[1]) / 2
    }
    spots.push({ item: 'double-socket', g: p.f.g, side: p.f.side, s: p.s, y })
  }

  return spots.map((p) => {
    const item = itemById(p.item)!
    const [w, h, d] = item.size
    const sgn = p.side === 'left' ? 1 : -1
    const n: Vec2 = [p.g.n[0] * sgn, p.g.n[1] * sgn]
    // Panelled walls: the plate sits on the panelling, not in it.
    const proud = trim.panels !== 'none' && p.y < trimTop(trim, p.g.wall.height ?? level.height) ? 0.012 : 0
    const off = p.g.h + d / 2 + proud + 0.001
    const c: Vec2 = [p.g.wall.a[0] + p.g.d[0] * p.s + n[0] * off, p.g.wall.a[1] + p.g.d[1] * p.s + n[1] * off]
    return {
      name: item.name,
      source: 'Catalog',
      furniture: { item: item.id, size: [w, h, d] },
      surfaces: slotOverrides(item),
      levelId: level.id,
      exact: true,
      visible: true,
      renderable: true,
      shade: 'original',
      material: null,
      transform: { position: [c[0], p.y - h / 2, c[1]], rotation: [0, Math.atan2(n[0], n[1]), 0], scale: [1, 1, 1] },
    } satisfies Omit<SceneObject, 'id'>
  })
}

const trimTop = (trim: RoomInfo['trim'] & object, ceiling: number) => (trim.panels === 'full-height' ? ceiling : Math.min(trim.panelHeight, ceiling - 0.1))
