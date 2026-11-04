/**
 * Part masks in the browser: one byte per pixel (1 = part), same size as the prepared photo.
 * Stored and sent as PNG: white opaque = part, transparent = not part.
 */

export interface MaskData {
  width: number
  height: number
  data: Uint8Array
}

/** Distinct, readable on dark UI and on photos. */
export const PART_COLORS = ['#4c8dff', '#f5a524', '#46a758', '#e5484d', '#8e4ec6', '#12a594', '#e93d82', '#ffc53d', '#3e63dd', '#ad7f58', '#7ce2fe', '#a1e15b']

export const partColor = (i: number) => PART_COLORS[i % PART_COLORS.length]

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export async function decodeMask(png: Blob): Promise<MaskData> {
  const bmp = await createImageBitmap(png, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  try {
    const c = canvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bmp, 0, 0)
    const rgba = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const data = new Uint8Array(bmp.width * bmp.height)
    for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = rgba[j] > 127 && rgba[j + 3] > 127 ? 1 : 0
    return { width: bmp.width, height: bmp.height, data }
  } finally {
    bmp.close()
  }
}

export function base64ToBlob(b64: string, type = 'image/png'): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export async function encodeMask(m: MaskData): Promise<Blob> {
  const c = canvas(m.width, m.height)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(m.width, m.height)
  for (let i = 0, j = 0; i < m.data.length; i++, j += 4) {
    if (!m.data[i]) continue
    img.data[j] = img.data[j + 1] = img.data[j + 2] = img.data[j + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode mask'))), 'image/png'))
}

export function area(m: MaskData) {
  let n = 0
  for (let i = 0; i < m.data.length; i++) n += m.data[i]
  return n
}

export function bounds(m: MaskData): [number, number, number, number] {
  let x0 = m.width
  let y0 = m.height
  let x1 = 0
  let y1 = 0
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++)
      if (m.data[y * m.width + x]) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x + 1 > x1) x1 = x + 1
        if (y + 1 > y1) y1 = y + 1
      }
  return x1 > x0 ? [x0, y0, x1, y1] : [0, 0, 0, 0]
}

/** a − b */
export function subtract(a: MaskData, b: MaskData): MaskData {
  same(a, b)
  const data = new Uint8Array(a.data.length)
  for (let i = 0; i < data.length; i++) data[i] = a.data[i] && !b.data[i] ? 1 : 0
  return { width: a.width, height: a.height, data }
}

/** a ∪ b */
export function union(a: MaskData, b: MaskData): MaskData {
  same(a, b)
  const data = new Uint8Array(a.data.length)
  for (let i = 0; i < data.length; i++) data[i] = a.data[i] || b.data[i] ? 1 : 0
  return { width: a.width, height: a.height, data }
}

function same(a: MaskData, b: MaskData) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('Masks are different sizes.')
}

/** The mask as a coloured, translucent layer (for drawing over the photo). */
export function overlay(m: MaskData, color: string, alpha = 0.5): HTMLCanvasElement {
  const c = canvas(m.width, m.height)
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(m.width, m.height)
  const n = parseInt(color.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const a = Math.round(alpha * 255)
  const w = m.width
  for (let i = 0, j = 0; i < m.data.length; i++, j += 4) {
    if (!m.data[i]) continue
    // Edge pixels opaque: crisp outline so you can judge the boundary exactly.
    const x = i % w
    const edge = x === 0 || x === w - 1 || !m.data[i - 1] || !m.data[i + 1] || !m.data[i - w] || !m.data[i + w]
    img.data[j] = r
    img.data[j + 1] = g
    img.data[j + 2] = b
    img.data[j + 3] = edge ? 255 : a
  }
  ctx.putImageData(img, 0, 0)
  return c
}
