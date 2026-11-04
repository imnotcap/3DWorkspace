// Floor plan import: a drawing (image or PDF) → walls, doors and windows. No furniture.
import type { Opening, Vec2, Wall } from './types'

/** A straight wall found in the drawing, in image pixels (centre line, thickness). */
export interface PxWall {
  a: Vec2
  b: Vec2
  t: number
  horizontal: boolean
}

export interface Detection {
  width: number
  height: number
  walls: PxWall[]
  /** Typical wall thickness in pixels (used to guess the scale). */
  thickness: number
}

const MAX_SIDE = 1600

/** Read an image or the first page of a PDF into a canvas (at most 1600 px on its long side). */
export async function readDrawing(file: File): Promise<HTMLCanvasElement> {
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
    return canvas
  }
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  canvas.width = Math.round(bmp.width * k)
  canvas.height = Math.round(bmp.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close()
  return canvas
}

/** Otsu's threshold on a luminance histogram. */
function otsu(hist: Uint32Array, total: number) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let th = 128
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += i * hist[i]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) ** 2
    if (v > best) {
      best = v
      th = i
    }
  }
  return th
}

/**
 * Walls are the thick dark strokes of a drawing. Thin lines (window glazing, door swings,
 * furniture, dimensions, text) are left out by their stroke width, so a window drawn in a wall
 * shows as a gap, which becomes a window or door when the walls on either side are joined.
 */
export function detectWalls(canvas: HTMLCanvasElement): Detection {
  const W = canvas.width
  const H = canvas.height
  const data = canvas.getContext('2d')!.getImageData(0, 0, W, H).data
  const lum = new Uint8Array(W * H)
  const hist = new Uint32Array(256)
  for (let i = 0; i < W * H; i++) {
    const v = Math.round(data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114)
    // Transparent pixels count as paper.
    lum[i] = data[i * 4 + 3] < 128 ? 255 : v
    hist[lum[i]]++
  }
  // Dark drawings (light walls on a dark background) are read the other way round.
  let mean = 0
  for (let i = 0; i < 256; i++) mean += i * hist[i]
  mean /= W * H
  const inverted = mean < 110
  const th = otsu(hist, W * H)
  const dark = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) dark[i] = inverted ? (lum[i] > Math.max(th, 140) ? 1 : 0) : lum[i] <= Math.min(200, th) ? 1 : 0

  // Run lengths of dark pixels along rows and columns.
  const hRun = new Uint16Array(W * H)
  const vRun = new Uint16Array(W * H)
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      if (!dark[y * W + x]) {
        x++
        continue
      }
      let e = x
      while (e < W && dark[y * W + e]) e++
      for (let k = x; k < e; k++) hRun[y * W + k] = Math.min(65535, e - x)
      x = e
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0
    while (y < H) {
      if (!dark[y * W + x]) {
        y++
        continue
      }
      let e = y
      while (e < H && dark[e * W + x]) e++
      for (let k = y; k < e; k++) vRun[k * W + x] = Math.min(65535, e - y)
      y = e
    }
  }

  // Typical wall thickness: the stroke width of long strokes (weighted by how much of it there is).
  const tw = new Float64Array(200)
  for (let i = 0; i < W * H; i++) {
    if (!dark[i]) continue
    const lo = Math.min(hRun[i], vRun[i])
    const hi = Math.max(hRun[i], vRun[i])
    if (lo >= 3 && lo < 200 && hi >= lo * 4) tw[lo] += 1
  }
  let thickness = 8
  let bestW = 0
  for (let t = 3; t < 200; t++) {
    // Smooth a little: neighbouring widths are the same walls, anti-aliased.
    const w = tw[t - 1] * 0.5 + tw[t] + (tw[t + 1] ?? 0) * 0.5
    if (w > bestW) {
      bestW = w
      thickness = t
    }
  }
  // Inside walls are often drawn thinner than outside walls: anything from a third of the typical
  // wall up counts (thin lines, text and furniture outlines stay below that).
  const minStroke = Math.max(4, Math.round(thickness * 0.33))
  const minLen = thickness * 2.2

  const wall = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) wall[i] = dark[i] && Math.min(hRun[i], vRun[i]) >= minStroke ? 1 : 0

  /** Bands of long runs along one axis: rows (horizontal walls) or columns (vertical walls). */
  const bands = (horizontal: boolean) => {
    const outer = horizontal ? H : W
    const inner = horizontal ? W : H
    const at = (o: number, i: number) => (horizontal ? wall[o * W + i] : wall[i * W + o])
    type Band = { i0: number; i1: number; o0: number; o1: number; seen: number }
    const open: Band[] = []
    const done: Band[] = []
    for (let o = 0; o < outer; o++) {
      const runs: [number, number][] = []
      let i = 0
      while (i < inner) {
        if (!at(o, i)) {
          i++
          continue
        }
        let e = i
        while (e < inner && at(o, e)) e++
        if (e - i >= minLen) runs.push([i, e - 1])
        i = e
      }
      for (const b of open) b.seen = 0
      for (const [r0, r1] of runs) {
        const b = open.find((x) => r0 < x.i1 && r1 > x.i0 && Math.abs(r0 - x.i0) < thickness * 1.5 && Math.abs(r1 - x.i1) < thickness * 1.5)
        if (b) {
          b.i0 = Math.min(b.i0, r0)
          b.i1 = Math.max(b.i1, r1)
          b.o1 = o
          b.seen = 1
        } else open.push({ i0: r0, i1: r1, o0: o, o1: o, seen: 1 })
      }
      for (let k = open.length - 1; k >= 0; k--) if (!open[k].seen) done.push(...open.splice(k, 1))
    }
    done.push(...open)
    return done.filter((b) => {
      const t = b.o1 - b.o0 + 1
      return t >= Math.max(4, thickness * 0.3) && t <= thickness * 3 && b.i1 - b.i0 >= minLen
    })
  }

  const walls: PxWall[] = [
    ...bands(true).map((b) => ({ a: [b.i0, (b.o0 + b.o1 + 1) / 2] as Vec2, b: [b.i1 + 1, (b.o0 + b.o1 + 1) / 2] as Vec2, t: b.o1 - b.o0 + 1, horizontal: true })),
    ...bands(false).map((b) => ({ a: [(b.o0 + b.o1 + 1) / 2, b.i0] as Vec2, b: [(b.o0 + b.o1 + 1) / 2, b.i1 + 1] as Vec2, t: b.o1 - b.o0 + 1, horizontal: false })),
  ]

  // Corners and T-joints: an end reaching into a crossing wall stops on that wall's centre line.
  const tol = thickness * 0.9
  for (const w of walls) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end]
      for (const o of walls) {
        if (o === w || o.horizontal === w.horizontal) continue
        if (w.horizontal) {
          const x = o.a[0]
          if (p[1] >= o.a[1] - tol && p[1] <= o.b[1] + tol && Math.abs(p[0] - x) <= o.t / 2 + tol) w[end] = [x, p[1]]
        } else {
          const y = o.a[1]
          if (p[0] >= o.a[0] - tol && p[0] <= o.b[0] + tol && Math.abs(p[1] - y) <= o.t / 2 + tol) w[end] = [p[0], y]
        }
      }
    }
  }
  return { width: W, height: H, walls, thickness }
}

/**
 * Detected walls → plan walls and openings at `metresPerPx`, centred on the origin. Walls in line
 * with a gap between them (0.5–3 m) are joined and the gap becomes an opening: a window on an
 * outside wall, a door inside.
 */
export function toPlan(det: Detection, metresPerPx: number, levelId: string, uid: () => string): { walls: Wall[]; openings: Opening[]; offset: Vec2 } {
  const k = metresPerPx
  const xs = det.walls.flatMap((w) => [w.a[0], w.b[0]])
  const ys = det.walls.flatMap((w) => [w.a[1], w.b[1]])
  const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : det.width / 2
  const cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : det.height / 2
  const r = (v: number) => Math.round(v * 100) / 100
  const P = (p: Vec2): Vec2 => [r((p[0] - cx) * k), r((p[1] - cy) * k)]
  type Seg = { a: Vec2; b: Vec2; t: number; horizontal: boolean }
  let segs: Seg[] = det.walls.map((w) => ({ a: P(w.a), b: P(w.b), t: Math.max(0.08, Math.min(0.5, r(w.t * k))), horizontal: w.horizontal })).filter((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) >= 0.2)

  const minX = Math.min(...segs.flatMap((s) => [s.a[0], s.b[0]]))
  const maxX = Math.max(...segs.flatMap((s) => [s.a[0], s.b[0]]))
  const minY = Math.min(...segs.flatMap((s) => [s.a[1], s.b[1]]))
  const maxY = Math.max(...segs.flatMap((s) => [s.a[1], s.b[1]]))
  const gaps: { line: number; horizontal: boolean; from: number; to: number; exterior: boolean }[] = []

  // Join collinear walls across gaps (doors and windows drawn as thin lines in the wall).
  for (const horizontal of [true, false]) {
    const ax = horizontal ? 0 : 1
    const line = (s: Seg) => s.a[1 - ax]
    const group = segs.filter((s) => s.horizontal === horizontal).sort((p, q) => line(p) - line(q) || p.a[ax] - q.a[ax])
    const rest = segs.filter((s) => s.horizontal !== horizontal)
    const out: Seg[] = []
    for (const s of group) {
      const lo = Math.min(s.a[ax], s.b[ax])
      const hi = Math.max(s.a[ax], s.b[ax])
      const prev = out.find((o) => Math.abs(line(o) - line(s)) < Math.max(o.t, s.t) / 2 && Math.max(o.a[ax], o.b[ax]) <= lo + 0.05 && lo - Math.max(o.a[ax], o.b[ax]) <= 3)
      if (prev) {
        const end = Math.max(prev.a[ax], prev.b[ax])
        if (lo - end >= 0.45) {
          const l = line(prev)
          gaps.push({ line: l, horizontal, from: end, to: lo, exterior: horizontal ? Math.abs(l - minY) < 0.3 || Math.abs(l - maxY) < 0.3 : Math.abs(l - minX) < 0.3 || Math.abs(l - maxX) < 0.3 })
        }
        const b: Vec2 = horizontal ? [hi, line(prev)] : [line(prev), hi]
        prev.b = b
        prev.a = horizontal ? [Math.min(prev.a[0], lo), line(prev)] : [line(prev), Math.min(prev.a[1], lo)]
        prev.t = Math.max(prev.t, s.t)
      } else out.push({ ...s, a: horizontal ? [lo, line(s)] : [line(s), lo], b: horizontal ? [hi, line(s)] : [line(s), hi] })
    }
    segs = [...rest, ...out]
  }

  const walls: Wall[] = segs.map((s) => ({ id: uid(), levelId, a: s.a, b: s.b, thickness: s.t }))
  const openings: Opening[] = []
  for (const g of gaps) {
    const mid = (g.from + g.to) / 2
    const width = r(g.to - g.from)
    const p: Vec2 = g.horizontal ? [mid, g.line] : [g.line, mid]
    const w = walls.find((x) => {
      const horizontal = Math.abs(x.a[1] - x.b[1]) < 1e-6
      if (horizontal !== g.horizontal) return false
      return g.horizontal ? Math.abs(x.a[1] - p[1]) < 1e-3 && p[0] > Math.min(x.a[0], x.b[0]) && p[0] < Math.max(x.a[0], x.b[0]) : Math.abs(x.a[0] - p[0]) < 1e-3 && p[1] > Math.min(x.a[1], x.b[1]) && p[1] < Math.max(x.a[1], x.b[1])
    })
    if (!w) continue
    const t = g.horizontal ? Math.abs(p[0] - w.a[0]) : Math.abs(p[1] - w.a[1])
    const kind = g.exterior ? (width > 2.6 ? 'floor-window' : 'window') : width > 1.3 ? 'archway' : 'door'
    const tall = kind === 'door' || kind === 'archway' || kind === 'floor-window'
    openings.push({ id: uid(), wallId: w.id, kind, t, width, height: kind === 'window' ? 1.3 : kind === 'floor-window' ? 2.2 : 2.1, sill: tall ? 0 : 0.9, hinge: 'a', side: 'left', open: 0, frame: { color: '#f4f2ee' } })
  }
  return { walls, openings, offset: [-cx * k, -cy * k] }
}
