// Ceiling boards drawn at real size: perforated acoustic boards (a perforated field inside a plain
// border), fully perforated tiles, wood-wool panels (a felt of fine wood strands, laid staggered
// with V-joints) and wooden slats on black felt. Each gives a colour map and a normal map (joints,
// holes, strands as relief), one repeat of the pattern per texture.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import type { CeilingSpec } from './materialPresets'

const PX_PER_M = 1700
const cache = new Map<string, { map: Texture; normal: Texture }>()

function rand(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/** Colour and height canvases of one repeat. */
function draw(spec: CeilingSpec, scale = 1) {
  // Wood wool is fine-grained noise: a coarser map looks the same and draws in a third of the time.
  const k = PX_PER_M * scale * (spec.kind === 'wood-wool' ? 0.6 : spec.kind === 'perforated' ? 0.8 : 1)
  const W = Math.round(spec.tile[0] * k)
  const H = Math.round(spec.tile[1] * k)
  const color = document.createElement('canvas')
  color.width = W
  color.height = H
  const height = document.createElement('canvas')
  height.width = W
  height.height = H
  const c = color.getContext('2d')!
  const h = height.getContext('2d')!
  const mm = (v: number) => (v / 1000) * k
  const both = (fn: (g: CanvasRenderingContext2D, isH: boolean) => void) => {
    fn(c, false)
    fn(h, true)
  }
  const R = rand(7)

  if (spec.kind === 'perforated' || spec.kind === 'perforated-tiles') {
    const tiles = spec.kind === 'perforated-tiles'
    // Board: plain border, perforated field (holes 8 mm at 18 mm, or 6 mm at 13 mm on tiles).
    both((g, isH) => {
      g.fillStyle = isH ? '#fff' : '#f2f1ee'
      g.fillRect(0, 0, W, H)
    })
    const border = tiles ? mm(12) : mm(96)
    const pitch = tiles ? mm(13) : mm(18)
    const r = tiles ? mm(3) : mm(4)
    const nx = Math.floor((W - 2 * border) / pitch)
    const ny = Math.floor((H - 2 * border) / pitch)
    const x0 = (W - (nx - 1) * pitch) / 2
    const y0 = (H - (ny - 1) * pitch) / 2
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const x = x0 + ix * pitch
        const y = y0 + iy * pitch
        c.fillStyle = '#5c5c5a'
        c.beginPath()
        c.arc(x, y, r, 0, Math.PI * 2)
        c.fill()
        h.fillStyle = '#000'
        h.beginPath()
        h.arc(x, y, r, 0, Math.PI * 2)
        h.fill()
      }
    // Joint between boards: a fine shadow line all round (half on each edge, so repeats meet).
    const j = tiles ? Math.max(1.5, mm(2)) : Math.max(1.5, mm(3))
    both((g, isH) => {
      g.fillStyle = isH ? '#3a3a3a' : '#c9c7c2'
      g.fillRect(0, 0, W, j / 2)
      g.fillRect(0, H - j / 2, W, j / 2)
      g.fillRect(0, 0, j / 2, H)
      g.fillRect(W - j / 2, 0, j / 2, H)
    })
  } else if (spec.kind === 'wood-wool') {
    // Base: the shadowy gaps between strands.
    c.fillStyle = '#9b9890'
    c.fillRect(0, 0, W, H)
    h.fillStyle = '#404040'
    h.fillRect(0, 0, W, H)
    // Strands: short, slightly bent, crossing every way, a few layers deep.
    const n = Math.round(((W * H) / (mm(30) * mm(2.5))) * 1.2)
    for (let i = 0; i < n; i++) {
      const layer = i / n
      const x = R() * W
      const y = R() * H
      const a = R() * Math.PI
      const L = mm(18 + R() * 40)
      const bend = (R() - 0.5) * 0.8
      const w = mm(1.6 + R() * 1.6)
      const tone = 0.72 + 0.28 * layer + (R() - 0.5) * 0.18
      const v = Math.round(Math.max(0, Math.min(1, tone)) * 255)
      const hv = Math.round((0.35 + 0.65 * layer) * 255)
      for (const [g, col] of [
        [c, `rgb(${v},${Math.round(v * 0.985)},${Math.round(v * 0.96)})`],
        [h, `rgb(${hv},${hv},${hv})`],
      ] as const) {
        g.strokeStyle = col
        g.lineWidth = w
        g.lineCap = 'round'
        // Wrap round the edges so the texture tiles.
        for (const ox of [0, -W, W])
          for (const oy of [0, -H, H]) {
            const sx = x + ox
            const sy = y + oy
            if (sx < -L || sx > W + L || sy < -L || sy > H + L) continue
            g.beginPath()
            g.moveTo(sx - (Math.cos(a) * L) / 2, sy - (Math.sin(a) * L) / 2)
            g.quadraticCurveTo(sx + Math.cos(a + Math.PI / 2) * bend * L * 0.3, sy + Math.sin(a + Math.PI / 2) * bend * L * 0.3, sx + (Math.cos(a) * L) / 2, sy + (Math.sin(a) * L) / 2)
            g.stroke()
          }
      }
    }
    // Panels 600 × 1200, staggered half a length, with V-joints.
    const vj = mm(4)
    const vjoint = (x0: number, y0: number, x1: number, y1: number) => {
      for (const [g, col] of [
        [c, 'rgba(70,68,64,0.75)'],
        [h, '#000'],
      ] as const) {
        g.strokeStyle = col
        g.lineWidth = vj
        g.beginPath()
        g.moveTo(x0, y0)
        g.lineTo(x1, y1)
        g.stroke()
      }
    }
    const pw = W / 2
    for (const x of [0, pw, W]) vjoint(x, 0, x, H)
    vjoint(0, 0, pw, 0)
    vjoint(0, H, pw, H)
    vjoint(pw, H / 2, W, H / 2)
  } else {
    // Slats: 27 mm wood slats, 17 mm apart, on black felt.
    c.fillStyle = '#141414'
    c.fillRect(0, 0, W, H)
    h.fillStyle = '#000'
    h.fillRect(0, 0, W, H)
    const step = mm(44)
    const sw = mm(27)
    for (let x = step / 2; x < W; x += step) {
      const tone = 0.9 + (R() - 0.5) * 0.12
      const g = c.createLinearGradient(x - sw / 2, 0, x + sw / 2, 0)
      g.addColorStop(0, `rgb(${Math.round(200 * tone)},${Math.round(196 * tone)},${Math.round(188 * tone)})`)
      g.addColorStop(0.5, `rgb(${Math.round(240 * tone)},${Math.round(236 * tone)},${Math.round(228 * tone)})`)
      g.addColorStop(1, `rgb(${Math.round(205 * tone)},${Math.round(200 * tone)},${Math.round(192 * tone)})`)
      c.fillStyle = g
      c.fillRect(x - sw / 2, 0, sw, H)
      // Grain along the slat.
      for (let i = 0; i < 14; i++) {
        c.strokeStyle = `rgba(120,96,70,${0.05 + R() * 0.08})`
        c.lineWidth = 1 + R() * 2
        const gx = x - sw / 2 + R() * sw
        c.beginPath()
        c.moveTo(gx, 0)
        c.bezierCurveTo(gx + (R() - 0.5) * 6, H / 3, gx + (R() - 0.5) * 6, (2 * H) / 3, gx, H)
        c.stroke()
      }
      const hg = h.createLinearGradient(x - sw / 2, 0, x + sw / 2, 0)
      hg.addColorStop(0, '#bbb')
      hg.addColorStop(0.15, '#fff')
      hg.addColorStop(0.85, '#fff')
      hg.addColorStop(1, '#bbb')
      h.fillStyle = hg
      h.fillRect(x - sw / 2, 0, sw, H)
    }
  }
  return { color, height }
}

/** Height → tangent-space normal map (Sobel). */
function normalFrom(height: HTMLCanvasElement, strength: number) {
  const W = height.width
  const H = height.height
  const src = height.getContext('2d')!.getImageData(0, 0, W, H).data
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const at = (x: number, y: number) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const l = Math.hypot(dx, dy, 1)
      const i = (y * W + x) * 4
      img.data[i] = (-dx / l) * 127.5 + 127.5
      img.data[i + 1] = (dy / l) * 127.5 + 127.5
      img.data[i + 2] = (1 / l) * 127.5 + 127.5
      img.data[i + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  return out
}

/** The colour and normal maps of a ceiling (cached). `scale` < 1 for small previews. */
export function ceilingTextures(id: string, spec: CeilingSpec, scale = 1) {
  const key = `${id}:${scale}`
  let hit = cache.get(key)
  if (hit) return hit
  const { color, height } = draw(spec, scale)
  const map = new CanvasTexture(color)
  map.colorSpace = SRGBColorSpace
  const normal = new CanvasTexture(normalFrom(height, spec.kind === 'wood-wool' ? 1.6 : spec.kind === 'slats' ? 3 : 2.2))
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = RepeatWrapping
    t.anisotropy = 8
  }
  hit = { map, normal }
  cache.set(key, hit)
  return hit
}

/** A flat look at one repeat, for the menus. */
export function ceilingPreview(spec: CeilingSpec, size = 256) {
  const { color } = draw(spec, Math.min(1, (size * 1.5) / (Math.max(...spec.tile) * PX_PER_M)))
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  // About 1.2 m of ceiling.
  const part = Math.min(1, 1.2 / Math.max(...spec.tile))
  g.drawImage(color, 0, 0, color.width * part, color.height * part, 0, 0, size, size)
  return c.toDataURL('image/jpeg', 0.88)
}
