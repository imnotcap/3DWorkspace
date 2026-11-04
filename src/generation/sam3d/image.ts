import type { InputImage } from '@/store/workspace'

/**
 * The exact pixels SAM sees. Masks are pixel-aligned with this image, so the browser and the
 * server must agree on it to the pixel: EXIF rotation is applied here (as browsers display
 * photos), the long side is capped, and it is sent as lossless PNG.
 */
export const MAX_SIDE = 2048

export interface PreparedPhoto {
  file: File
  url: string
  width: number
  height: number
}

const cache = new Map<string, Promise<PreparedPhoto>>()

export function preparePhoto(img: Pick<InputImage, 'id' | 'file'>): Promise<PreparedPhoto> {
  let p = cache.get(img.id)
  if (!p) {
    p = prepare(img.file)
    cache.set(img.id, p)
    p.catch(() => cache.delete(img.id))
  }
  return p
}

async function prepare(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * k))
    const height = Math.max(1, Math.round(bitmap.height * k))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the photo.'))), 'image/png'))
    const out = new File([blob], 'photo.png', { type: 'image/png' })
    return { file: out, url: URL.createObjectURL(out), width, height }
  } finally {
    bitmap.close()
  }
}
