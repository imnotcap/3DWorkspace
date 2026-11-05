// Quantities and a rough price estimate: what the plan takes to build and fit out, room by room
// (floor, paint, ceiling, skirting, panelling, doors and windows, sockets, furniture).
import { catalogItemOf } from './footprint'
import { analyse, dist, pieceAt, type PlanGeom } from './geometry'
import { roomFor } from './levels'
import { ceilingAt, roofFrame } from './roof'
import { flatRoof, OPENING_DEFAULTS, type Level, type Opening, type RoomInfo, type Wall } from './types'
import { roomKind, type RoomKind } from './furnish'
import { ELECTRICAL } from './electrical'
import { PAINT_COLORS, presetById } from '@/viewport/materialPresets'
import type { SceneObject } from '@/store/workspace'

/** One room's measurements. */
export interface RoomQty {
  levelId: string
  level: string
  name: string
  kind: RoomKind
  /** Floor area inside the walls, m². */
  area: number
  /** Wall length round the room (inside), m. */
  perimeter: number
  /** Lowest and highest ceiling, m (equal for a flat ceiling). */
  minHeight: number
  maxHeight: number
  /** Share of the floor with at least 2.5 m to the ceiling (1 for a flat ceiling at 2.5 m or more). */
  fullHeightShare: number
  ceilingArea: number
  /** Wall surface to paint (openings taken off), m². */
  wallArea: number
  /** Openings into the room: windows (glass to the outside) and doors. */
  windows: { kind: Opening['kind']; width: number; height: number; sill: number }[]
  doors: { id: string; kind: Opening['kind']; width: number; height: number }[]
  info?: RoomInfo
}

export type QtyGroup = 'Floors' | 'Walls' | 'Ceilings' | 'Joinery' | 'Doors & windows' | 'Electrical' | 'Furniture'
export const QTY_GROUPS: QtyGroup[] = ['Floors', 'Walls', 'Ceilings', 'Joinery', 'Doors & windows', 'Electrical', 'Furniture']

export interface QtyRow {
  /** Stable key (for edited prices). */
  key: string
  group: QtyGroup
  name: string
  /** What it's based on (rooms, waste allowance, coverage). */
  detail: string
  qty: number
  unit: 'm²' | 'm' | 'L' | 'pcs'
  /** Guide price per unit, DKK incl. VAT, materials only. */
  price: number
  /** A colour to show beside it (paint). */
  swatch?: string
}

/** Paint: two coats at 8 m² per litre a coat. */
const PAINT_PER_M2 = 2 / 8
const FLOOR_WASTE = 0.07
const TILE_WASTE = 0.1
const TRIM_WASTE = 0.1

// Rough Danish retail prices (2026, DKK incl. VAT, materials only). Edit them in the dialog.
const FLOOR_PRICE: Record<string, number> = { 'oak-floor': 450, 'walnut-floor': 750, 'grey-tile': 400, 'white-tile': 350, terrazzo: 900, carpet: 250, 'polished-concrete': 700 }
const CEILING_PRICE: Record<string, number> = { 'ceil-perforated': 450, 'ceil-perforated-tiles': 300, 'ceil-wood-wool': 350, 'ceil-wood-wool-grey': 350, 'ceil-slats': 1200 }
const OPENING_PRICE: Record<Opening['kind'], number> = { door: 2500, 'double-door': 5500, 'sliding-door': 4500, archway: 600, window: 5500, 'wide-window': 8500, 'floor-window': 9000, 'french-window': 11000 }
const ELECTRICAL_PRICE: Record<string, number> = { socket: 120, 'double-socket': 190, switch: 130, 'double-switch': 180, 'data-socket': 220 }
const FURNITURE_PRICE: Record<string, number> = {
  sofa: 9000, loveseat: 6500, 'glam-sofa': 12000, 'leather-sofa': 15000, armchair: 4000, 'sheen-chair': 4500, 'damask-chair': 2500, 'silk-pouf': 1200,
  'coffee-table': 2500, 'side-table': 900, 'tv-unit': 3000, tv: 8000, bookshelf: 2500, rug: 2500,
  'dining-table': 6000, 'round-table': 4500, 'dining-chair': 1200, 'bar-stool': 900,
  'base-cabinet': 2500, 'drawer-cabinet': 3500, 'sink-cabinet': 4500, 'hob-cabinet': 6500, 'oven-tower': 9000, fridge: 7000, 'wall-cabinet': 1800, 'kitchen-island': 15000, 'range-hood': 3500,
  'bed-double': 9000, 'bed-single': 4000, nightstand: 1000, wardrobe: 5000, dresser: 3500,
  bathtub: 7000, toilet: 3500, vanity: 5000, shower: 6000, mirror: 900,
  desk: 3000, 'office-chair': 2500, 'screen-wall': 1500, 'sit-stand-desk': 5000, 'wall-shelf': 500,
  'floor-lamp': 1500, pendant: 1200, 'barn-lamp': 1500, 'arc-lamp': 2500, 'iridescent-lamp': 2000,
  plant: 400, vase: 250, 'wall-art': 800, curtains: 900, radiator: 3000,
  tree: 1500, bush: 300, hedge: 400, paving: 350, decking: 600, stairs: 25000,
}
const CATEGORY_PRICE: Record<string, number> = { Living: 3000, Dining: 2000, Kitchen: 4000, Bedroom: 3000, Bathroom: 3000, Office: 2000, Lighting: 1200, Decor: 500, Outdoor: 500, Structure: 5000 }

/** Openings and furniture in the plan that aren't part of a room's fabric (no price, no measure). */
const SKIP = new Set(['stairs'])

const area2 = (poly: [number, number][]) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)) / 2

/** The openings in a room: where the wall segment under them has this room on one side. */
function roomOpenings(geom: PlanGeom, face: number, openings: Opening[]) {
  return openings.filter((o) => {
    const at = pieceAt(geom, o.wallId, o.t)
    if (!at) return false
    const sg = at.g.segments.find((s) => at.u >= s.u0 - 1e-6 && at.u <= s.u1 + 1e-6)
    return !!sg && (sg.left === face || sg.right === face)
  })
}

/** Whether an opening looks outside (a room on one side only). */
function outward(geom: PlanGeom, o: Opening) {
  const at = pieceAt(geom, o.wallId, o.t)
  const sg = at?.g.segments.find((s) => at.u >= s.u0 - 1e-6 && at.u <= s.u1 + 1e-6)
  return !!sg && (sg.left === null || sg.right === null)
}

/** Measure every room on every level. */
export function measureRooms(p: { levels: Level[]; walls: Wall[]; openings: Opening[]; rooms: RoomInfo[] }): RoomQty[] {
  const out: RoomQty[] = []
  for (const level of p.levels) {
    const geom = analyse(p.walls.filter((w) => w.levelId === level.id))
    for (const f of geom.faces) {
      const info = roomFor(f, p.rooms, level.id)
      const roof = info?.roof ?? flatRoof(level.height)
      const frame = roofFrame(f.inner, roof)
      const h = (q: [number, number]) => ceilingAt(roof, frame, q)
      // Walls: integrate the ceiling height along the inside outline.
      let perimeter = 0
      let wallGross = 0
      let minH = Infinity
      let maxH = 0
      const ring = f.inner
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length]
        const L = dist(a, b)
        perimeter += L
        const n = Math.max(1, Math.ceil(L / 0.1))
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n
          const y = h([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
          wallGross += (y * L) / n
        }
        minH = Math.min(minH, h(a))
        maxH = Math.max(maxH, h(a))
      })
      // Ceiling surface and the share of floor at full height, from a grid over the room.
      const xs = ring.map((q) => q[0])
      const ys = ring.map((q) => q[1])
      const step = 0.1
      let cells = 0
      let tall = 0
      for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
        for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
          if (!inside([x, y], ring)) continue
          cells++
          const c = h([x, y])
          maxH = Math.max(maxH, c)
          if (c >= 2.5 - 1e-6) tall++
        }
      const span = Math.max(1e-6, frame.c1 - frame.c0)
      const rise = roof.shape === 'flat' ? 0 : Math.abs(roof.ridge - roof.height) / (roof.shape === 'gable' ? span / 2 : span)
      const ops = roomOpenings(geom, f.index, p.openings)
      const holes = ops.reduce((s, o) => s + o.width * Math.min(o.height, Math.max(0, minH - o.sill)), 0)
      out.push({
        levelId: level.id,
        level: level.name,
        name: info?.name ?? 'Room',
        kind: roomKind(info?.name ?? ''),
        area: f.area,
        perimeter,
        minHeight: minH,
        maxHeight: maxH,
        fullHeightShare: cells ? tall / cells : 0,
        ceilingArea: area2(ring) * Math.sqrt(1 + rise * rise),
        wallArea: Math.max(0, wallGross - holes),
        windows: ops.filter((o) => !OPENING_DEFAULTS[o.kind].door && outward(geom, o)).map((o) => ({ kind: o.kind, width: o.width, height: o.height, sill: o.sill })),
        doors: ops.filter((o) => OPENING_DEFAULTS[o.kind].door || o.sill < 0.05).map((o) => ({ id: o.id, kind: o.kind, width: o.width, height: o.height })),
        info,
      })
    }
  }
  return out
}

function inside(p: [number, number], poly: [number, number][]) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

const r2 = (n: number) => Math.round(n * 100) / 100
const names = (rs: RoomQty[]) => [...new Set(rs.map((r) => r.name))].join(', ')

/** The bill of materials for a project, grouped, with guide prices. */
export function billOfMaterials(p: { levels: Level[]; walls: Wall[]; openings: Opening[]; rooms: RoomInfo[]; objects: SceneObject[] }, rooms = measureRooms(p)): QtyRow[] {
  const rows: QtyRow[] = []
  const by = <T,>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>()
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
    return m
  }

  // Floors, by finish.
  for (const [preset, rs] of by(rooms, (r) => r.info?.floor.preset ?? '')) {
    const p0 = presetById(preset)
    const tiles = p0?.texture === 'tiles' || p0?.texture === 'small-tiles'
    const waste = p0 ? (tiles ? TILE_WASTE : FLOOR_WASTE) : 0
    const area = rs.reduce((s, r) => s + r.area, 0)
    rows.push({ key: `floor:${preset || 'plain'}`, group: 'Floors', name: p0?.name ?? 'Floor (painted / plain)', detail: `${r2(area)} m² + ${Math.round(waste * 100)} % waste · ${names(rs)}`, qty: r2(area * (1 + waste)), unit: 'm²', price: FLOOR_PRICE[preset] ?? (p0?.category === 'Wood floor' ? 500 : p0 ? 400 : 150) })
  }

  // Wall paint, by colour.
  for (const [color, rs] of by(rooms, (r) => (r.info?.walls.color ?? '#f2efe9').toLowerCase())) {
    const area = rs.reduce((s, r) => s + r.wallArea, 0)
    const named = PAINT_COLORS.find((c) => c.hex.toLowerCase() === color)?.name
    rows.push({ key: `paint:${color}`, group: 'Walls', name: `Wall paint, ${named ?? color}`, swatch: color, detail: `${r2(area)} m², 2 coats · ${names(rs)}`, qty: Math.ceil(area * PAINT_PER_M2), unit: 'L', price: 90 })
  }

  // Ceilings: boards, or paint.
  for (const [preset, rs] of by(rooms, (r) => r.info?.ceiling.preset ?? '')) {
    const p0 = presetById(preset)
    const area = rs.reduce((s, r) => s + r.ceilingArea, 0)
    if (p0?.category === 'Ceiling') rows.push({ key: `ceiling:${preset}`, group: 'Ceilings', name: p0.name, detail: `${r2(area)} m² + ${Math.round(FLOOR_WASTE * 100)} % waste · ${names(rs)}`, qty: r2(area * (1 + FLOOR_WASTE)), unit: 'm²', price: CEILING_PRICE[preset] ?? 400 })
    else rows.push({ key: `ceiling-paint:${preset || 'plain'}`, group: 'Ceilings', name: 'Ceiling paint', detail: `${r2(area)} m², 2 coats · ${names(rs)}`, qty: Math.ceil(area * PAINT_PER_M2), unit: 'L', price: 90 })
  }
  const beams = rooms.filter((r) => r.info?.beams)
  if (beams.length) {
    const m = beams.reduce((s, r) => s + (Math.sqrt(r.area) / r.info!.beams!.spacing) * Math.sqrt(r.area), 0)
    rows.push({ key: 'beams', group: 'Ceilings', name: 'Ceiling beams', detail: `about ${Math.round(m)} m · ${names(beams)}`, qty: Math.ceil(m * (1 + TRIM_WASTE)), unit: 'm', price: 120 })
  }

  // Skirting and panelling.
  const skirted = rooms.filter((r) => (r.info?.trim?.skirting ?? 'flat') !== 'none')
  if (skirted.length) {
    const m = skirted.reduce((s, r) => s + Math.max(0, r.perimeter - r.doors.reduce((d, o) => d + o.width, 0)), 0)
    rows.push({ key: 'skirting', group: 'Joinery', name: 'Skirting board', detail: `${r2(m)} m + ${Math.round(TRIM_WASTE * 100)} % waste · ${names(skirted)}`, qty: Math.ceil(m * (1 + TRIM_WASTE)), unit: 'm', price: 60 })
  }
  const panelled = rooms.filter((r) => r.info?.trim && r.info.trim.panels !== 'none')
  for (const [style, rs] of by(panelled, (r) => r.info!.trim!.panels)) {
    const a = rs.reduce((s, r) => {
      const top = style === 'full-height' ? r.minHeight : r.info!.trim!.panelHeight
      const gaps = [...r.doors, ...r.windows.filter((w) => w.sill < top)].reduce((d, o) => d + o.width, 0)
      return s + Math.max(0, r.perimeter - gaps) * top
    }, 0)
    rows.push({ key: `panels:${style}`, group: 'Joinery', name: `Wall panelling (${style.replace('-', ' ')})`, detail: `${r2(a)} m² + ${Math.round(TRIM_WASTE * 100)} % waste · ${names(rs)}`, qty: r2(a * (1 + TRIM_WASTE)), unit: 'm²', price: 650 })
  }

  // Doors and windows, by kind and size.
  for (const [k, os] of by(p.openings, (o) => `${o.kind}:${Math.round(o.width * 100)}x${Math.round(o.height * 100)}`)) {
    const o = os[0]
    rows.push({ key: `opening:${k}`, group: 'Doors & windows', name: `${OPENING_DEFAULTS[o.kind].label} ${Math.round(o.width * 100)} × ${Math.round(o.height * 100)} cm`, detail: OPENING_DEFAULTS[o.kind].door ? 'with frame and handle' : 'with frame, glazed', qty: os.length, unit: 'pcs', price: OPENING_PRICE[o.kind] })
  }

  // Sockets, switches and furniture, by catalog piece.
  const pieces = p.objects.filter((o) => !o.parentId && o.visible !== false && !o.isGroup)
  for (const [id, os] of by(pieces, (o) => catalogItemOf(o)?.id ?? `model:${o.name}`)) {
    if (SKIP.has(id)) continue
    const it = catalogItemOf(os[0])
    const electrical = ELECTRICAL.has(id) || id === 'radiator'
    rows.push({
      key: `item:${id}`,
      group: electrical ? 'Electrical' : 'Furniture',
      name: it?.name ?? os[0].name,
      detail: it ? it.category : 'Imported model',
      qty: os.length,
      unit: 'pcs',
      price: ELECTRICAL_PRICE[id] ?? FURNITURE_PRICE[id] ?? (it ? CATEGORY_PRICE[it.category] ?? 1000 : 0),
    })
  }
  return rows.sort((a, b) => QTY_GROUPS.indexOf(a.group) - QTY_GROUPS.indexOf(b.group))
}

/** The bill as CSV (semicolon-separated with decimal commas, as Danish Excel opens it). */
export function bomCsv(rows: QtyRow[], prices: Record<string, number> = {}) {
  const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',')
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const lines = [['Group', 'Item', 'Based on', 'Quantity', 'Unit', 'Unit price (DKK)', 'Total (DKK)'].map(q).join(';')]
  let total = 0
  for (const r of rows) {
    const price = prices[r.key] ?? r.price
    total += price * r.qty
    lines.push([q(r.group), q(r.name), q(r.detail), num(r.qty), q(r.unit), num(price), num(price * r.qty)].join(';'))
  }
  lines.push(['', q('Total'), '', '', '', '', num(total)].join(';'))
  return '﻿' + lines.join('\r\n')
}
