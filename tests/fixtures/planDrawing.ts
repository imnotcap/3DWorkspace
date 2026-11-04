// Test floor plans: a house described in metres, drawn the way estate-agent / architect plans are
// drawn (filled walls, grey floors, door swings, glazing lines, cabinets with crosses, furniture,
// "Name / 12.3 m²" labels). The labels carry the true net areas, computed by the plan geometry,
// so an import can be checked against exact answers.
import { analyse, interiorPoint, pointInPolygon } from '../../src/plan/geometry.ts'
import type { Vec2, Wall } from '../../src/plan/types.ts'

export type FixtureKind = 'door' | 'double-door' | 'sliding-door' | 'archway' | 'window' | 'french-window'
export interface FixtureOpening {
  wall: number
  /** Centre along the wall from a (m), width (m). */
  t: number
  width: number
  kind: FixtureKind
  /** Side the door swings to (left/right of a → b), hinge end. */
  side?: 'left' | 'right'
  hinge?: 'a' | 'b'
}
export interface Fixture {
  name: string
  walls: { a: Vec2; b: Vec2; t: number }[]
  openings: FixtureOpening[]
  /** Rectangles (x0, y0, x1, y1) of wardrobes drawn as boxes with crosses, split in `cells`. */
  wardrobes: { r: [number, number, number, number]; cells: number }[]
  /** Kitchen counters and other plain boxes (no cross). */
  counters: [number, number, number, number][]
  /** Room names, by a point inside the room. */
  rooms: { at: Vec2; name: string }[]
  /** Solid dark furniture (a TV seen from above): must not become walls. */
  solids: [number, number, number, number][]
  /** Thin-lined furniture outlines. */
  outlines: [number, number, number, number][]
}

/** A villa in the style of the plan in the issue: two strips of rooms, a dining bay, thin partitions. */
export function villa(): Fixture {
  const E = 0.35
  const I = 0.12
  const P = 0.08
  const walls: Fixture['walls'] = [
    // 0–7: outside, clockwise from the top left, with the dining bay at the bottom.
    { a: [0, 0], b: [17, 0], t: E },
    { a: [17, 0], b: [17, 7.4], t: E },
    { a: [17, 7.4], b: [10, 7.4], t: E },
    { a: [10, 7.4], b: [10, 9.2], t: E },
    { a: [10, 9.2], b: [6, 9.2], t: E },
    { a: [6, 9.2], b: [6, 7.4], t: E },
    { a: [6, 7.4], b: [0, 7.4], t: E },
    { a: [0, 7.4], b: [0, 0], t: E },
    // 8: the long inside wall between the two strips.
    { a: [0, 3.6], b: [17, 3.6], t: I },
    // 9–15: inside walls of the top strip.
    { a: [2.2, 0], b: [2.2, 3.6], t: I },
    { a: [5.0, 0], b: [5.0, 7.4], t: I },
    { a: [6.6, 0], b: [6.6, 3.6], t: I },
    { a: [9.0, 0], b: [9.0, 3.6], t: I },
    { a: [11.0, 0], b: [11.0, 3.6], t: I },
    { a: [12.4, 0], b: [12.4, 7.4], t: I },
    { a: [14.6, 2.2], b: [14.6, 3.6], t: P },
    // 16–18: thin partitions (bathrooms, technical room).
    { a: [5.0, 2.0], b: [6.6, 2.0], t: P },
    { a: [9.0, 2.2], b: [11.0, 2.2], t: P },
    { a: [12.4, 2.2], b: [17, 2.2], t: P },
  ]
  const openings: FixtureOpening[] = [
    // Outside: windows, the front door, garden doors, a sliding door.
    { wall: 0, t: 1.1, width: 1.0, kind: 'window' },
    { wall: 0, t: 3.6, width: 1.4, kind: 'window' },
    { wall: 0, t: 7.8, width: 1.6, kind: 'window' },
    { wall: 0, t: 11.7, width: 1.0, kind: 'door', side: 'left', hinge: 'a' },
    { wall: 0, t: 15.8, width: 1.0, kind: 'window' },
    { wall: 7, t: 1.9, width: 1.6, kind: 'window' },
    { wall: 6, t: 3.5, width: 2.0, kind: 'window' },
    { wall: 4, t: 2.0, width: 1.6, kind: 'french-window', side: 'right' },
    { wall: 3, t: 0.9, width: 0.8, kind: 'window' },
    { wall: 5, t: 0.9, width: 0.8, kind: 'window' },
    { wall: 2, t: 4.5, width: 2.0, kind: 'sliding-door', side: 'left' },
    { wall: 2, t: 2.3, width: 1.8, kind: 'window' },
    { wall: 1, t: 5.5, width: 1.2, kind: 'window' },
    // Inside: doors (swing side, hinge), passages without a door.
    { wall: 8, t: 1.3, width: 0.8, kind: 'door', side: 'right', hinge: 'a' },
    { wall: 8, t: 3.9, width: 0.8, kind: 'door', side: 'right', hinge: 'b' },
    { wall: 8, t: 5.8, width: 0.9, kind: 'archway' },
    { wall: 8, t: 10.0, width: 0.8, kind: 'door', side: 'left', hinge: 'a' },
    { wall: 8, t: 11.7, width: 1.0, kind: 'archway' },
    { wall: 8, t: 13.5, width: 0.8, kind: 'door', side: 'left', hinge: 'a' },
    { wall: 16, t: 0.8, width: 0.7, kind: 'door', side: 'right', hinge: 'a' },
    { wall: 11, t: 3.0, width: 0.8, kind: 'door', side: 'right', hinge: 'b' },
    { wall: 13, t: 1.1, width: 0.8, kind: 'door', side: 'left', hinge: 'a' },
    { wall: 14, t: 3.0, width: 0.9, kind: 'archway' },
    { wall: 18, t: 1.0, width: 0.8, kind: 'door', side: 'right', hinge: 'a' },
    { wall: 18, t: 3.4, width: 0.7, kind: 'door', side: 'left', hinge: 'b' },
    { wall: 10, t: 5.5, width: 1.6, kind: 'archway' },
  ]
  return {
    name: 'villa',
    walls,
    openings,
    wardrobes: [
      { r: [9.06, 0.3, 9.66, 1.9], cells: 3 },
      { r: [12.46, 4.0, 13.06, 7.0], cells: 5 },
    ],
    counters: [
      [6.2, 3.66, 9.0, 4.26],
      [8.0, 5.2, 10.0, 6.1],
      [15.4, 0.175, 16.8, 0.75],
    ],
    rooms: [
      { at: [1.1, 1.8], name: 'Kontor' },
      { at: [3.6, 1.8], name: 'Værelse 1' },
      { at: [5.8, 1.0], name: 'Bad 2' },
      { at: [5.8, 2.8], name: 'Gang' },
      { at: [7.8, 1.8], name: 'Værelse 2' },
      { at: [10.3, 1.62], name: 'Bryggers' },
      { at: [10.0, 2.9], name: 'Teknik' },
      { at: [11.7, 1.8], name: 'Entré' },
      { at: [14.7, 1.1], name: 'Bad 1' },
      { at: [13.5, 2.9], name: 'Gang' },
      { at: [15.8, 2.9], name: 'Sauna' },
      { at: [2.5, 5.5], name: 'Opholdsstue' },
      { at: [8.7, 6.8], name: 'Køkken-alrum' },
      { at: [14.7, 5.5], name: 'Soveværelse' },
    ],
    solids: [[1.2, 4.6, 1.6, 5.6]],
    outlines: [
      [0.4, 4.2, 1.0, 6.6],
      [1.0, 6.0, 2.2, 6.6],
      [7.2, 7.6, 8.8, 8.6],
      [14.2, 4.2, 16.6, 6.4],
    ],
  }
}

export interface Drawn {
  svg: string
  width: number
  height: number
  /** True net areas (m², as printed on the labels) by room name and position. */
  rooms: { name: string; area: number; exact: number; at: Vec2 }[]
  pxPerM: number
}

/**
 * Draw the fixture. Style 'agent': grey floors, black walls (estate-agent plans);
 * 'architect': white floors, dark grey walls, thinner symbols.
 */
export function drawFixture(f: Fixture, pxPerM: number, style: 'agent' | 'architect' = 'agent'): Drawn {
  const walls: Wall[] = f.walls.map((w, i) => ({ id: `w${i}`, levelId: 'L', a: w.a, b: w.b, thickness: w.t }))
  const geom = analyse(walls)
  const xs = f.walls.flatMap((w) => [w.a[0], w.b[0]])
  const ys = f.walls.flatMap((w) => [w.a[1], w.b[1]])
  const pad = 1.2
  const x0 = Math.min(...xs) - pad
  const y0 = Math.min(...ys) - pad
  const W = Math.round((Math.max(...xs) - x0 + pad) * pxPerM)
  const H = Math.round((Math.max(...ys) - y0 + pad) * pxPerM)
  const P = (p: Vec2) => `${((p[0] - x0) * pxPerM).toFixed(2)},${((p[1] - y0) * pxPerM).toFixed(2)}`
  const X = (x: number) => ((x - x0) * pxPerM).toFixed(2)
  const Y = (y: number) => ((y - y0) * pxPerM).toFixed(2)
  const s = (m: number) => (m * pxPerM).toFixed(2)
  const agent = style === 'agent'
  const ink = agent ? '#141414' : '#2a2a2a'
  const floor = agent ? '#8e8a84' : '#ffffff'
  const thin = Math.max(1, pxPerM * 0.012)
  const out: string[] = []
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`)

  const rooms: Drawn['rooms'] = []
  for (const face of geom.faces) {
    out.push(`<polygon points="${face.polygon.map(P).join(' ')}" fill="${floor}"/>`)
    const r = f.rooms.find((x) => pointInPolygon(x.at, face.polygon))
    if (r) rooms.push({ name: r.name, area: Math.round(face.area * 10) / 10, exact: face.area, at: r.at })
  }
  // Furniture under the walls.
  for (const [a, b, c, d] of f.counters) out.push(`<rect x="${X(a)}" y="${Y(b)}" width="${s(c - a)}" height="${s(d - b)}" fill="${agent ? '#a7a39d' : '#fff'}" stroke="${ink}" stroke-width="${thin}"/>`)
  for (const [a, b, c, d] of f.outlines) out.push(`<rect x="${X(a)}" y="${Y(b)}" width="${s(c - a)}" height="${s(d - b)}" rx="${s(0.05)}" fill="${agent ? '#a19d97' : '#fff'}" stroke="${ink}" stroke-width="${thin}"/>`)
  for (const [a, b, c, d] of f.solids) out.push(`<rect x="${X(a)}" y="${Y(b)}" width="${s(c - a)}" height="${s(d - b)}" fill="#050505"/>`)
  for (const wd of f.wardrobes) {
    const [a, b, c, d] = wd.r
    const along = c - a > d - b
    out.push(`<rect x="${X(a)}" y="${Y(b)}" width="${s(c - a)}" height="${s(d - b)}" fill="${agent ? '#9c9892' : '#fff'}" stroke="${ink}" stroke-width="${thin * 1.4}"/>`)
    for (let i = 0; i < wd.cells; i++) {
      const [p, q, r2, t2] = along ? [a + ((c - a) / wd.cells) * i, b, a + ((c - a) / wd.cells) * (i + 1), d] : [a, b + ((d - b) / wd.cells) * i, c, b + ((d - b) / wd.cells) * (i + 1)]
      out.push(`<rect x="${X(p)}" y="${Y(q)}" width="${s(r2 - p)}" height="${s(t2 - q)}" fill="none" stroke="${ink}" stroke-width="${thin}"/>`)
      out.push(`<path d="M ${X(p)} ${Y(q)} L ${X(r2)} ${Y(t2)} M ${X(r2)} ${Y(q)} L ${X(p)} ${Y(t2)}" stroke="${ink}" stroke-width="${thin}"/>`)
    }
  }
  // Walls: the exact mitred footprints.
  for (const g of geom.walls.values()) out.push(`<polygon points="${[g.la, g.lb, g.rb, g.ra].map(P).join(' ')}" fill="${ink}"/>`)
  for (const c of geom.caps) out.push(`<polygon points="${c.map(P).join(' ')}" fill="${ink}"/>`)
  // Openings: cleared and drawn.
  for (const o of f.openings) {
    const w = f.walls[o.wall]
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
    const n: Vec2 = [-d[1], d[0]]
    const at = (u: number, v: number): Vec2 => [w.a[0] + d[0] * u + n[0] * v, w.a[1] + d[1] * u + n[1] * v]
    const u0 = o.t - o.width / 2
    const u1 = o.t + o.width / 2
    const h = w.t / 2 + 0.004
    const exterior = o.wall <= 7
    const fill = exterior ? '#ffffff' : floor
    out.push(`<polygon points="${[at(u0, h), at(u1, h), at(u1, -h), at(u0, -h)].map(P).join(' ')}" fill="${fill}"/>`)
    const line = (p: Vec2, q: Vec2, sw = thin) => out.push(`<line x1="${P(p).split(',')[0]}" y1="${P(p).split(',')[1]}" x2="${P(q).split(',')[0]}" y2="${P(q).split(',')[1]}" stroke="${ink}" stroke-width="${sw}"/>`)
    if (o.kind === 'window' || o.kind === 'french-window') {
      for (const v of [h * 0.85, 0, -h * 0.85]) line(at(u0, v), at(u1, v))
      line(at(u0, h), at(u0, -h))
      line(at(u1, h), at(u1, -h))
    }
    if (o.kind === 'sliding-door') {
      line(at(u0, h * 0.3), at(o.t + 0.05, h * 0.3), thin * 1.5)
      line(at(o.t - 0.05, -h * 0.3), at(u1, -h * 0.3), thin * 1.5)
    }
    const swing = (hingeU: number, toU: number, r: number, sd: number) => {
      // Leaf open at 90° on side sd, and the swing arc back to the closed position.
      const hv = sd * (w.t / 2)
      const H0 = at(hingeU, hv)
      const open = at(hingeU, hv + sd * r)
      const closed = at(toU, hv)
      line(H0, open, thin * 1.6)
      const [ox, oy] = P(open).split(',')
      const [cx, cy] = P(closed).split(',')
      const sweep = (() => {
        const v1: Vec2 = [open[0] - H0[0], open[1] - H0[1]]
        const v2: Vec2 = [closed[0] - H0[0], closed[1] - H0[1]]
        return v1[0] * v2[1] - v1[1] * v2[0] > 0 ? 1 : 0
      })()
      out.push(`<path d="M ${ox} ${oy} A ${s(r)} ${s(r)} 0 0 ${sweep} ${cx} ${cy}" fill="none" stroke="${ink}" stroke-width="${thin}"/>`)
    }
    const sd = o.side === 'left' ? 1 : -1
    if (o.kind === 'door') o.hinge === 'b' ? swing(u1, u0, o.width, sd) : swing(u0, u1, o.width, sd)
    if (o.kind === 'double-door' || o.kind === 'french-window') {
      swing(u0, o.t, o.width / 2, sd)
      swing(u1, o.t, o.width / 2, sd)
    }
  }
  // Labels: name and area, centred in the room.
  for (const face of geom.faces) {
    const r = rooms.find((x) => pointInPolygon(x.at, face.polygon))
    if (!r) continue
    const c = f.rooms.find((x) => x.name === r.name && pointInPolygon(x.at, face.polygon))?.at ?? interiorPoint(face.inner)
    const fs = pxPerM * 0.2
    out.push(`<text x="${X(c[0])}" y="${Y(c[1])}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${fs.toFixed(1)}" text-anchor="middle" fill="${ink}">${r.name}</text>`)
    out.push(`<text x="${X(c[0])}" y="${(Number(Y(c[1])) + fs * 1.2).toFixed(1)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fs.toFixed(1)}" text-anchor="middle" fill="${ink}">${r.area.toFixed(1)} m²</text>`)
  }
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`, width: W, height: H, rooms, pxPerM }
}
