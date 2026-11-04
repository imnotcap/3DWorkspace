import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import type { DetailTexture } from './materialPresets'

/**
 * Procedural greyscale detail maps (wood grain, marble veins, …), generated once and cached.
 * They are mostly light so the material colour sets the tone; GLB export embeds them.
 */
const cache = new Map<DetailTexture, CanvasTexture>()
const SIZE = 512

// Small deterministic value noise, so textures look the same every time.
function makeNoise(seed: number) {
  const perm = new Uint8Array(512)
  let s = seed
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const p = Array.from({ length: 256 }, (_, i) => i).sort(() => rand() - 0.5)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const grad = (h: number, x: number, y: number) => ((h & 1 ? -x : x) + (h & 2 ? -y : y))
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  return (x: number, y: number) => {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    x -= Math.floor(x)
    y -= Math.floor(y)
    const u = fade(x)
    const v = fade(y)
    const a = perm[X] + Y
    const b = perm[X + 1] + Y
    const l1 = grad(perm[a], x, y) + u * (grad(perm[b], x - 1, y) - grad(perm[a], x, y))
    const l2 = grad(perm[a + 1], x, y - 1) + u * (grad(perm[b + 1], x - 1, y - 1) - grad(perm[a + 1], x, y - 1))
    return (l1 + v * (l2 - l1)) * 0.5 + 0.5
  }
}

function fbm(n: (x: number, y: number) => number, x: number, y: number, oct = 4) {
  let v = 0
  let a = 0.5
  for (let i = 0; i < oct; i++, a *= 0.5, x *= 2, y *= 2) v += a * n(x, y)
  return v
}

function paint(kind: DetailTexture): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(SIZE, SIZE)
  const n = makeNoise(kind.length * 977 + 13)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE
      const v = y / SIZE
      let g: number
      switch (kind) {
        case 'oak':
        case 'walnut':
        case 'birch': {
          // Long grain along U with growth rings warped by noise.
          const warp = fbm(n, u * 3, v * 14, 3)
          const rings = Math.sin((v * (kind === 'birch' ? 40 : 26) + warp * 6) * Math.PI)
          const fine = fbm(n, u * 60, v * 4, 2)
          g = 0.78 + 0.12 * rings + 0.1 * (fine - 0.5)
          if (kind === 'walnut') g = 0.7 + (g - 0.78) * 1.4
          break
        }
        case 'marble': {
          const t = fbm(n, u * 4, v * 4, 5)
          const vein = Math.abs(Math.sin((u * 3 + v * 2 + t * 4) * Math.PI))
          g = 0.92 - 0.35 * Math.pow(1 - vein, 6)
          break
        }
        case 'concrete':
          g = 0.82 + 0.16 * (fbm(n, u * 24, v * 24, 5) - 0.5) - (n(u * 180, v * 180) > 0.86 ? 0.18 : 0)
          break
        case 'brushed':
          g = 0.86 + 0.14 * (fbm(n, u * 2, v * 260, 2) - 0.5)
          break
        case 'leather': {
          const cell = n(u * 90, v * 90)
          g = 0.8 + 0.18 * (cell - 0.5) + 0.06 * (fbm(n, u * 8, v * 8, 3) - 0.5)
          break
        }
        case 'fabric':
          g = 0.82 + 0.08 * Math.sin(u * SIZE * 0.9) * Math.sin(v * SIZE * 0.9) + 0.1 * (fbm(n, u * 40, v * 40, 2) - 0.5)
          break
        case 'powder':
          g = 0.9 + 0.08 * (n(u * 220, v * 220) - 0.5)
          break
      }
      const k = Math.max(0, Math.min(255, Math.round(g * 255)))
      const i = (y * SIZE + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export function detailTexture(kind: DetailTexture): CanvasTexture {
  let t = cache.get(kind)
  if (!t) {
    t = new CanvasTexture(paint(kind))
    t.colorSpace = SRGBColorSpace
    t.wrapS = t.wrapT = RepeatWrapping
    t.anisotropy = 8
    t.name = kind
    cache.set(kind, t)
  }
  return t
}
