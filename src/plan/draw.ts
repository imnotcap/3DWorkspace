// Plan drawing as plain SVG nodes: rendered by the editor (React) and serialised for the PDF.
import { itemById } from '@/furniture/catalog'
import type { SceneObject } from '@/store/workspace'
import { catalogItemOf, footprint } from './footprint'
import { furnitureSymbol } from './symbols'
import { add, clampOpening, mul, norm, sub, wallFrame, wallIdOf, wallLength, wallPolyline, type PlanGeom } from './geometry'
import { roomFor } from './levels'
import { DEFAULT_FLOOR_FINISH, OPENING_DEFAULTS, type Opening, type RoomInfo, type Vec2, type Wall } from './types'

export interface SvgNode {
  tag: 'g' | 'path' | 'polygon' | 'polyline' | 'line' | 'circle' | 'ellipse' | 'rect' | 'text'
  attrs: Record<string, string | number>
  children?: SvgNode[]
  text?: string
}

export interface PlanTheme {
  wall: string
  wallStroke: string
  roomStroke: string
  text: string
  subtext: string
  furnitureFill: string
  furnitureStroke: string
  opening: string
  dim: string
  ghost: string
  selected: string
  /** Room fill: the floor colour mixed to this opacity. */
  floorAlpha: number
  font: string
  /** Furniture drawn in detail and in its own colours (beds with pillows, sofa cushions…). */
  detailed?: boolean
  /** Outline colour of the detailed furniture. */
  symbolLine?: string
}

export const DARK_THEME: PlanTheme = {
  wall: '#d9d6d0',
  wallStroke: '#d9d6d0',
  roomStroke: 'none',
  text: '#e8e6e3',
  subtext: '#9a9894',
  furnitureFill: 'rgba(30,30,30,0.85)',
  furnitureStroke: '#8c8a86',
  opening: '#d9d6d0',
  dim: '#7d7b77',
  ghost: '#3a3a3a',
  selected: '#4c8dff',
  floorAlpha: 0.16,
  font: "'Inter Variable', Inter, system-ui, sans-serif",
}

/** Estate-agent style: light paper, dark walls, floors in their real texture, furniture in colour. */
export const PRESENT_THEME: PlanTheme = {
  wall: '#3b3b3d',
  wallStroke: '#2a2a2c',
  roomStroke: 'none',
  text: '#2a2a2c',
  subtext: '#55555a',
  furnitureFill: '#ffffff',
  furnitureStroke: '#6f6f74',
  opening: '#3b3b3d',
  dim: '#77777c',
  ghost: '#d6d8dc',
  selected: '#2f6fed',
  floorAlpha: 1,
  font: "'Inter Variable', Inter, system-ui, sans-serif",
  detailed: true,
  symbolLine: 'rgba(40,40,44,0.55)',
}

export const PAPER_THEME: PlanTheme = {
  wall: '#1d1d1f',
  wallStroke: '#1d1d1f',
  roomStroke: 'none',
  text: '#1d1d1f',
  subtext: '#6b6b6e',
  furnitureFill: '#ffffff',
  furnitureStroke: '#7a7a7e',
  opening: '#1d1d1f',
  dim: '#8a8a8e',
  ghost: '#e2e2e2',
  selected: '#2f6fed',
  floorAlpha: 0.22,
  // svg2pdf maps the generic family to the PDF's built-in Helvetica.
  font: 'sans-serif',
  detailed: true,
  symbolLine: '#8a8a8e',
}

const pts = (p: Vec2[]) => p.map((q) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`).join(' ')

export interface DrawInput {
  geom: PlanGeom
  levelId: string
  walls: Wall[]
  openings: Opening[]
  rooms: RoomInfo[]
  objects: SceneObject[]
  /** Walls of the level below, drawn faintly for alignment. */
  below?: Wall[]
  /** Pixels per metre, so text and strokes keep a readable size. */
  scale: number
  theme: PlanTheme
  selection?: { kind: string; id: string; at?: Vec2 } | null
  selectedObject?: string | null
  /** Everything selected (multi-selection). */
  selectedObjects?: string[]
  /** Wall lengths (always on paper; on screen when zoomed in). */
  dimensions: boolean
  /** A fill for a room's floor (a texture pattern), or null for its flat colour. */
  floorFill?: (floor: { color: string; preset?: string }) => string | null
  /** Interactive hit areas (editor only). */
  interactive?: boolean
}

export function formatLength(m: number) {
  return m >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`
}

export function drawPlan(i: DrawInput): SvgNode[] {
  const { geom, theme: T, scale } = i
  const px = (n: number) => n / scale // n screen pixels in metres
  const out: SvgNode[] = []

  // Level below, for alignment.
  if (i.below?.length)
    out.push({
      tag: 'g',
      attrs: { opacity: 0.9 },
      children: i.below.map((w) => ({ tag: 'line', attrs: { x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1], stroke: T.ghost, 'stroke-width': w.thickness, 'stroke-linecap': 'square' } })),
    })

  // Rooms: floor tint, name and area.
  const labels: SvgNode[] = []
  // Text boxes already placed (room names first): a furniture label that would overlap one is left out.
  const taken: [number, number, number, number][] = []
  const box = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
  const free = (b: [number, number, number, number]) => taken.every((t) => b[2] < t[0] || b[0] > t[2] || b[3] < t[1] || b[1] > t[3])
  const furnitureLabels: { o: SceneObject; area: number }[] = []
  geom.faces.forEach((f) => {
    const info = roomFor(f, i.rooms, i.levelId)
    const floor = info?.floor ?? DEFAULT_FLOOR_FINISH
    const sel = i.selection?.kind === 'room' && i.selection.at && insideFace(i.selection.at, f.polygon)
    out.push({
      tag: 'polygon',
      attrs: { points: pts(f.inner.length >= 3 ? f.inner : f.polygon), fill: sel ? T.selected : (i.floorFill?.(floor) ?? floor.color), 'fill-opacity': sel ? 0.35 : T.floorAlpha, stroke: sel ? T.selected : T.roomStroke, 'stroke-width': px(2), ...(i.interactive ? { 'data-kind': 'room', 'data-x': f.center[0], 'data-y': f.center[1] } : {}) },
    })
    // Sloping ceilings: the ridge (dashed) or an arrow up the slope.
    const roof = info?.roof
    if (roof && roof.shape !== 'flat') {
      const xs = f.inner.map((p) => p[0])
      const ys = f.inner.map((p) => p[1])
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      const alongX = x1 - x0 >= y1 - y0 === roof.ridgeLong
      const P = (a: number, c: number) => (alongX ? [a, c] : [c, a])
      const [a0, a1, c0, c1] = alongX ? [x0, x1, y0, y1] : [y0, y1, x0, x1]
      const style = { stroke: T.dim, 'stroke-width': px(1.5), fill: 'none', 'pointer-events': 'none' }
      if (roof.shape === 'gable') {
        const [p, q] = [P(a0 + 0.1, (c0 + c1) / 2), P(a1 - 0.1, (c0 + c1) / 2)]
        out.push({ tag: 'line', attrs: { x1: p[0], y1: p[1], x2: q[0], y2: q[1], 'stroke-dasharray': `${px(8)} ${px(5)}`, ...style } })
      } else {
        const am = (a0 + a1) / 2
        const lo = roof.flip ? c1 - 0.35 : c0 + 0.35
        const hi = roof.flip ? c0 + 0.35 : c1 - 0.35
        const [p, q] = [P(am + (a1 - a0) * 0.3, lo), P(am + (a1 - a0) * 0.3, hi)]
        const dx = q[0] - p[0]
        const dy = q[1] - p[1]
        const l = Math.hypot(dx, dy) || 1
        const h = Math.min(0.25, l * 0.3)
        const [ux, uy] = [dx / l, dy / l]
        out.push({ tag: 'path', attrs: { d: `M ${p[0]} ${p[1]} L ${q[0]} ${q[1]} M ${q[0] - ux * h - uy * h * 0.6} ${q[1] - uy * h + ux * h * 0.6} L ${q[0]} ${q[1]} L ${q[0] - ux * h + uy * h * 0.6} ${q[1] - uy * h - ux * h * 0.6}`, ...style } })
      }
    }
    const fs = Math.max(px(12), 0.12)
    labels.push({ tag: 'text', attrs: { x: f.center[0], y: f.center[1] - fs * 0.15, 'font-size': fs, 'font-family': T.font, 'font-weight': 'bold', fill: T.text, 'text-anchor': 'middle', 'pointer-events': 'none' }, text: info?.name ?? 'Room' })
    labels.push({ tag: 'text', attrs: { x: f.center[0], y: f.center[1] + fs * 1.05, 'font-size': fs * 0.82, 'font-family': T.font, fill: T.subtext, 'text-anchor': 'middle', 'pointer-events': 'none' }, text: `${f.area.toFixed(1)} m²` })
    const name = info?.name ?? 'Room'
    taken.push(box(f.center[0], f.center[1] + fs * 0.35, Math.max(name.length * 0.6, 7 * 0.55) * fs, fs * 2.5))
  })

  // Furniture (drawn under walls, so pieces against a wall read cleanly).
  // Flat pieces (rugs, paving, decking) first: everything else stands on them.
  const flat = (o: SceneObject) => ['rug', 'paving', 'decking'].includes(o.furniture?.item ?? '')
  for (const o of [...i.objects].sort((a, b) => Number(flat(b)) - Number(flat(a)))) {
    const fp = footprint(o)
    const sel = i.selectedObject === o.id || !!i.selectedObjects?.includes(o.id)
    const item = itemById(o.furniture?.item)
    const isRug = o.furniture?.item === 'rug'
    const sym = T.detailed ? furnitureSymbol(o, catalogItemOf(o) ?? item, fp.w, fp.d, { line: T.symbolLine ?? T.furnitureStroke, lw: px(0.8) }) : null
    const detailed = !!sym?.nodes.length
    out.push({
      tag: 'polygon',
      attrs: {
        points: pts(fp.corners),
        // Detailed pieces draw themselves; the outline stays for picking and selection.
        fill: detailed ? 'transparent' : isRug ? 'none' : T.furnitureFill,
        stroke: sel ? T.selected : detailed ? 'none' : T.furnitureStroke,
        'stroke-width': px(sel ? 2 : 1),
        'stroke-dasharray': isRug && !detailed ? `${px(4)} ${px(3)}` : 'none',
        ...(i.interactive ? { 'data-kind': 'object', 'data-id': o.id } : {}),
      },
    })
    if (detailed) {
      const deg = (-fp.yaw * 180) / Math.PI
      // Under the outline (so a click lands on the piece), the selection ring drawn again on top.
      out.splice(out.length - 1, 0, { tag: 'g', attrs: { transform: `translate(${fp.c[0].toFixed(4)} ${fp.c[1].toFixed(4)}) rotate(${deg.toFixed(3)})`, 'pointer-events': 'none' }, children: sym!.nodes })
      continue
    }
    // A short line marks the front.
    const f0 = fp.at(-fp.w * 0.3, fp.d / 2 - Math.min(0.06, fp.d * 0.2))
    const f1 = fp.at(fp.w * 0.3, fp.d / 2 - Math.min(0.06, fp.d * 0.2))
    if (!isRug) out.push({ tag: 'line', attrs: { x1: f0[0], y1: f0[1], x2: f1[0], y2: f1[1], stroke: T.furnitureStroke, 'stroke-width': px(1), 'pointer-events': 'none' } })
    // Rugs and ceiling lights sit under / over other pieces: their outline is enough.
    if (!isRug && item?.mount !== 'ceiling' && Math.min(fp.w, fp.d) * scale > 30) furnitureLabels.push({ o, area: fp.w * fp.d })
  }

  // Furniture labels, biggest pieces first; each fits inside its piece and never overlaps another label.
  furnitureLabels.sort((a, b) => b.area - a.area)
  for (const { o } of furnitureLabels) {
    const fp = footprint(o)
    const text = o.name.replace(/\.\d{3}$/, '') || itemById(o.furniture?.item)?.name || ''
    if (!text) continue
    // Horizontal text: the space it has across is the footprint's extent along x.
    const across = Math.abs(fp.w * Math.cos(fp.yaw)) + Math.abs(fp.d * Math.sin(fp.yaw))
    const tall = Math.abs(fp.w * Math.sin(fp.yaw)) + Math.abs(fp.d * Math.cos(fp.yaw))
    const fs = Math.min(px(10), tall * 0.3, (across * 0.9) / (text.length * 0.55), 0.1)
    if (fs * scale < 6.5) continue
    const b = box(fp.c[0], fp.c[1], text.length * 0.55 * fs, fs * 1.3)
    if (!free(b)) continue
    taken.push(b)
    labels.push({ tag: 'text', attrs: { x: fp.c[0], y: fp.c[1] + fs * 0.35, 'font-size': fs, 'font-family': T.font, fill: T.subtext, 'text-anchor': 'middle', 'pointer-events': 'none' }, text })
  }

  // Walls: solid footprints; openings punched through and drawn as symbols.
  for (const g of geom.walls.values()) {
    const id = wallIdOf(g.wall)
    const sel = i.selection?.kind === 'wall' && i.selection.id === id
    out.push({
      tag: 'polygon',
      attrs: { points: pts([g.la, g.lb, g.rb, g.ra]), fill: sel ? T.selected : T.wall, stroke: sel ? T.selected : T.wallStroke, 'stroke-width': px(0.5), ...(i.interactive ? { 'data-kind': 'wall', 'data-id': id } : {}) },
    })
  }
  for (const c of geom.caps) out.push({ tag: 'polygon', attrs: { points: pts(c), fill: T.wall, stroke: T.wall, 'stroke-width': px(0.5) } })

  for (const o of i.openings) {
    const sel = i.selection?.kind === 'opening' && i.selection.id === o.id
    const g = geom.walls.get(o.wallId)
    if (g) {
      out.push(...openingSymbol(o, g.wall, g.d, g.n, g.h, g.len, T, px, sel, !!i.interactive))
      continue
    }
    const w = i.walls.find((x) => x.id === o.wallId)
    if (w && geom.pieces.has(w.id)) out.push(...curvedOpeningSymbol(o, w, w.thickness / 2, T, px, sel, !!i.interactive))
  }

  // Wall lengths, outside each wall (curved walls: their length along the curve, at the middle).
  if (i.dimensions)
    for (const w of i.walls) {
      if (!geom.pieces.has(w.id)) continue
      const L = wallLength(w)
      const f = wallFrame(w, L / 2)
      const pieces = geom.pieces.get(w.id)!
      const mid = pieces[Math.floor(pieces.length / 2)]
      const outside = mid.segments.some((sg) => sg.left === null) ? 1 : -1
      const at = add(f.p, mul(f.n, outside * (w.thickness / 2 + px(11))))
      let ang = (Math.atan2(f.d[1], f.d[0]) * 180) / Math.PI
      if (ang > 90 || ang < -90) ang += 180
      out.push({ tag: 'text', attrs: { x: at[0], y: at[1], 'font-size': px(10), 'font-family': T.font, fill: T.dim, 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: `rotate(${ang.toFixed(2)} ${at[0].toFixed(4)} ${at[1].toFixed(4)})`, 'pointer-events': 'none' }, text: `⌒ ${formatLength(L)}` })
    }
  if (i.dimensions)
    for (const g of geom.walls.values()) {
      if (g.wall.parentId) continue
      // Outside walls always; inside walls only when selected (else they crowd the room labels).
      const exterior = g.segments.some((s) => s.left === null || s.right === null)
      if (g.len < 0.3 || (!exterior && !(i.selection?.kind === 'wall' && i.selection.id === g.wall.id))) continue
      const mid = add(g.wall.a, mul(g.d, g.len / 2))
      // Put the label on the side that has no room (outside), else the right side.
      const outside = g.segments.some((s) => s.left === null) ? 1 : -1
      const off = add(mid, mul(g.n, outside * (g.h + px(11))))
      let ang = (Math.atan2(g.d[1], g.d[0]) * 180) / Math.PI
      if (ang > 90 || ang < -90) ang += 180
      out.push({ tag: 'text', attrs: { x: off[0], y: off[1], 'font-size': px(10), 'font-family': T.font, fill: T.dim, 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: `rotate(${ang.toFixed(2)} ${off[0].toFixed(4)} ${off[1].toFixed(4)})`, 'pointer-events': 'none' }, text: formatLength(g.len) })
    }

  out.push(...labels)
  return out
}

function insideFace(p: Vec2, poly: Vec2[]) {
  let inside = false
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xi, yi] = poly[a]
    const [xj, yj] = poly[b]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function openingSymbol(o: Opening, w: Wall, d: Vec2, n: Vec2, h: number, len: number, T: PlanTheme, px: (n: number) => number, sel: boolean, interactive: boolean): SvgNode[] {
  const t = clampOpening(o.t, o.width, len)
  const c = add(w.a, mul(d, t))
  const half = o.width / 2
  const A = add(c, mul(d, -half))
  const B = add(c, mul(d, half))
  const nodes: SvgNode[] = []
  const stroke = sel ? T.selected : T.opening
  const sw = px(1.2)
  // Gap in the wall (paper colour), then the jambs.
  const gap = [add(A, mul(n, h + px(0.6))), add(B, mul(n, h + px(0.6))), add(B, mul(n, -h - px(0.6))), add(A, mul(n, -h - px(0.6)))]
  nodes.push({ tag: 'polygon', attrs: { points: pts(gap), fill: T === PAPER_THEME ? '#ffffff' : '#141414', stroke: 'none', ...(interactive ? { 'data-kind': 'opening', 'data-id': o.id } : {}) } })
  for (const P of [A, B]) nodes.push({ tag: 'line', attrs: { x1: add(P, mul(n, h))[0], y1: add(P, mul(n, h))[1], x2: add(P, mul(n, -h))[0], y2: add(P, mul(n, -h))[1], stroke, 'stroke-width': sw, 'pointer-events': 'none' } })

  const kind = OPENING_DEFAULTS[o.kind]
  const s = o.side === 'left' ? 1 : -1
  const leaf = (hinge: Vec2, toward: Vec2, r: number) => {
    // Door leaf drawn open at 90° towards its side, with the swing arc back to the wall.
    const open = add(hinge, mul(n, s * r))
    const closed = add(hinge, mul(norm(sub(toward, hinge)), r))
    const sweep = (() => {
      const v1 = sub(open, hinge)
      const v2 = sub(closed, hinge)
      return v1[0] * v2[1] - v1[1] * v2[0] > 0 ? 1 : 0
    })()
    nodes.push({ tag: 'line', attrs: { x1: hinge[0], y1: hinge[1], x2: open[0], y2: open[1], stroke, 'stroke-width': sw * 1.4, 'pointer-events': 'none' } })
    nodes.push({ tag: 'path', attrs: { d: `M ${open[0]} ${open[1]} A ${r} ${r} 0 0 ${sweep} ${closed[0]} ${closed[1]}`, fill: 'none', stroke, 'stroke-width': sw * 0.8, 'stroke-dasharray': `${px(3)} ${px(2)}`, 'pointer-events': 'none' } })
  }
  const faceA = add(A, mul(n, s * h))
  const faceB = add(B, mul(n, s * h))
  if (o.kind === 'door') o.hinge === 'a' ? leaf(faceA, faceB, o.width) : leaf(faceB, faceA, o.width)
  else if (o.kind === 'double-door' || o.kind === 'french-window') {
    leaf(faceA, add(faceA, mul(d, half)), half)
    leaf(faceB, add(faceB, mul(d, -half)), half)
  } else if (o.kind === 'sliding-door') {
    for (const [k, off] of [
      [0, 0.25],
      [1, -0.25],
    ] as const) {
      const p0 = add(add(A, mul(d, k === 0 ? 0 : half)), mul(n, off * h * 2))
      const p1 = add(p0, mul(d, half + 0.05))
      nodes.push({ tag: 'line', attrs: { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], stroke, 'stroke-width': sw * 1.6, 'pointer-events': 'none' } })
    }
  } else if (!kind.door) {
    // Window: frame lines on both faces and the glass in the middle.
    for (const off of [h * 0.55, 0, -h * 0.55]) {
      const p0 = add(A, mul(n, off))
      const p1 = add(B, mul(n, off))
      nodes.push({ tag: 'line', attrs: { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], stroke, 'stroke-width': off === 0 ? sw * 0.8 : sw, 'pointer-events': 'none' } })
    }
  }
  return nodes
}

/** A door or window on a curved wall, drawn along the curve. */
function curvedOpeningSymbol(o: Opening, w: Wall, h: number, T: PlanTheme, px: (n: number) => number, sel: boolean, interactive: boolean): SvgNode[] {
  const L = wallLength(w)
  const t = clampOpening(o.t, o.width, L)
  const s0 = t - o.width / 2
  const s1 = t + o.width / 2
  const stroke = sel ? T.selected : T.opening
  const sw = px(1.2)
  const outer = wallPolyline(w, s0, s1, h + px(0.6))
  const inner = wallPolyline(w, s0, s1, -h - px(0.6)).reverse()
  const nodes: SvgNode[] = [{ tag: 'polygon', attrs: { points: pts([...outer, ...inner]), fill: T === PAPER_THEME ? '#ffffff' : '#141414', stroke: 'none', ...(interactive ? { 'data-kind': 'opening', 'data-id': o.id } : {}) } }]
  for (const s of [s0, s1]) {
    const f = wallFrame(w, s)
    const p0 = add(f.p, mul(f.n, h))
    const p1 = add(f.p, mul(f.n, -h))
    nodes.push({ tag: 'line', attrs: { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], stroke, 'stroke-width': sw, 'pointer-events': 'none' } })
  }
  if (!OPENING_DEFAULTS[o.kind].door) {
    for (const off of [h * 0.55, 0, -h * 0.55])
      nodes.push({ tag: 'polyline', attrs: { points: pts(wallPolyline(w, s0, s1, off)), fill: 'none', stroke, 'stroke-width': off === 0 ? sw * 0.8 : sw, 'pointer-events': 'none' } })
  } else {
    // Doors: drawn straight across the opening (the leaf is flat), like on a straight wall.
    const A = wallFrame(w, s0).p
    const B = wallFrame(w, s1).p
    const d = norm(sub(B, A))
    const fake: Wall = { ...w, a: A, b: B, curve: undefined }
    nodes.push(...openingSymbol({ ...o, t: Math.hypot(B[0] - A[0], B[1] - A[1]) / 2, width: Math.hypot(B[0] - A[0], B[1] - A[1]) }, fake, d, [-d[1], d[0]], h, Math.hypot(B[0] - A[0], B[1] - A[1]), T, px, sel, false).slice(1))
  }
  return nodes
}

/** Serialise nodes to an SVG string (for the PDF and file export). */
export function svgString(nodes: SvgNode[], viewBox: [number, number, number, number], width: number, height: number, background?: string) {
  const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const ser = (n: SvgNode): string => {
    const a = Object.entries(n.attrs)
      .filter(([k]) => !k.startsWith('data-'))
      .map(([k, v]) => `${k}="${esc(v)}"`)
      .join(' ')
    const inner = n.text != null ? esc(n.text) : (n.children ?? []).map(ser).join('')
    return `<${n.tag} ${a}>${inner}</${n.tag}>`
  }
  const bg = background ? `<rect x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}" fill="${background}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}" width="${width}" height="${height}">${bg}${nodes.map(ser).join('')}</svg>`
}

