// Floor plan import: a drawing (image or PDF) → walls (thick and thin), doors with their swing,
// windows, sliding doors, passages and the rooms with their names (no furniture). The scale comes from
// the drawing's own m² labels, so the rooms come out at the areas printed on the plan.
//
// Walls are the long, filled dark strokes. Each wall line is followed along its length: where the
// stroke stops and starts again there is an opening, and the symbol drawn in the gap says which
// kind (an arc and a leaf: a door, hinged at the arc's centre; lines along the wall: a window; two
// half lines: a sliding door; nothing: a passage). Boxes with a cross are wardrobes: they are
// recognised so they never become walls, but no furniture is placed.
import { analyse, pointInPolygon } from './geometry'
import { DEFAULT_CEILING_FINISH, DEFAULT_FLOOR_FINISH, DEFAULT_WALL_FINISH, OPENING_DEFAULTS, type Opening, type OpeningKind, type RoomInfo, type Vec2, type Wall } from './types'
import { areaLabels, pdfLines, type AreaLabel, type TextLine } from './importText'

/** RGBA pixels (ImageData-like). */
export interface Raster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface Drawing {
  canvas: HTMLCanvasElement
  /** The PDF's own text, when it has any (then no OCR is needed). */
  text: TextLine[] | null
}

const MAX_SIDE = 2000

/** Read an image or the first page of a PDF into a canvas (at most 2000 px on its long side). */
export async function readDrawing(file: File): Promise<Drawing> {
  const canvas = document.createElement('canvas')
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) })
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    const content = await page.getTextContent()
    const items = content.items.filter((it): it is (typeof content.items)[number] & { str: string; transform: number[]; width: number; height: number } => 'str' in it)
    const text = pdfLines(items, viewport.transform)
    return { canvas, text: text.length ? text : null }
  }
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return { canvas, text: null }
}

export const rasterOf = (c: HTMLCanvasElement): Raster => {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  return { width: d.width, height: d.height, data: d.data }
}

/* ───────── Pixels ───────── */

/** Otsu's threshold over the histogram range lo..hi. */
function otsu(hist: Float64Array, lo: number, hi: number) {
  let total = 0
  let sum = 0
  for (let i = lo; i <= hi; i++) {
    total += hist[i]
    sum += i * hist[i]
  }
  let sumB = 0
  let wB = 0
  let best = -1
  let th = (lo + hi) >> 1
  for (let i = lo; i <= hi; i++) {
    wB += hist[i]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += i * hist[i]
    const v = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2
    if (v > best) {
      best = v
      th = i
    }
  }
  return th
}

function meanOf(hist: Float64Array, lo: number, hi: number) {
  let n = 0
  let s = 0
  for (let i = lo; i <= hi; i++) {
    n += hist[i]
    s += i * hist[i]
  }
  return { n, mean: n ? s / n : (lo + hi) / 2 }
}

/** Run lengths of set pixels along rows and columns. */
function runLengths(m: Uint8Array, W: number, H: number) {
  const h = new Uint16Array(W * H)
  const v = new Uint16Array(W * H)
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      if (!m[y * W + x]) {
        x++
        continue
      }
      let e = x
      while (e < W && m[y * W + e]) e++
      for (let k = x; k < e; k++) h[y * W + k] = Math.min(65535, e - x)
      x = e
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0
    while (y < H) {
      if (!m[y * W + x]) {
        y++
        continue
      }
      let e = y
      while (e < H && m[e * W + x]) e++
      for (let k = y; k < e; k++) v[k * W + x] = Math.min(65535, e - y)
      y = e
    }
  }
  return { h, v }
}

/** A straight band of thick ink: along u (i0..i1), across v (o0..o1). Horizontal: u = x, v = y. */
interface Band {
  hor: boolean
  o0: number
  o1: number
  i0: number
  i1: number
  /** Centre line and thickness measured from the ink's darkness (to a fraction of a pixel). */
  o: number
  t: number
}

/** Sub-pixel centre and thickness of a band: the darkness summed across it, at points along it. */
function measure(b: Band, dark: Float32Array, W: number, H: number): Band {
  const ts: number[] = []
  const cs: number[] = []
  const M = b.hor ? H : W
  for (let k = 0; k < 15; k++) {
    const u = Math.round(b.i0 + ((b.i1 - b.i0) * (k + 0.5)) / 15)
    let sum = 0
    let mom = 0
    for (let v = Math.max(0, b.o0 - 2); v <= Math.min(M - 1, b.o1 + 2); v++) {
      const d = dark[b.hor ? v * W + u : u * W + v]
      sum += d
      mom += d * (v + 0.5)
    }
    if (sum > 0) {
      ts.push(sum)
      cs.push(mom / sum)
    }
  }
  const med = (a: number[]) => (a.length ? [...a].sort((p, q) => p - q)[a.length >> 1] : 0)
  return { ...b, t: med(ts), o: cs.length ? med(cs) : (b.o0 + b.o1 + 1) / 2 }
}

/** A wall line: collinear bands of one thickness, centre line at v = o. */
interface Line {
  hor: boolean
  o: number
  t: number
  bands: Band[]
}

interface Ctx {
  W: number
  H: number
  ink: Uint8Array
  /** Darkness 0..1 of each pixel (1 = the walls' ink). */
  dark: Float32Array
  soft: Uint8Array
  hRun: Uint16Array
  vRun: Uint16Array
  minStroke: number
  bands: Band[]
  lines: Line[]
  labels: AreaLabel[]
  cabinets: Rect[]
}

type Rect = [number, number, number, number]

/**
 * Dark ink, robust to grey floors: a first threshold separates paper from everything drawn; when
 * that still holds a large, clearly lighter class (filled floors, furniture), a second one splits it
 * off so only the walls and lines remain. `soft` is a looser mask for thin anti-aliased symbols.
 */
function inkMasks(r: Raster) {
  const W = r.width
  const H = r.height
  const lum = new Uint8Array(W * H)
  const hist = new Float64Array(256)
  for (let i = 0; i < W * H; i++) {
    const a = r.data[i * 4 + 3]
    const v = (r.data[i * 4] * 0.299 + r.data[i * 4 + 1] * 0.587 + r.data[i * 4 + 2] * 0.114) | 0
    lum[i] = a < 128 ? 255 : v
    hist[lum[i]]++
  }
  // Dark drawings (light lines on black) are read the other way round.
  if (meanOf(hist, 0, 255).mean < 100) {
    hist.fill(0)
    for (let i = 0; i < W * H; i++) hist[(lum[i] = 255 - lum[i])]++
  }
  const t1 = otsu(hist, 0, 255)
  const t2 = otsu(hist, 0, t1)
  const lo = meanOf(hist, 0, t2)
  const hi = meanOf(hist, t2 + 1, t1)
  const two = hi.mean - lo.mean > 60 && hi.n > (lo.n + hi.n) * 0.3 && hi.mean > 90
  const th = Math.min(two ? t2 : t1, 170)
  const ground = two ? hi.mean : meanOf(hist, t1 + 1, 255).mean
  const softTh = Math.min(th + (ground - th) * 0.45, 215)
  const ink = new Uint8Array(W * H)
  const soft = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) {
    ink[i] = lum[i] <= th ? 1 : 0
    soft[i] = lum[i] <= softTh ? 1 : 0
  }
  return { ink, soft, lum, inkLum: lo.mean, ground }
}

/** Bands of thick ink along one axis, from runs at least `minRun` long. */
function findBands(thick: Uint8Array, W: number, H: number, hor: boolean, minStroke: number): Band[] {
  const outer = hor ? H : W
  const inner = hor ? W : H
  const at = hor ? (o: number, i: number) => thick[o * W + i] : (o: number, i: number) => thick[i * W + o]
  const minRun = Math.max(6, minStroke * 2)
  type Open = Band & { l0: number; l1: number; hit: boolean }
  let open: Open[] = []
  const done: Band[] = []
  for (let o = 0; o < outer; o++) {
    for (const b of open) b.hit = false
    let i = 0
    while (i < inner) {
      if (!at(o, i)) {
        i++
        continue
      }
      let e = i
      while (e < inner && at(o, e)) e++
      if (e - i >= minRun) {
        const r0 = i
        const r1 = e - 1
        const b = open.find((x) => !x.hit && Math.abs(r0 - x.l0) <= 2 && Math.abs(r1 - x.l1) <= 2)
        if (b) {
          b.i0 = Math.min(b.i0, r0)
          b.i1 = Math.max(b.i1, r1)
          b.l0 = r0
          b.l1 = r1
          b.o1 = o
          b.hit = true
        } else open.push({ hor, o0: o, o1: o, i0: r0, i1: r1, l0: r0, l1: r1, hit: true, o: 0, t: 0 })
      }
      i = e
    }
    const still: Open[] = []
    for (const b of open) (b.hit ? still : done).push(b)
    open = still
  }
  done.push(...open)
  return done
    .map(({ hor, o0, o1, i0, i1 }) => ({ hor, o0, o1, i0, i1, o: (o0 + o1 + 1) / 2, t: o1 - o0 + 1 }))
    .filter((b) => {
      const t = b.o1 - b.o0 + 1
      return t >= minStroke && b.i1 - b.i0 + 1 >= Math.max(1.15 * t, minRun)
    })
}

/**
 * The part of a perpendicular wall inside another wall shows as a short band across it ("ghost"):
 * its length is exactly the other wall's thickness. Those are dropped.
 */
function dropGhosts(bands: Band[]) {
  return bands.filter((b) => !bands.some((p) => p.hor !== b.hor && Math.abs(b.i0 - p.o0) <= 2 && Math.abs(b.i1 - p.o1) <= 2 && b.o0 >= p.i0 - 2 && b.o1 <= p.i1 + 2 && p.i1 - p.i0 > b.i1 - b.i0))
}

/** Bands on one centre line with the same thickness are one wall line. */
function groupLines(bands: Band[]): Line[] {
  const lines: Line[] = []
  const sorted = [...bands].sort((a, b) => a.o - b.o)
  for (const b of sorted) {
    const { o, t } = b
    const l = lines.find((x) => x.hor === b.hor && Math.abs(x.o - o) <= Math.max(1.5, 0.3 * Math.max(x.t, t)) && Math.abs(x.t - t) <= Math.max(2, 0.35 * Math.max(x.t, t)))
    if (l) {
      l.bands.push(b)
      let wsum = 0
      let osum = 0
      let tsum = 0
      for (const q of l.bands) {
        const w = q.i1 - q.i0 + 1
        wsum += w
        osum += w * q.o
        tsum += w * q.t
      }
      l.o = osum / wsum
      l.t = tsum / wsum
    } else lines.push({ hor: b.hor, o, t, bands: [b] })
  }
  return lines
}

/** Clear the strokes of `m` that lie wholly inside the box (lettering, a wardrobe), not walls running through it. */
function eraseInside(m: Uint8Array, W: number, H: number, [bx0, by0, bx1, by1]: Rect, pad: number) {
  const x0 = Math.max(0, Math.floor(bx0 - pad))
  const x1 = Math.min(W - 1, Math.ceil(bx1 + pad))
  const y0 = Math.max(0, Math.floor(by0 - pad))
  const y1 = Math.min(H - 1, Math.ceil(by1 + pad))
  if (x1 < x0 || y1 < y0) return
  const bw = x1 - x0 + 1
  const inH = new Uint8Array(bw * (y1 - y0 + 1))
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; ) {
      if (!m[y * W + x]) {
        x++
        continue
      }
      let s = x
      while (s > 0 && m[y * W + s - 1]) s--
      let e = x
      while (e < W - 1 && m[y * W + e + 1]) e++
      if (s >= x0 && e <= x1) for (let k = x; k <= e; k++) inH[(y - y0) * bw + k - x0] = 1
      x = e + 1
    }
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; ) {
      if (!m[y * W + x]) {
        y++
        continue
      }
      let s = y
      while (s > 0 && m[(s - 1) * W + x]) s--
      let e = y
      while (e < H - 1 && m[(e + 1) * W + x]) e++
      if (s >= y0 && e <= y1) for (let k = y; k <= e; k++) if (inH[(k - y0) * bw + x - x0]) m[k * W + x] = 0
      y = e + 1
    }
}

/** Clear door swings, glazing and wardrobe crosses from a greyscale copy of the drawing (for OCR). */
function eraseSymbols(img: Uint8Array, W: number, H: number, walls: PxWall[], cells: Rect[]) {
  const dot = (x: number, y: number, r = 2) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const X = Math.round(x) + dx
        const Y = Math.round(y) + dy
        if (X >= 0 && Y >= 0 && X < W && Y < H) img[Y * W + X] = 0
      }
  }
  const seg = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0))
    for (let i = 0; i <= n; i++) dot(x0 + ((x1 - x0) * i) / Math.max(1, n), y0 + ((y1 - y0) * i) / Math.max(1, n))
  }
  for (const [x0, y0, x1, y1] of cells) {
    seg(x0, y0, x1, y0)
    seg(x1, y0, x1, y1)
    seg(x1, y1, x0, y1)
    seg(x0, y1, x0, y0)
    seg(x0, y0, x1, y1)
    seg(x1, y0, x0, y1)
  }
  for (const w of walls)
    for (const g of w.gaps) {
      const P = (u: number, v: number): [number, number] => (w.hor ? [u, v] : [v, u])
      // Glazing / sliding leaves: the gap across the wall.
      for (let u = g.e; u <= g.s; u += 1) {
        const [ax, ay] = P(u, w.o - w.t / 2)
        const [bx, by] = P(u, w.o + w.t / 2)
        seg(ax, ay, bx, by)
      }
      const sw = g.sym.swing
      if (!sw) continue
      const leaves: [number, number][] = sw.double ? [[g.e, 1], [g.s, -1]] : [[sw.hinge === 'e' ? g.e : g.s, sw.hinge === 'e' ? 1 : -1]]
      for (const [uh, dir] of leaves) {
        const face = w.o + sw.side * (w.t / 2)
        seg(...P(uh, face), ...P(uh, face + sw.side * sw.r))
        const n = Math.ceil(sw.r * 1.6)
        for (let i = 0; i <= n; i++) {
          const th = ((Math.PI / 2) * i) / n
          dot(...P(uh + dir * sw.r * Math.cos(th), face + sw.side * sw.r * Math.sin(th)))
        }
      }
    }
}

/** Bands lying side by side (a wall split lengthwise by a line drawn through it) → one band. */
function mergeSideBySide(bands: Band[]) {
  const out = [...bands]
  for (let changed = true; changed; ) {
    changed = false
    for (let i = 0; i < out.length && !changed; i++)
      for (let j = i + 1; j < out.length && !changed; j++) {
        const a = out[i]
        const b = out[j]
        if (a.hor !== b.hor) continue
        const touch = Math.max(a.o0, b.o0) - Math.min(a.o1, b.o1) <= 3
        const ov = Math.min(a.i1, b.i1) - Math.max(a.i0, b.i0)
        if (!touch || ov < 0.7 * Math.max(a.i1 - a.i0, b.i1 - b.i0)) continue
        out[i] = { hor: a.hor, o0: Math.min(a.o0, b.o0), o1: Math.max(a.o1, b.o1), i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), o: 0, t: 0 }
        out.splice(j, 1)
        changed = true
      }
  }
  return out
}

/* ───────── Wardrobes: boxes with a cross ───────── */

function findCabinets(c: { W: number; H: number; soft: Uint8Array; minStroke: number }): { groups: Rect[]; cells: Rect[] } {
  const { W, H, soft } = c
  const { h: hR, v: vR } = runLengths(soft, W, H)
  const thin = c.minStroke + 1
  const near = (x: number, y: number) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const X = xi + dx
        const Y = yi + dy
        if (X >= 0 && Y >= 0 && X < W && Y < H && soft[Y * W + X]) return true
      }
    return false
  }
  // Thin straight lines.
  const segs = (hor: boolean) => {
    const out: { o: number; a: number; b: number }[] = []
    const outer = hor ? H : W
    const inner = hor ? W : H
    for (let o = 0; o < outer; o++) {
      let i = 0
      while (i < inner) {
        const idx = hor ? o * W + i : i * W + o
        if (!soft[idx] || (hor ? vR[idx] : hR[idx]) > thin) {
          i++
          continue
        }
        let e = i
        while (e < inner) {
          const j = hor ? o * W + e : e * W + o
          if (!soft[j] || (hor ? vR[j] : hR[j]) > thin) break
          e++
        }
        if (e - i >= 8) out.push({ o, a: i, b: e - 1 })
        i = e
      }
    }
    // Neighbouring rows of one anti-aliased line → one.
    out.sort((p, q) => p.o - q.o)
    const merged: typeof out = []
    for (const s of out) {
      const m = merged.find((x) => s.o - x.o <= 2 && Math.min(x.b, s.b) - Math.max(x.a, s.a) > 0.6 * Math.min(x.b - x.a, s.b - s.a))
      if (m) {
        m.a = Math.min(m.a, s.a)
        m.b = Math.max(m.b, s.b)
      } else merged.push({ ...s })
    }
    return merged
  }
  const hs = segs(true)
  const vs = segs(false)
  const uniq = (v: number[]) => [...new Set(v.map((x) => Math.round(x)))].sort((a, b) => a - b)
  const minCell = Math.max(8, c.minStroke * 3)
  const maxCell = Math.max(W, H) * 0.12
  const frac = (n: number, f: (s: number) => [number, number], need: number) => {
    let hit = 0
    for (let k = 0; k < n; k++) if (near(...f((k + 0.5) / n))) hit++
    return hit >= need * n
  }
  const cells: Rect[] = []
  for (const top of hs) {
    // Sides: the line's own ends, and lines going down from it.
    const xs = uniq([
      ...hs.filter((h) => Math.abs(h.o - top.o) <= maxCell && Math.min(h.b, top.b) - Math.max(h.a, top.a) > 0).flatMap((h) => [h.a - 1, h.b + 1]),
      ...vs.filter((v) => v.o >= top.a - 3 && v.o <= top.b + 3 && v.a <= top.o + Math.max(6, minCell / 2) && v.b >= top.o + minCell / 2).map((v) => v.o)]).filter((x) => x >= top.a - 4 && x <= top.b + 4)
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < Math.min(xs.length, i + 8); j++) {
        const x0 = xs[i]
        const x1 = xs[j]
        if (x1 - x0 < minCell || x1 - x0 > maxCell) continue
        // The bottom: the next lines below that span the same width (or a wall face there).
        const slack = Math.max(4, (x1 - x0) * 0.15)
        const ys = uniq([
          ...hs.filter((h) => h.o >= top.o + minCell && h.o <= top.o + maxCell && h.a <= x0 + slack && h.b >= x1 - slack).map((h) => h.o),
          ...vs.filter((v) => Math.abs(v.o - x0) <= 2 || Math.abs(v.o - x1) <= 2).map((v) => v.b + 1).filter((y) => y >= top.o + minCell && y <= top.o + maxCell),
        ]).slice(0, 6)
        for (const y1 of ys) {
          const y0 = top.o
          const ok =
            frac(10, (s) => [x0 + (x1 - x0) * (0.1 + 0.8 * s), y0], 0.9) &&
            frac(10, (s) => [x0 + (x1 - x0) * (0.1 + 0.8 * s), y1], 0.9) &&
            frac(10, (s) => [x0, y0 + (y1 - y0) * (0.1 + 0.8 * s)], 0.9) &&
            frac(10, (s) => [x1, y0 + (y1 - y0) * (0.1 + 0.8 * s)], 0.9) &&
            frac(16, (s) => [x0 + (x1 - x0) * (0.12 + 0.76 * s), y0 + (y1 - y0) * (0.12 + 0.76 * s)], 0.85) &&
            frac(16, (s) => [x1 - (x1 - x0) * (0.12 + 0.76 * s), y0 + (y1 - y0) * (0.12 + 0.76 * s)], 0.85)
          if (!ok) continue
          // A cross, not a solid box: the four triangles between the arms are empty.
          const empty = ([[0.5, 0.2], [0.5, 0.8], [0.2, 0.5], [0.8, 0.5]] as const).filter(([u, v]) => !near(x0 + (x1 - x0) * u, y0 + (y1 - y0) * v)).length
          if (empty >= 2) cells.push([x0, y0, x1, y1])
        }
      }
  }
  // Duplicates (a pixel apart) → one.
  const area = (r: Rect) => (r[2] - r[0]) * (r[3] - r[1])
  const iou = (a: Rect, b: Rect) => {
    const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0])
    const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
    if (w <= 0 || h <= 0) return 0
    return (w * h) / (area(a) + area(b) - w * h)
  }
  const unique: Rect[] = []
  for (const r of cells) if (!unique.some((u) => iou(u, r) > 0.5)) unique.push(r)
  // Cells side by side → one wardrobe.
  const parent = unique.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < unique.length; i++)
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i]
      const b = unique[j]
      const ov = (p0: number, p1: number, q0: number, q1: number) => Math.min(p1, q1) - Math.max(p0, q0) > 0.8 * Math.min(p1 - p0, q1 - q0)
      const side = (Math.abs(a[2] - b[0]) <= 3 || Math.abs(b[2] - a[0]) <= 3) && ov(a[1], a[3], b[1], b[3])
      const stack = (Math.abs(a[3] - b[1]) <= 3 || Math.abs(b[3] - a[1]) <= 3) && ov(a[0], a[2], b[0], b[2])
      if (side || stack) parent[find(i)] = find(j)
    }
  const groups = new Map<number, Rect>()
  for (let i = 0; i < unique.length; i++) {
    const g = find(i)
    const r = unique[i]
    const cur = groups.get(g)
    groups.set(g, cur ? [Math.min(cur[0], r[0]), Math.min(cur[1], r[1]), Math.max(cur[2], r[2]), Math.max(cur[3], r[3])] : [...r])
  }
  return { groups: [...groups.values()], cells: unique }
}

/* ───────── Analysis ───────── */

export interface ImportOptions {
  /** Text already known (a PDF's text layer). */
  text?: TextLine[] | null
  /** Read the text with OCR: gets the drawing's darkness (0..255) without its walls. */
  ocr?: (ink: Uint8Array, width: number, height: number) => Promise<TextLine[]>
}

export interface ImportAnalysis {
  ctx: Ctx
  /** Scale from the drawing's own m² labels (m per pixel), or null when it has none that fit. */
  labelScale: number | null
  /** First guess from the wall thickness, when there are no labels. */
  guessScale: number
}

/** Look at a drawing: walls, symbols, wardrobes and labels, before the scale is known. */
export async function analyseDrawing(r: Raster, opts: ImportOptions = {}): Promise<ImportAnalysis> {
  const W = r.width
  const H = r.height
  const { ink, soft, lum, inkLum, ground } = inkMasks(r)
  const dark = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) dark[i] = Math.max(0, Math.min(1, (ground - lum[i]) / Math.max(1, ground - inkLum)))
  const { h: hRun, v: vRun } = runLengths(ink, W, H)

  // The width of the thin lines (furniture, symbols, text): walls are anything clearly wider.
  const sw = new Float64Array(16)
  for (let i = 0; i < W * H; i++) if (ink[i]) sw[Math.min(15, Math.min(hRun[i], vRun[i]))]++
  let thinW = 1
  for (let k = 2; k <= 4; k++) if (sw[k] > sw[thinW] * 1.15) thinW = k
  const minStroke = Math.max(3, Math.min(7, thinW + 2))

  const { groups: cabinets, cells } = findCabinets({ W, H, soft, minStroke })
  const thick0 = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) thick0[i] = ink[i] && Math.min(hRun[i], vRun[i]) >= minStroke ? 1 : 0
  // Wardrobes, outline included, but not a wall they stand against (its strokes run on past them).
  for (const box of cabinets) eraseInside(thick0, W, H, box, 2)

  /** Wall bands and lines, with the lettering in `boxes` taken out first. */
  const linesWithout = (boxes: Rect[]) => {
    const thick = boxes.length ? thick0.slice() : thick0
    for (const box of boxes) eraseInside(thick, W, H, box, 2)
    const bands = mergeSideBySide(dropGhosts([...findBands(thick, W, H, true, minStroke), ...findBands(thick, W, H, false, minStroke)]))
      .map((b) => measure(b, dark, W, H))
      .filter((b) => b.t >= Math.max(2.6, minStroke - 0.4))
    return { bands, lines: groupLines(bands) }
  }
  const ctx: Ctx = { W, H, ink, dark, soft, hRun, vRun, minStroke, ...linesWithout([]), labels: [], cabinets }

  // First guess: the outside walls (the thickest of the long ones) are about 0.35 m.
  const byT = ctx.lines.map((l) => ({ t: l.t, len: l.bands.reduce((s, b) => s + b.i1 - b.i0, 0) })).sort((a, b) => a.t - b.t)
  const total = byT.reduce((s, x) => s + x.len, 0)
  let acc = 0
  let tE = 10
  for (const x of byT) {
    acc += x.len
    tE = x.t
    if (acc >= total * 0.8) break
  }
  const guessScale = 0.35 / Math.max(3, tE)

  // Text: from the PDF, or read with OCR on the drawing without its walls and symbols (door
  // swings, wardrobe crosses, glazing), which would otherwise run through the room names.
  let text = opts.text ?? null
  if (!text && opts.ocr) {
    const plain = new Uint8Array(W * H)
    for (let i = 0; i < W * H; i++) plain[i] = Math.min(hRun[i], vRun[i]) >= minStroke && Math.max(hRun[i], vRun[i]) >= 40 ? 0 : Math.round(dark[i] * 255)
    eraseSymbols(plain, W, H, planAt(ctx, guessScale).px, cells)
    try {
      text = await opts.ocr(plain, W, H)
    } catch (e) {
      console.warn('OCR failed', e)
      text = []
    }
  }
  if (text?.length) Object.assign(ctx, linesWithout(text.map((l) => [l.x0, l.y0, l.x1, l.y1] as Rect)))
  ctx.labels = areaLabels(text ?? [])
  const labels = ctx.labels

  // Scale from the labels: the rooms' areas grow with the square of the scale.
  let labelScale: number | null = null
  if (labels.length) {
    const p0 = planAt(ctx, guessScale)
    const ratios: number[] = []
    for (const c of p0.checks) if (c.computed && c.unique) ratios.push(c.label / c.computed)
    if (ratios.length) {
      ratios.sort((a, b) => a - b)
      const med = ratios[ratios.length >> 1]
      const good = ratios.filter((x) => Math.abs(x / med - 1) < 0.04)
      const r2 = good.reduce((s, x) => s + x, 0) / good.length
      labelScale = guessScale * Math.sqrt(r2)
      // Once more at that scale: gap rules in metres can change which rooms close.
      const p1 = planAt(ctx, labelScale)
      const r1 = p1.checks.filter((c) => c.computed && c.unique).map((c) => c.label / c.computed!)
      if (r1.length >= Math.min(2, ratios.length)) {
        r1.sort((a, b) => a - b)
        const m1 = r1[r1.length >> 1]
        const g1 = r1.filter((x) => Math.abs(x / m1 - 1) < 0.03)
        labelScale *= Math.sqrt(g1.reduce((s, x) => s + x, 0) / g1.length)
      }
    }
  }
  return { ctx, labelScale, guessScale }
}

/** One room label checked against the plan: the area printed on the drawing and the area built. */
export interface AreaCheck {
  name: string | null
  label: number
  /** Floor area of the room the label is in (null: the label is in no closed room). */
  computed: number | null
  /** The only label in its room (two labels in one room: a wall between them was missed). */
  unique: boolean
  /** Where the label is, in drawing pixels. */
  at: Vec2
}

export interface ImportedPlan {
  /** Metres per drawing pixel. */
  k: number
  walls: Wall[]
  openings: Opening[]
  rooms: RoomInfo[]
  checks: AreaCheck[]
  /** Plan position of drawing pixel (0, 0): plan = px · k + offset. */
  offset: Vec2
  /** The walls and their openings in drawing pixels (for the preview). */
  px: PxWall[]
}

export interface PxWall {
  hor: boolean
  o: number
  t: number
  a: number
  b: number
  gaps: Gap[]
}

export interface Gap {
  e: number
  s: number
  sym: Symbols
}

export interface Symbols {
  glazing: number
  sliding: boolean
  swing: { hinge: 'e' | 's'; side: 1 | -1; double: boolean; r: number } | null
}

/** Build the plan from an analysed drawing at `k` metres per pixel. */
export function planAt(ctx: Ctx, k: number, levelId = 'L', uid: () => string = counter()): ImportedPlan {
  const { W, H, ink, soft } = ctx
  const px = (m: number) => m / k
  const idx = (hor: boolean, u: number, v: number) => (hor ? v * W + u : u * W + v)
  const inside = (hor: boolean, u: number, v: number) => u >= 0 && v >= 0 && (hor ? u < W && v < H : u < H && v < W)
  const near = (hor: boolean, u: number, v: number, r = 1) => {
    const ui = Math.round(u)
    const vi = Math.round(v)
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (inside(hor, ui + a, vi + b) && soft[idx(hor, ui + a, vi + b)]) return true
    return false
  }

  /** What is drawn in the gap e..s of a line. */
  const symbols = (L: Line, e: number, s: number): Symbols => {
    const g = s - e
    const v0 = Math.ceil(L.o - L.t / 2 + 1)
    const v1 = Math.floor(L.o + L.t / 2 - 1)
    const groups: { full: boolean; h1: number; h2: number }[] = []
    let prev = -10
    for (let v = v0; v <= v1; v++) {
      let n1 = 0
      let n2 = 0
      let c1 = 0
      let c2 = 0
      for (let u = Math.ceil(e + 2); u <= Math.floor(s - 2); u++) {
        const hit = inside(L.hor, u, v) && soft[idx(L.hor, u, v)] ? 1 : 0
        if (u < (e + s) / 2) {
          n1++
          c1 += hit
        } else {
          n2++
          c2 += hit
        }
      }
      const h1 = n1 ? c1 / n1 : 0
      const h2 = n2 ? c2 / n2 : 0
      const f = (c1 + c2) / Math.max(1, n1 + n2)
      if (f >= 0.3 || h1 >= 0.7 || h2 >= 0.7) {
        if (v - prev <= 1 && groups.length) {
          const G = groups[groups.length - 1]
          G.h1 = Math.max(G.h1, h1)
          G.h2 = Math.max(G.h2, h2)
          G.full ||= f >= 0.7
        } else groups.push({ full: f >= 0.7, h1, h2 })
        prev = v
      }
    }
    const glazing = groups.filter((G) => G.full).length
    const partial = groups.filter((G) => !G.full)
    const sliding = partial.some((p) => p.h1 >= 0.75 && p.h2 < 0.6) && partial.some((p) => p.h2 >= 0.75 && p.h1 < 0.6)

    // Door swings: a quarter arc around a hinge at one end of the gap, on one side of the wall.
    const arc = (uh: number, dir: number, side: number, r: number) => {
      let hit = 0
      const n = 9
      for (let i = 0; i < n; i++) {
        const th = ((8 + (74 * i) / (n - 1)) * Math.PI) / 180
        if (near(L.hor, uh + dir * r * Math.cos(th), L.o + side * (L.t / 2 + r * Math.sin(th)))) hit++
      }
      return hit / n
    }
    const best = (uh: number, dir: number, side: number, r0: number, r1: number) => {
      let b = 0
      let br = r0
      const step = Math.max(0.75, (r1 - r0) / 12)
      for (let r = r0; r <= r1; r += step) {
        const v = arc(uh, dir, side, r)
        if (v > b) {
          b = v
          br = r
        }
      }
      return [b, br] as const
    }
    let swing: Symbols['swing'] = null
    let score = 0.72
    for (const side of [1, -1] as const) {
      for (const hinge of ['e', 's'] as const) {
        const [v, r] = hinge === 'e' ? best(e, 1, side, g * 0.78, g * 1.06) : best(s, -1, side, g * 0.78, g * 1.06)
        if (v > score) {
          score = v
          swing = { hinge, side, double: false, r }
        }
      }
      const [d1, r1] = best(e, 1, side, g * 0.4, g * 0.54)
      const [d2] = best(s, -1, side, g * 0.4, g * 0.54)
      const dbl = Math.min(d1, d2)
      if (dbl > Math.max(score, 0.72) - 0.02 && dbl > 0.72) {
        score = dbl + 0.02
        swing = { hinge: 'e', side, double: true, r: r1 }
      }
    }
    return { glazing, sliding, swing }
  }

  /** Perpendicular walls standing at u on line L: which sides of it they leave towards. */
  const perpAt = (L: Line, u: number, end: 'start' | 'end') => {
    const sides = new Set<number>()
    for (const P of ctx.bands) {
      if (P.hor === L.hor) continue
      const face = end === 'end' ? P.o1 : P.o0
      if (Math.abs(face - u) > 3) continue
      if (P.i0 > L.o + L.t / 2 + 3 || P.i1 < L.o - L.t / 2 - 3) continue
      if (P.i0 < L.o - L.t / 2 - 3) sides.add(-1)
      if (P.i1 > L.o + L.t / 2 + 3) sides.add(1)
    }
    return sides
  }

  // 1. Follow every line: solid stretches, and the gaps between them that are openings.
  const walls: PxWall[] = []
  for (const L of ctx.lines) {
    const N = L.hor ? W : H
    const va = Math.round(L.o - Math.max(0.5, L.t * 0.3))
    const vb = Math.round(L.o + Math.max(0.5, L.t * 0.3))
    const solid = new Uint8Array(N)
    for (let u = 0; u < N; u++) {
      let n = 0
      let c = 0
      for (let v = va; v <= vb; v++)
        if (inside(L.hor, u, v)) {
          n++
          c += ink[idx(L.hor, u, v)]
        }
      solid[u] = n && c / n >= 0.75 ? 1 : 0
    }
    for (let u = 1; u < N - 1; u++) if (!solid[u] && solid[u - 1] && solid[u + 1]) solid[u] = 1
    type Run = { s0: number; s1: number; seed: boolean }
    const runs: Run[] = []
    for (let u = 0; u < N; ) {
      if (!solid[u]) {
        u++
        continue
      }
      let e = u
      while (e < N && solid[e]) e++
      const s0 = u
      const s1 = e - 1
      // A drawn wall: part of a band, and long enough not to be a letter's stroke (or at a joint).
      const seed = L.bands.some((b) => Math.min(b.i1, s1) - Math.max(b.i0, s0) >= 0.5 * Math.min(b.i1 - b.i0, s1 - s0)) && (s1 - s0 >= px(0.3) || perpAt(L, s0, 'start').size > 0 || perpAt(L, s1, 'end').size > 0)
      runs.push({ s0, s1, seed })
      u = e
    }
    // Chains of runs, bridged across gaps that are openings.
    const chains: { runs: Run[]; gaps: Gap[] }[] = []
    let cur: { runs: Run[]; gaps: Gap[] } | null = null
    for (const r of runs) {
      if (cur) {
        const last = cur.runs[cur.runs.length - 1]
        const e = last.s1 + 1
        const s = r.s0
        const g = s - e
        let bridge = g <= px(0.35)
        let sym: Symbols = { glazing: 0, sliding: false, swing: null }
        if (!bridge && g <= px(4.5)) {
          sym = symbols(L, e, s)
          const A = perpAt(L, last.s1, 'end')
          const B = perpAt(L, r.s0, 'start')
          // The wall turns the same way at both ends: a bay or a step in the outline, not an opening.
          const bay = A.size === 1 && B.size === 1 && [...A][0] === [...B][0]
          const has = sym.glazing > 0 || sym.sliding || !!sym.swing
          // A plain gap is only a passage between real pieces of wall (not lettering or furniture lines).
          const wallish = (x: Run) => x.seed || perpAt(L, x.s0, 'start').size > 0 || perpAt(L, x.s1, 'end').size > 0
          if (!has && !(wallish(last) && wallish(r))) bridge = false
          else if (!bay) {
            if (has) bridge = true
            else if (!A.size && !B.size) bridge = g <= px(2.6)
            else if (!A.size || !B.size) bridge = g <= px(1.2)
          }
        }
        if (bridge) {
          if (g > px(0.35)) cur.gaps.push({ e, s, sym })
          cur.runs.push(r)
          continue
        }
        chains.push(cur)
        cur = null
      }
      cur = { runs: [r], gaps: [] }
    }
    if (cur) chains.push(cur)
    for (const ch of chains) {
      // Loose ends that are neither a drawn wall nor a corner are not part of it.
      const anchored = (r: Run, end: 'start' | 'end') => perpAt(L, end === 'start' ? r.s0 : r.s1, end).size > 0
      while (ch.runs.length && !ch.runs[0].seed && !anchored(ch.runs[0], 'start')) {
        const r = ch.runs.shift()!
        ch.gaps = ch.gaps.filter((g) => g.e > r.s1 + 1)
      }
      while (ch.runs.length && !ch.runs[ch.runs.length - 1].seed && !anchored(ch.runs[ch.runs.length - 1], 'end')) {
        const r = ch.runs.pop()!
        ch.gaps = ch.gaps.filter((g) => g.s < r.s0)
      }
      if (!ch.runs.some((r) => r.seed)) continue
      const a = ch.runs[0].s0
      const b = ch.runs[ch.runs.length - 1].s1 + 1
      if (b - a < Math.max(L.t * 1.1, px(0.25))) continue
      walls.push({ hor: L.hor, o: L.o, t: L.t, a, b, gaps: ch.gaps })
    }
  }

  // 2. Corners and T-joints: an end inside a crossing wall stops on its centre line.
  const touched = new Set<PxWall>()
  for (const w of walls)
    for (const end of ['a', 'b'] as const) {
      let bestD = Infinity
      let to: number | null = null
      for (const p of walls) {
        if (p.hor === w.hor) continue
        if (w.o < p.a - w.t / 2 - 3 || w.o > p.b + w.t / 2 + 3) continue
        const d = Math.abs(w[end] - p.o)
        if (d <= p.t / 2 + 3 && d < bestD) {
          bestD = d
          to = p.o
          touched.add(p)
        }
      }
      if (to !== null) {
        w[end] = to
        touched.add(w)
      }
    }
  // Crossings count as joined too; whatever touches nothing (a TV, a stray mark) is dropped.
  for (const w of walls) for (const p of walls) if (p.hor !== w.hor && p.o > w.a && p.o < w.b && w.o > p.a && w.o < p.b) touched.add(w).add(p)
  const kept = walls.filter((w) => touched.has(w) || (w.b - w.a) * k >= 2)

  // 3. To metres, centred on the plan.
  const xs = kept.flatMap((w) => (w.hor ? [w.a, w.b] : [w.o]))
  const ys = kept.flatMap((w) => (w.hor ? [w.o] : [w.a, w.b]))
  const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : W / 2
  const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : H / 2
  const mm = (v: number) => Math.round(v * 1000) / 1000
  const P = (x: number, y: number): Vec2 => [mm((x - cx) * k), mm((y - cy) * k)]
  const wallOf = new Map<PxWall, Wall>()
  const planWalls: Wall[] = kept.map((w) => {
    const pw: Wall = { id: uid(), levelId, a: w.hor ? P(w.a, w.o) : P(w.o, w.a), b: w.hor ? P(w.b, w.o) : P(w.o, w.b), thickness: Math.max(0.04, Math.round(w.t * k * 1000) / 1000) }
    wallOf.set(w, pw)
    return pw
  })
  const geom = analyse(planWalls)
  const inRoom = (p: Vec2) => geom.faces.some((f) => pointInPolygon(p, f.polygon))

  // 4. Openings.
  const openings: Opening[] = []
  for (const w of kept) {
    const pw = wallOf.get(w)!
    for (const g of w.gaps) {
      const width = mm((g.s - g.e) * k)
      const mid = (g.e + g.s) / 2
      const t = mm((mid - w.a) * k)
      // Outside wall: the far side of the gap is outside every room.
      const off = w.t / 2 + px(0.25)
      const c1 = w.hor ? P(mid, w.o - off) : P(w.o - off, mid)
      const c2 = w.hor ? P(mid, w.o + off) : P(w.o + off, mid)
      const exterior = !inRoom(c1) || !inRoom(c2)
      const { glazing, sliding, swing } = g.sym
      let kind: OpeningKind
      if (swing?.double) kind = exterior || glazing ? 'french-window' : 'double-door'
      else if (swing) kind = 'door'
      else if (sliding) kind = 'sliding-door'
      else if (glazing && (exterior || glazing >= 2)) kind = width >= 1.8 ? 'wide-window' : 'window'
      else kind = exterior ? 'window' : 'archway'
      const d = OPENING_DEFAULTS[kind]
      // Left of a → b: +y for walls along x, −x for walls along y.
      const sideOf = (s: number): 'left' | 'right' => ((w.hor ? s : -s) > 0 ? 'left' : 'right')
      openings.push({
        id: uid(),
        wallId: pw.id,
        kind,
        t,
        width,
        height: d.height,
        sill: d.sill,
        hinge: swing && !swing.double && swing.hinge === 's' ? 'b' : 'a',
        side: swing ? sideOf(swing.side) : 'left',
        open: 0,
        frame: { color: '#f4f2ee' },
      })
    }
  }

  // 5. Rooms from the labels, and how their areas compare.
  const toPlan = (p: Vec2): Vec2 => P(p[0], p[1])
  const checks: AreaCheck[] = []
  const rooms: RoomInfo[] = []
  const perFace = new Map<number, AreaLabel[]>()
  for (const l of ctx.labels) {
    const f = geom.faces.find((x) => pointInPolygon(toPlan(l.at), x.polygon))
    if (f) perFace.set(f.index, [...(perFace.get(f.index) ?? []), l])
  }
  for (const l of ctx.labels) {
    const at = toPlan(l.at)
    const f = geom.faces.find((x) => pointInPolygon(at, x.polygon))
    const unique = !!f && perFace.get(f.index)!.length === 1
    // "24 m²" read without its decimal point in a 2.4 m² room.
    const label = f && l.area / f.area > 8.5 && l.area / f.area < 11.5 ? l.area / 10 : l.area
    checks.push({ name: l.name, label, computed: f ? Math.round(f.area * 100) / 100 : null, unique, at: l.at })
    if (f && unique && l.name) rooms.push({ id: uid(), levelId, anchor: at, name: l.name, floor: floorFor(l.name), walls: { ...DEFAULT_WALL_FINISH }, ceiling: { ...DEFAULT_CEILING_FINISH } })
  }

  return { k, walls: planWalls, openings, rooms, checks, offset: [-cx * k, -cy * k], px: kept }
}

/** Wet rooms get a tiled floor, the rest the default wood. */
function floorFor(name: string) {
  return /\b(bad|wc|toilet|bryggers|vaskerum|bath)/i.test(name) ? { color: '#b9b7b2', preset: 'grey-tile' } : { ...DEFAULT_FLOOR_FINISH }
}

function counter() {
  let n = 0
  return () => `imp${++n}`
}
