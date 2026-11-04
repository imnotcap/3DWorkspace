// Wood floors, drawn board by board: planks, strip parquet, herringbone, chevron… (three.js-free:
// plain canvases, so the panels can show previews without loading the 3D code).

export type FloorPattern = 'plank' | 'strip' | 'herringbone' | 'dutch-herringbone' | 'chevron'

export interface FloorSpec {
  pattern: FloorPattern
  /** Board (or block) width and length, metres. */
  w: number
  L: number
  /** Planks: lengths vary from L × (1 − vary) to L × (1 + vary). */
  vary?: number
  /** Planks: widths in a row pattern (manor planks mix widths); default [w]. */
  widths?: number[]
  /** Strip parquet: strips per board (2- or 3-strip). */
  strips?: number
  /** Chevron: cut angle in degrees (45 = classic chevron, 30 = steeper). */
  angle?: number
  /** Wood tone: base colour and how much boards differ (0–1). */
  base: string
  vary_tone: number
  /** Grain contrast and colour of the grain lines. */
  grain: number
  grainColor: string
  /** Knots per square metre (rustic floors). */
  knots?: number
  /** Width of the joints in mm (V-groove on planks). */
  joint: number
  /** Brushed surfaces: more visible grain relief. */
  brushed?: boolean
  /** Which photographed wood the boards are cut from (default oak). */
  species?: Species
}

export type Species = 'oak' | 'dark' | 'pine' | 'ash'

/** A wood photo, turned so its grain runs along x, with its scale and average colour. */
interface WoodPhoto {
  img: HTMLCanvasElement
  /** Pixels per metre. */
  ppm: number
  avg: [number, number, number]
}

let wood: Record<string, WoodPhoto> | null = null
let woodLoad: Promise<Record<string, WoodPhoto>> | null = null

/** Whether the photographed wood has loaded (floors drawn before that use drawn grain). */
export const woodReady = () => !!wood && Object.keys(wood).length > 0

/** Load the CC0 wood photos fetched at build time (public/textures/wood). Empty when there are none. */
export function loadWood(): Promise<Record<string, WoodPhoto>> {
  woodLoad ??= (async () => {
    const base = `${import.meta.env.BASE_URL}textures/wood/`
    const out: Record<string, WoodPhoto> = {}
    try {
      const res = await fetch(`${base}manifest.json`)
      if (!res.ok) return (wood = out)
      const manifest = (await res.json()) as Record<string, { size_m: [number, number]; maps: { color: string } }>
      await Promise.all(
        Object.entries(manifest).map(async ([species, e]) => {
          const img = new Image()
          img.src = base + e.maps.color
          await img.decode()
          out[species] = orient(img, e.size_m)
        }),
      )
    } catch {
      /* no photos: drawn grain */
    }
    return (wood = out)
  })()
  return woodLoad
}

/** Turn the photo so the grain runs along x (it varies most across the grain), and measure it. */
function orient(img: HTMLImageElement, size: [number, number]): WoodPhoto {
  const s = document.createElement('canvas')
  s.width = s.height = 128
  const sg = s.getContext('2d')!
  sg.drawImage(img, 0, 0, 128, 128)
  const d = sg.getImageData(0, 0, 128, 128).data
  const L = (x: number, y: number) => d[(y * 128 + x) * 4] + d[(y * 128 + x) * 4 + 1] + d[(y * 128 + x) * 4 + 2]
  let gx = 0
  let gy = 0
  const avg: [number, number, number] = [0, 0, 0]
  for (let y = 0; y < 127; y++)
    for (let x = 0; x < 127; x++) {
      gx += Math.abs(L(x + 1, y) - L(x, y))
      gy += Math.abs(L(x, y + 1) - L(x, y))
      const i = (y * 128 + x) * 4
      avg[0] += d[i]
      avg[1] += d[i + 1]
      avg[2] += d[i + 2]
    }
  const n = 127 * 127
  avg[0] /= n
  avg[1] /= n
  avg[2] /= n
  const turn = gx > gy // changes faster along x: the grain runs along y, so turn it
  const c = document.createElement('canvas')
  c.width = turn ? img.height : img.width
  c.height = turn ? img.width : img.height
  const g = c.getContext('2d')!
  if (turn) {
    g.translate(c.width, 0)
    g.rotate(Math.PI / 2)
  }
  g.drawImage(img, 0, 0)
  const metresAlong = turn ? size[1] : size[0]
  return { img: c, ppm: c.width / Math.max(0.2, metresAlong), avg }
}

export interface FloorCanvases {
  color: HTMLCanvasElement
  height: HTMLCanvasElement
  /** Metres covered by the canvas along x and y (the texture repeats every tileX × tileY). */
  tileX: number
  tileY: number
}


function rng(seed: number) {
  let s = seed % 2147483647 || 1
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

function shade(hex: string, k: number, warm = 0) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.max(0, Math.min(255, Math.round(v * k + (i === 0 ? warm : i === 2 ? -warm : 0)))))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

type Board = { cx: number; cy: number; len: number; wid: number; rot: number; seed: number; shape?: [number, number][] }

/** Board positions for one tile (in metres), plus the tile's size. */
function layout(f: FloorSpec): { boards: Board[]; tileX: number; tileY: number } {
  const boards: Board[] = []
  const rand = rng(Math.round(f.w * 1e4 + f.L * 1e3) + (f.strips ?? 0) * 7 + f.pattern.length)
  if (f.pattern === 'plank' || f.pattern === 'strip') {
    const widths = f.widths ?? [f.w]
    const tileY = widths.reduce((a, b) => a + b, 0) * Math.max(1, Math.round(1.2 / widths.reduce((a, b) => a + b, 0)))
    const tileX = Math.max(f.L * 2, 2.4)
    let y = 0
    let row = 0
    while (y < tileY - 1e-6) {
      const wid = widths[row % widths.length]
      const strips = f.pattern === 'strip' ? (f.strips ?? 3) : 1
      const sw = wid / strips
      for (let k = 0; k < strips; k++) {
        // Each row (or strip) is a run of boards of varying length, wrapping round the tile.
        let x = rand() * tileX
        const start = x
        while (x < start + tileX - 1e-6) {
          const len = f.pattern === 'strip' ? f.L * (0.45 + rand() * 0.8) : f.L * (1 - (f.vary ?? 0.3) + rand() * 2 * (f.vary ?? 0.3))
          const l = Math.min(len, start + tileX - x)
          boards.push({ cx: (x + l / 2) % tileX, cy: y + sw * (k + 0.5), len: l, wid: sw, rot: 0, seed: Math.floor(rand() * 1e9) })
          x += l
        }
      }
      y += wid
      row++
    }
    return { boards, tileX, tileY }
  }
  if (f.pattern === 'herringbone' || f.pattern === 'dutch-herringbone') {
    // Blocks w × L (L a multiple of w). Chains of horizontal + vertical blocks step by (w, w); chains
    // repeat every (L, −L). The pattern repeats every 2L both ways.
    const w = f.w
    const L = Math.round(f.L / w) * w
    const P = 2 * L
    const span = Math.ceil((P * 2) / w) + 4
    for (let m = -3; m <= 3; m++)
      for (let k = -span; k <= span; k++) {
        const hx = k * w + m * L
        const hy = k * w - m * L
        // Seeded by where the block sits in the tile, so the same block always looks the same (seamless).
        const seedOf = (x: number, y: number, t: number) => (Math.round((((x % P) + P) % P) * 997) * 7919 + Math.round((((y % P) + P) % P) * 991) * 104729 + t) % 2147483646
        boards.push({ cx: hx + L / 2, cy: hy + w / 2, len: L, wid: w, rot: 0, seed: seedOf(hx + L / 2, hy + w / 2, 1) })
        boards.push({ cx: hx + L + w / 2, cy: hy + w - L / 2, len: L, wid: w, rot: Math.PI / 2, seed: seedOf(hx + L + w / 2, hy + w - L / 2, 2) })
      }
    return { boards, tileX: P, tileY: P }
  }
  // Chevron: boards cut at an angle meet in a straight line, in columns that mirror.
  const a = ((f.angle ?? 45) * Math.PI) / 180
  const run = f.L * Math.cos(a) // the board's extent across its half column
  const h = f.w / Math.cos(a) // vertical extent of one board's width
  const n = Math.max(2, Math.round(1.2 / h))
  const tileY = n * h
  const tileX = run * 2 * Math.max(1, Math.round(1.2 / (run * 2)))
  const rise = run * Math.tan(a)
  for (let c = 0; c * run * 2 < tileX - 1e-6; c++) {
    const xc = c * run * 2 + run
    for (let j = -2; j < n + 2; j++) {
      const y0 = j * h
      for (const side of [-1, 1]) {
        const shape: [number, number][] = [
          [xc, y0],
          [xc + side * run, y0 + rise],
          [xc + side * run, y0 + rise + h],
          [xc, y0 + h],
        ]
        boards.push({ cx: xc + (side * run) / 2, cy: y0 + rise / 2 + h / 2, len: f.L, wid: f.w, rot: side > 0 ? a : Math.PI - a, seed: ((c * 131 + (((j % n) + n) % n) * 17 + (side + 1)) * 2654435761) % 1e9, shape })
      }
    }
  }
  return { boards, tileX, tileY }
}

/** Draw the floor (colour or height) into a canvas that tiles seamlessly. */
function paint(f: FloorSpec, kind: 'color' | 'height', ppm: number) {
  const { boards, tileX, tileY } = layout(f)
  const c = document.createElement('canvas')
  const photo = kind === 'color' ? (wood?.[f.species ?? 'oak'] ?? wood?.oak ?? null) : null
  c.width = Math.round(tileX * ppm)
  c.height = Math.round(tileY * ppm)
  const g = c.getContext('2d')!
  g.fillStyle = kind === 'color' ? shade(f.base, 0.55) : '#000'
  g.fillRect(0, 0, c.width, c.height)
  const joint = Math.max(1, (f.joint / 1000) * ppm)
  for (const b of boards) {
    for (const ox of [-tileX, 0, tileX])
      for (const oy of [-tileY, 0, tileY]) {
        const cx = (b.cx + ox) * ppm
        const cy = (b.cy + oy) * ppm
        const r = Math.max(b.len, b.wid) * ppm
        if (cx + r < 0 || cy + r < 0 || cx - r > c.width || cy - r > c.height) continue
        g.save()
        // The board's outline, inset by half a joint.
        g.beginPath()
        if (b.shape) {
          // Angled boards (chevron): clip to the exact outline; the joint is stroked on after.
          const s = b.shape.map(([x, y]) => [(x + ox) * ppm, (y + oy) * ppm])
          s.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)))
          g.closePath()
          g.clip()
          g.translate(cx, cy)
          g.rotate(b.rot)
        } else {
          g.translate(cx, cy)
          g.rotate(b.rot)
          g.rect((-b.len * ppm) / 2 + joint / 2, (-b.wid * ppm) / 2 + joint / 2, b.len * ppm - joint, b.wid * ppm - joint)
          g.clip()
        }
        if (photo) photoBoard(g, f, b, ppm, photo)
        else board(g, f, b, ppm, kind)
        g.restore()
        if (b.shape) {
          g.beginPath()
          b.shape.forEach(([x, y], i) => (i === 0 ? g.moveTo((x + ox) * ppm, (y + oy) * ppm) : g.lineTo((x + ox) * ppm, (y + oy) * ppm)))
          g.closePath()
          g.strokeStyle = kind === 'color' ? shade(f.base, 0.5) : '#000'
          g.lineWidth = joint
          g.stroke()
        }
      }
  }
  if (photo) tint(c, f.base, photo.avg)
  return c
}

/** One board cut from the wood photo: a random stretch of it, sometimes flipped, its own tone. */
function photoBoard(g: CanvasRenderingContext2D, f: FloorSpec, b: Board, ppm: number, photo: WoodPhoto) {
  const r = rng(b.seed + 7)
  // A little more than the board, so angled ends (chevron) are covered too; the clip trims it.
  const over = b.shape ? 2 : 1.05
  const len = (b.len + (b.shape ? b.wid * 2 : 0)) * ppm
  const wid = b.wid * over * ppm
  const sw = Math.min(photo.img.width, (len / ppm) * photo.ppm)
  const sh = Math.min(photo.img.height, (wid / ppm) * photo.ppm)
  const tone = 1 + (r() - 0.5) * 2 * f.vary_tone
  g.filter = `brightness(${tone.toFixed(3)}) saturate(${(0.95 + r() * 0.1).toFixed(3)})`
  if (r() < 0.5) g.scale(-1, 1)
  if (r() < 0.5) g.scale(1, -1)
  // Boards longer than the photo are cut from it in several stretches.
  const pieces = Math.max(1, Math.ceil(((len / ppm) * photo.ppm) / photo.img.width))
  for (let k = 0; k < pieces; k++) {
    const sx = r() * Math.max(0, photo.img.width - sw)
    const sy = r() * Math.max(0, photo.img.height - sh)
    g.drawImage(photo.img, sx, sy, sw, sh, -len / 2 + (len / pieces) * k, -wid / 2, len / pieces + 1, wid)
  }
  g.filter = 'none'
  const knots = (f.knots ?? 0) * b.len * b.wid
  if (knots > 0) {
    g.globalAlpha = 0.6
    board(g, { ...f, grain: 0 }, { ...b, seed: b.seed + 3 }, ppm, 'color', true)
    g.globalAlpha = 1
  }
}

/** Shift the photo's colour to the floor's tone (natural, smoked, white-oiled…). */
function tint(c: HTMLCanvasElement, base: string, avg: [number, number, number]) {
  const n = parseInt(base.slice(1), 16)
  const k = [((n >> 16) & 255) / avg[0], ((n >> 8) & 255) / avg[1], (n & 255) / avg[2]]
  const g = c.getContext('2d')!
  const img = g.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, d[i] * k[0])
    d[i + 1] = Math.min(255, d[i + 1] * k[1])
    d[i + 2] = Math.min(255, d[i + 2] * k[2])
  }
  g.putImageData(img, 0, 0)
}

/** One board's wood: its own tone, long grain lines, the odd knot. Drawn in board space (x along it). */
function board(g: CanvasRenderingContext2D, f: FloorSpec, b: Board, ppm: number, kind: 'color' | 'height', knotsOnly = false) {
  const r = rng(b.seed + 1)
  if (knotsOnly) return knotsOf(g, f, b, ppm, kind, r)
  const L = (b.len + (b.shape ? b.wid * 2 : 0)) * ppm * 1.1
  const W = b.wid * ppm * (b.shape ? 2.2 : 1.6)
  if (kind === 'color') {
    const tone = 1 + (r() - 0.5) * 2 * f.vary_tone
    const grad = g.createLinearGradient(0, -W / 2, 0, W / 2)
    grad.addColorStop(0, shade(f.base, tone * (0.97 + r() * 0.04)))
    grad.addColorStop(0.5, shade(f.base, tone))
    grad.addColorStop(1, shade(f.base, tone * (0.96 + r() * 0.05)))
    g.fillStyle = grad
  } else g.fillStyle = `rgb(${200 + Math.round(r() * 30)},0,0)`
  g.fillRect(-L / 2, -W / 2, L, W)
  // The height map only needs the joints (and the relief of brushed wood).
  if (kind === 'height' && !f.brushed) return
  // Grain: long, slightly wavy lines along the board (fewer on small previews).
  const lines = Math.round((ppm > 300 ? 8 : 4) + r() * (ppm > 300 ? 10 : 4))
  const wid = b.wid * ppm
  for (let i = 0; i < lines; i++) {
    const y = (r() - 0.5) * wid
    const amp = (0.5 + r() * 2) * (wid / 40)
    const freq = 1 + r() * 3
    const ph = r() * 6.28
    g.beginPath()
    const step = Math.max(8, L / 24)
    for (let x = -L / 2; x <= L / 2; x += step) g.lineTo(x, y + Math.sin((x / L) * freq * 6.28 + ph) * amp)
    const a = (0.08 + r() * 0.18) * f.grain
    g.strokeStyle = kind === 'color' ? hexA(f.grainColor, a) : `rgba(0,0,0,${a * (f.brushed ? 2.2 : 0.8)})`
    g.lineWidth = 0.6 + r() * (f.brushed ? 1.8 : 1.2)
    g.stroke()
  }
  // Dutch herringbone: each block is two slats side by side.
  if (f.pattern === 'dutch-herringbone') {
    g.fillStyle = kind === 'color' ? shade(f.base, 0.55) : '#000'
    g.fillRect(-L / 2, -Math.max(1, (f.joint / 1000) * ppm) / 2, L, Math.max(1, (f.joint / 1000) * ppm))
  }
  knotsOf(g, f, b, ppm, kind, r)
}

function knotsOf(g: CanvasRenderingContext2D, f: FloorSpec, b: Board, ppm: number, kind: 'color' | 'height', r: () => number) {
  const wid = b.wid * ppm
  // Knots on rustic floors.
  const area = b.len * b.wid
  const knots = kind === 'height' ? 0 : (f.knots ?? 0) * area
  for (let i = 0; i < Math.floor(knots) + (r() < knots % 1 ? 1 : 0); i++) {
    const x = (r() - 0.5) * b.len * ppm * 0.9
    const y = (r() - 0.5) * wid * 0.6
    const rk = (0.006 + r() * 0.012) * ppm
    g.beginPath()
    g.ellipse(x, y, rk * 1.8, rk, 0, 0, Math.PI * 2)
    g.fillStyle = kind === 'color' ? hexA(f.grainColor, 0.75) : 'rgba(0,0,0,0.5)'
    g.fill()
    g.strokeStyle = kind === 'color' ? hexA(f.grainColor, 0.35) : 'rgba(0,0,0,0.25)'
    g.lineWidth = 1
    for (let k = 1; k < 4; k++) {
      g.beginPath()
      g.ellipse(x, y, rk * 1.8 + k * 2.5, rk + k * 1.8, 0, 0, Math.PI * 2)
      g.stroke()
    }
  }
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const cache = new Map<string, FloorCanvases>()

/**
 * The floor's colour and height canvases (cached per floor, size and whether the wood photos were
 * in). Full size: ~700 px per metre with photos (2K-class detail), at most 4096 px on a side.
 */
export function floorCanvases(id: string, f: FloorSpec, ppm?: number): FloorCanvases {
  const { tileX, tileY } = layout(f)
  const full = ppm === undefined
  const p = ppm ?? Math.min(woodReady() ? 700 : 420, 4096 / Math.max(tileX, tileY))
  const key = `${id}@${p.toFixed(1)}:${woodReady() ? 'photo' : 'drawn'}`
  let hit = cache.get(key)
  if (!hit) {
    hit = { color: paint(f, 'color', p), height: full ? paint(f, 'height', p) : (null as unknown as HTMLCanvasElement), tileX, tileY }
    cache.set(key, hit)
  }
  return hit
}

/** A small picture of the floor for galleries (about 1.2 m of it). */
export function floorPreview(id: string, f: FloorSpec, size = 240): string {
  const { color, tileX } = floorCanvases(id, f, size / 1.2)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  // Show ~1.2 m: tile the canvas as needed.
  const k = (size / 1.2) * (tileX / color.width)
  const w = color.width * k
  const h = color.height * k
  for (let x = 0; x < size; x += w) for (let y = 0; y < size; y += h) g.drawImage(color, x, y, w, h)
  return c.toDataURL('image/jpeg', 0.85)
}
