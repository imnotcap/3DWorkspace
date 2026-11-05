// Furniture seen from above, as an estate-agent plan draws it: a bed with its pillows and duvet,
// a sofa with seat cushions, chairs round a table, a toilet bowl, the basin in a vanity, plants
// as leafy clusters… In the piece's own frame (x across its width, y along its depth, the front at
// +y), in its own colours (its material slots), placed by the caller.
import { roleOf, type CatalogItem } from '@/furniture/catalog'
import type { SceneObject } from '@/store/workspace'
import type { SvgNode } from './draw'

export interface SymbolStyle {
  /** Outline colour (darker on paper, lighter in the dark editor). */
  line: string
  /** Thin line width (plan units). */
  lw: number
}

type N = SvgNode

/** The colour of a material slot as the piece has it. */
export function slotColor(o: SceneObject, item: CatalogItem | undefined, slot: string, fallback: string) {
  return o.surfaces?.[slot]?.color ?? item?.slots?.[slot]?.color ?? fallback
}

const shade = (hex: string, k: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))))
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`
}

/** The details drawn on top of a piece (its outline is drawn by the caller). */
export function furnitureSymbol(o: SceneObject, item: CatalogItem | undefined, w: number, d: number, st: SymbolStyle): { base: string | null; nodes: N[] } {
  const id = item ? roleOf(item) : ''
  const L = st.lw
  const line = st.line
  const r = (x: number, y: number, rw: number, rh: number, fill: string, rx = 0, extra: Record<string, string | number> = {}): N => ({ tag: 'rect', attrs: { x: x - rw / 2, y: y - rh / 2, width: Math.max(0.001, rw), height: Math.max(0.001, rh), rx, fill, stroke: line, 'stroke-width': L, ...extra } })
  const c = (x: number, y: number, rad: number, fill: string, extra: Record<string, string | number> = {}): N => ({ tag: 'circle', attrs: { cx: x, cy: y, r: Math.max(0.001, rad), fill, stroke: line, 'stroke-width': L, ...extra } })
  const e = (x: number, y: number, rx: number, ry: number, fill: string): N => ({ tag: 'ellipse', attrs: { cx: x, cy: y, rx, ry, fill, stroke: line, 'stroke-width': L } })
  const l = (x1: number, y1: number, x2: number, y2: number, k = 1): N => ({ tag: 'line', attrs: { x1, y1, x2, y2, stroke: line, 'stroke-width': L * k } })
  const p = (dd: string, fill: string, k = 1): N => ({ tag: 'path', attrs: { d: dd, fill, stroke: line, 'stroke-width': L * k } })
  const col = (slot: string, fb: string) => slotColor(o, item, slot, fb)
  const hw = w / 2
  const hd = d / 2
  const out: N[] = []

  /** A leafy cluster (plants, trees, bushes): overlapping lobes, lighter at the top. */
  const leafy = (rad: number, base: string, lobes: number, seed: number) => {
    let s = seed
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    const ring: N[] = []
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2 + rnd() * 0.4
      const rr = rad * (0.55 + rnd() * 0.15)
      ring.push({ tag: 'circle', attrs: { cx: Math.cos(a) * rad * 0.5, cy: Math.sin(a) * rad * 0.5, r: rr, fill: shade(base, -0.12), stroke: shade(base, -0.4), 'stroke-width': L } })
    }
    ring.push({ tag: 'circle', attrs: { cx: 0, cy: 0, r: rad * 0.62, fill: base, stroke: 'none' } })
    for (let i = 0; i < Math.max(3, lobes - 2); i++) {
      const a = (i / lobes) * Math.PI * 2 + 0.5
      ring.push({ tag: 'circle', attrs: { cx: Math.cos(a) * rad * 0.28, cy: Math.sin(a) * rad * 0.28, r: rad * 0.26, fill: shade(base, 0.18), stroke: 'none' } })
    }
    return ring
  }

  switch (id) {
    case 'bed-double':
    case 'bed-single': {
      const frame = col('Frame', '#c89a66')
      const bedding = col('Bedding', '#f4f2ee')
      const throwC = col('Throw', '#5b6f86')
      out.push(r(0, 0, w, d, frame, 0.03))
      out.push(r(0, -hd + 0.05, w, 0.1, shade(frame, -0.15)))
      out.push(r(0, 0.03, w - 0.08, d - 0.14, bedding, 0.04))
      const n = w > 1.2 ? 2 : 1
      const pw = (w - 0.2) / n - 0.06
      for (let i = 0; i < n; i++) out.push(r(-hw + 0.1 + (pw + 0.06) * i + pw / 2 + 0.03, -hd + 0.27, pw, 0.3, shade(bedding, 0.4), 0.05))
      // Duvet folded back, and a throw across the foot.
      out.push(r(0, 0.22, w - 0.08, d * 0.6, shade(bedding, -0.04), 0.03))
      out.push(l(-hw + 0.06, -hd + d * 0.48, hw - 0.06, -hd + d * 0.48, 1.4))
      out.push(r(0, hd - 0.3, w - 0.06, 0.32, throwC, 0.02))
      return { base: frame, nodes: out }
    }
    case 'sofa':
    case 'loveseat':
    case 'glam-sofa':
    case 'leather-sofa':
    case 'armchair':
    case 'sheen-chair': {
      const f = col('Fabric', id === 'leather-sofa' ? '#6b4a33' : id === 'glam-sofa' ? '#4f5d73' : '#b9b2a7')
      const arm = Math.min(0.18, w * 0.14)
      const back = Math.min(0.22, d * 0.24)
      out.push(r(0, 0, w, d, f, 0.06))
      out.push(r(0, -hd + back / 2, w - 0.02, back, shade(f, -0.12), 0.05))
      out.push(r(-hw + arm / 2, 0.02, arm, d - 0.04, shade(f, -0.08), 0.05))
      out.push(r(hw - arm / 2, 0.02, arm, d - 0.04, shade(f, -0.08), 0.05))
      const seatW = w - arm * 2
      const n = Math.max(1, Math.round(seatW / 0.68))
      const cw = seatW / n
      for (let i = 0; i < n; i++) out.push(r(-hw + arm + cw * (i + 0.5), back / 2 + 0.02, cw - 0.03, d - back - 0.06, shade(f, 0.12), 0.06))
      return { base: f, nodes: out }
    }
    case 'damask-chair':
    case 'dining-chair': {
      const f = col('Seat', col('Fabric', '#5d7b8a'))
      const wood = col('Frame', '#c89a66')
      out.push(r(0, 0.03, w - 0.02, d - 0.08, f, 0.05))
      out.push(r(0, -hd + 0.04, w, 0.07, wood, 0.03))
      return { base: null, nodes: out }
    }
    case 'bar-stool':
      out.push(c(0, 0, Math.min(w, d) / 2, col('Seat', '#3a3a3a')))
      out.push(c(0, 0, Math.min(w, d) / 2 - 0.05, shade(col('Seat', '#3a3a3a'), 0.15)))
      return { base: null, nodes: out }
    case 'office-chair': {
      const f = col('Fabric', '#2f3338')
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2
        out.push(l(0, 0, Math.cos(a) * hw * 0.95, Math.sin(a) * hd * 0.95, 1.6))
      }
      out.push(c(0, 0.04, Math.min(w, d) * 0.32, f))
      out.push(p(`M ${-hw * 0.7} ${-hd * 0.5} Q 0 ${-hd * 1.05} ${hw * 0.7} ${-hd * 0.5}`, 'none', 3))
      return { base: null, nodes: out }
    }
    case 'dining-table':
    case 'coffee-table':
    case 'side-table':
    case 'desk':
    case 'sit-stand-desk':
    case 'kitchen-island': {
      const top = col('Top', col('Wood', col('Worktop', '#c89a66')))
      out.push(r(0, 0, w, d, top, 0.02))
      out.push(r(0, 0, w - 0.06, d - 0.06, 'none', 0.015, { 'stroke-opacity': 0.5 }))
      // Wood grain along the top.
      for (let i = 1; i < 4; i++) out.push(l(-hw + 0.05, -hd + (d * i) / 4, hw - 0.05, -hd + (d * i) / 4 + 0.01, 0.4))
      return { base: top, nodes: out }
    }
    case 'round-table': {
      const top = col('Top', col('Wood', '#c89a66'))
      out.push(c(0, 0, Math.min(w, d) / 2, top))
      out.push(c(0, 0, Math.min(w, d) / 2 - 0.05, 'none', { 'stroke-opacity': 0.5 }))
      return { base: null, nodes: out }
    }
    case 'nightstand':
    case 'dresser':
    case 'tv-unit':
    case 'drawer-cabinet':
    case 'base-cabinet':
    case 'wall-cabinet':
    case 'oven-tower':
    case 'fridge': {
      // Seen from above: the worktop where there is one.
      const body = col('Worktop', col('Body', col('Fronts', '#f1efeb')))
      out.push(r(0, 0, w, d, body, 0.01))
      out.push(l(-hw, hd - 0.03, hw, hd - 0.03))
      const n = Math.max(1, Math.round(w / 0.6))
      for (let i = 1; i < n; i++) out.push(l(-hw + (w * i) / n, hd - 0.03, -hw + (w * i) / n, hd, 1))
      if (id === 'fridge' || id === 'oven-tower') out.push(l(-hw, -hd, hw, hd - 0.03, 0.6), l(hw, -hd, -hw, hd - 0.03, 0.6))
      return { base: body, nodes: out }
    }
    case 'sink-cabinet':
    case 'hob-cabinet': {
      const top = col('Worktop', '#e7e5e1')
      out.push(r(0, 0, w, d, top, 0.01))
      if (id === 'sink-cabinet') {
        out.push(r(0, 0.02, w * 0.62, d * 0.62, shade(top, -0.12), 0.05))
        out.push(c(0, -hd + 0.07, 0.025, '#b9b9b9'))
      } else for (const [x, y, rr] of [[-w * 0.22, -d * 0.2, 0.09], [w * 0.22, -d * 0.2, 0.07], [-w * 0.22, d * 0.2, 0.07], [w * 0.22, d * 0.2, 0.09]] as const) out.push(c(x, y, rr, '#2b2b2b'), c(x, y, rr * 0.55, 'none'))
      return { base: top, nodes: out }
    }
    case 'bathtub': {
      const cer = col('Ceramic', '#f7f7f5')
      out.push(r(0, 0, w, d, cer, 0.08))
      out.push(r(0, 0, w - 0.14, d - 0.14, shade(cer, -0.06), Math.min(w, d) * 0.3))
      out.push(c(-hw + 0.22, 0, 0.025, '#9a9a9a'))
      return { base: cer, nodes: out }
    }
    case 'toilet': {
      const cer = col('Ceramic', '#f7f7f5')
      out.push(r(0, -hd + 0.09, w, 0.18, cer, 0.03))
      out.push(e(0, 0.06, hw * 0.92, hd * 0.62, cer))
      out.push(e(0, 0.08, hw * 0.6, hd * 0.42, shade(cer, -0.08)))
      return { base: null, nodes: out }
    }
    case 'vanity': {
      const body = col('Body', '#c89a66')
      out.push(r(0, 0, w, d, body, 0.02))
      out.push(e(0, 0.03, Math.min(hw * 0.7, 0.26), hd * 0.62, col('Ceramic', '#f7f7f5')))
      out.push(c(0, -hd + 0.06, 0.02, '#b9b9b9'))
      return { base: body, nodes: out }
    }
    case 'shower': {
      const tray = col('Tray', '#f2f2f0')
      out.push(r(0, 0, w, d, tray, 0.02))
      out.push(l(-hw, -hd, hw, hd, 0.6), l(hw, -hd, -hw, hd, 0.6))
      out.push(c(0, 0, 0.04, '#9a9a9a'))
      return { base: tray, nodes: out }
    }
    case 'rug': {
      const rc = col('Rug', col('Wool', '#cfc6b8'))
      out.push(r(0, 0, w, d, rc, 0.01))
      out.push(r(0, 0, w - 0.16, d - 0.16, 'none', 0.01, { 'stroke-dasharray': `${L * 4} ${L * 3}` }))
      for (let x = -hw + 0.04; x <= hw - 0.04; x += 0.06) out.push(l(x, -hd, x, -hd - 0.04, 0.6), l(x, hd, x, hd + 0.04, 0.6))
      return { base: rc, nodes: out }
    }
    case 'bookshelf':
    case 'wall-shelf': {
      const wood = col('Wood', '#c89a66')
      out.push(r(0, 0, w, d, wood, 0.01))
      const pal = ['#8a4b3b', '#3f5a6b', '#c9a45c', '#5b6f4f', '#e6e1d6', '#2e2e2e']
      let x = -hw + 0.03
      let i = 0
      while (x < hw - 0.05) {
        const bw = 0.025 + ((i * 7) % 4) * 0.01
        out.push({ tag: 'rect', attrs: { x, y: -hd + 0.02, width: bw, height: d - 0.06, fill: pal[i % pal.length], stroke: 'none' } })
        x += bw + 0.004
        i++
      }
      return { base: wood, nodes: out }
    }
    case 'wardrobe': {
      const fr = col('Fronts', '#e9e6df')
      out.push(r(0, 0, w, d, fr, 0.01))
      out.push(l(-hw + 0.04, 0, hw - 0.04, 0, 0.8))
      const n = Math.max(1, Math.round(w / 0.5))
      for (let i = 1; i < n; i++) out.push(l(-hw + (w * i) / n, hd - 0.06, -hw + (w * i) / n, hd, 1.2))
      for (let x = -hw + 0.1; x < hw - 0.05; x += 0.07) out.push(l(x, -0.08, x + 0.03, 0.08, 0.5))
      return { base: fr, nodes: out }
    }
    case 'tv':
      out.push(r(0, 0, w, Math.min(d, 0.06), '#141414', 0.005))
      return { base: null, nodes: out }
    case 'plant':
    case 'vase':
      out.push(c(0, 0, Math.min(w, d) * 0.28, '#8a6a52'))
      out.push(...leafy(Math.min(w, d) / 2, '#5f9440', 7, Math.round(w * 1000)))
      return { base: null, nodes: out }
    case 'tree':
    case 'bush':
    case 'hedge': {
      const base = id === 'tree' ? '#4f9b35' : '#5aa540'
      if (id === 'hedge') {
        const n = Math.max(2, Math.round(w / Math.max(0.3, d)))
        const g: N[] = []
        for (let i = 0; i < n; i++) g.push({ tag: 'g', attrs: { transform: `translate(${-hw + (w / n) * (i + 0.5)} 0)` }, children: leafy(Math.min(d, w / n) * 0.62, base, 6, i + 3) })
        return { base: null, nodes: g }
      }
      return { base: null, nodes: leafy(Math.min(w, d) / 2, base, id === 'tree' ? 9 : 6, Math.round(w * 977)) }
    }
    case 'paving':
    case 'decking': {
      const fill = col('Surface', id === 'decking' ? '#a4825f' : '#a9a49b')
      out.push({ tag: 'rect', attrs: { x: -hw, y: -hd, width: w, height: d, fill, stroke: line, 'stroke-width': L } })
      if (id === 'decking') for (let y = -hd + 0.14; y < hd; y += 0.14) out.push(l(-hw, y, hw, y, 0.5))
      else {
        const s = 0.4
        for (let y = -hd + s; y < hd; y += s) out.push(l(-hw, y, hw, y, 0.5))
        let row = 0
        for (let y = -hd; y < hd; y += s, row++) for (let x = -hw + (row % 2 ? s / 2 : s); x < hw; x += s) out.push(l(x, y, x, Math.min(hd, y + s), 0.5))
      }
      return { base: null, nodes: out }
    }
    case 'floor-lamp':
    case 'arc-lamp':
    case 'iridescent-lamp':
      out.push(c(0, 0, Math.min(w, d) / 2, col('Shade', '#efe9de')))
      out.push(l(-hw * 0.6, 0, hw * 0.6, 0, 0.8), l(0, -hd * 0.6, 0, hd * 0.6, 0.8))
      return { base: null, nodes: out }
    case 'pendant':
    case 'barn-lamp':
      out.push(c(0, 0, Math.min(w, d) / 2, 'none', { 'stroke-dasharray': `${L * 3} ${L * 2}` }))
      out.push(c(0, 0, Math.min(w, d) * 0.12, '#f5d36b'))
      return { base: null, nodes: out }
    case 'range-hood':
      out.push(r(0, 0, w, d, col('Body', '#a8abae'), 0.01))
      for (let x = -hw + 0.06; x < hw - 0.04; x += 0.05) out.push(l(x, -hd + 0.06, x, hd - 0.06, 0.5))
      return { base: null, nodes: out }
    case 'mirror':
    case 'wall-art':
      out.push(r(0, 0, w, Math.max(d, 0.03), col('Frame', '#1c1c1c'), 0.004))
      return { base: null, nodes: out }
    case 'curtains': {
      const f = col('Fabric', '#e8e2d6')
      let dd = `M ${-hw} 0`
      for (let x = -hw; x < hw; x += 0.08) dd += ` q 0.02 ${d * 0.45} 0.04 0 t 0.04 0`
      out.push(p(dd, 'none', 2.2), { tag: 'path', attrs: { d: dd, fill: 'none', stroke: f, 'stroke-width': L * 1.4 } })
      return { base: null, nodes: out }
    }
    case 'radiator':
      out.push(r(0, 0, w, d, '#f4f3f0'))
      for (let x = -hw + 0.04; x < hw; x += 0.05) out.push(l(x, -hd, x, hd, 0.5))
      return { base: null, nodes: out }
    case 'stairs': {
      const n = Math.max(3, Math.round(d / 0.27))
      out.push(r(0, 0, w, d, col('Treads', '#c89a66')))
      for (let i = 1; i < n; i++) out.push(l(-hw, -hd + (d * i) / n, hw, -hd + (d * i) / n, 0.8))
      out.push(p(`M 0 ${hd - 0.15} L 0 ${-hd + 0.25} M -0.1 ${-hd + 0.38} L 0 ${-hd + 0.25} L 0.1 ${-hd + 0.38}`, 'none', 1.4))
      return { base: null, nodes: out }
    }
  }
  return { base: null, nodes: [] }
}
