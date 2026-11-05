import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { presetById, type MaterialPreset } from '@/viewport/materialPresets'

/** A rendered preview of a material, made when its card scrolls into view (cached after). */
function Preview({ preset, shape }: { preset: MaterialPreset; shape: 'ball' | 'tile' }) {
  const [url, setUrl] = useState<string | null>(null)
  const [seen, setSeen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (!el || seen) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { rootMargin: '80px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  useEffect(() => {
    if (!seen) return
    let live = true
    void import('@/viewport/thumbnails')
      .then((m) => m.materialThumb(preset.id, shape))
      .then((u) => live && setUrl(u))
      .catch(() => {})
    return () => void (live = false)
  }, [seen, preset.id, shape])
  return (
    <div ref={box} className="relative aspect-square w-full overflow-hidden rounded-md" style={{ background: url ? '#1a1a1a' : `linear-gradient(160deg, color-mix(in srgb, ${preset.color} 75%, white), ${preset.color})` }}>
      {url && <img src={url} alt="" draggable={false} className={cn('size-full', preset.floor || shape === 'tile' ? 'object-cover' : 'object-contain p-1')} />}
    </div>
  )
}

/** Material cards: a real preview of each, its name under it, the chosen one ringed. */
export function MaterialGallery({ ids, value, onPick, shape = 'ball', columns = 3 }: { ids: string[]; value?: string; onPick: (p: MaterialPreset) => void; shape?: 'ball' | 'tile'; columns?: number }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {ids.map((id) => {
        const p = presetById(id)
        if (!p) return null
        const active = value === id
        return (
          <button key={id} type="button" title={p.name} onClick={() => onPick(p)} className={cn('group flex flex-col gap-1 rounded-lg border p-1 text-left transition-colors', active ? 'border-accent bg-accent-soft' : 'border-line-strong bg-app/40 hover:border-dim')}>
            <Preview preset={p} shape={shape} />
            <span className={cn('line-clamp-2 min-h-[2lh] px-0.5 text-[10px] leading-tight', active ? 'text-fg' : 'text-dim group-hover:text-fg')}>{p.name}</span>
          </button>
        )
      })}
    </div>
  )
}

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const srgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
const hexLin = (hex: string) => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255))

/** A flat piece of the material's colour map (about 1.2 m of it): photographed, or the drawn one. */
async function flatSample(preset: MaterialPreset): Promise<string | null> {
  if (preset.floor) return (await import('@/viewport/thumbnails')).materialThumb(preset.id, 'tile')
  if (preset.ceiling) {
    // Drawn neutral and tinted to the preset's own colour in 3D: the same here.
    return (await import('@/viewport/ceilingTextures')).ceilingPreview(preset.ceiling, 384)
  }
  const set = await (await import('@/viewport/pbrTextures')).pbrSet(preset.id).catch(() => null)
  let img = set?.map?.image as CanvasImageSource & { width: number; height: number } | undefined
  let part = set ? Math.min(1, 1.2 / set.tile) : 1
  if (!img && preset.texture) {
    img = (await import('@/viewport/detailTextures')).detailTexture(preset.texture).image as HTMLCanvasElement
    part = 1
  }
  if (!img) return null
  const c = document.createElement('canvas')
  c.width = 384
  c.height = 128
  c.getContext('2d')!.drawImage(img, 0, 0, img.width * part, (img.height * part) / 3, 0, 0, 384, 128)
  return c.toDataURL('image/jpeg', 0.9)
}

/**
 * A floor's texture for the plan drawing: one seamless repeat of it (its real size in metres),
 * recoloured as in 3D.
 */
export async function planSwatch(presetId: string, color: string): Promise<{ url: string; w: number; h: number } | null> {
  const preset = presetById(presetId)
  if (!preset) return null
  let url: string | null = null
  let w = 1
  let h = 1
  if (preset.floor) {
    const set = await (await import('@/viewport/pbrTextures')).pbrSet(preset.id).catch(() => null)
    const img = set?.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined
    if (img && set) {
      const c = document.createElement('canvas')
      c.width = c.height = 512
      c.getContext('2d')!.drawImage(img, 0, 0, 512, 512)
      url = c.toDataURL('image/jpeg', 0.85)
      w = h = set.tile
    } else {
      const ft = await import('@/viewport/floorTextures')
      await ft.loadWood().catch(() => {})
      const t = ft.floorCanvases(preset.id, preset.floor, 300)
      url = t.color.toDataURL('image/jpeg', 0.85)
      w = t.tileX
      h = t.tileY
    }
  } else if (preset.ceiling) return null
  else {
    const set = await (await import('@/viewport/pbrTextures')).pbrSet(preset.id).catch(() => null)
    const img = set?.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined
    if (img && set) {
      const c = document.createElement('canvas')
      c.width = c.height = 512
      c.getContext('2d')!.drawImage(img, 0, 0, 512, 512)
      url = c.toDataURL('image/jpeg', 0.85)
      w = h = set.tile
    } else if (preset.texture) {
      url = ((await import('@/viewport/detailTextures')).detailTexture(preset.texture).image as HTMLCanvasElement).toDataURL('image/jpeg', 0.85)
      // Detail maps are greyscale: tinted to the colour below. Planks are drawn longer (seen from above
      // a metre-long repeat reads as bricks).
      const planks = preset.texture === 'planks'
      return { url: await tinted(url, color, '#bcbcbc'), w: planks ? 2.4 : 1, h: planks ? 0.8 : 1 }
    }
  }
  if (!url) return null
  return { url: await tinted(url, color, preset.color), w, h }
}

/** The preview recoloured the way the 3D view does it: × (colour ÷ the texture's mean colour). */
async function tinted(url: string, color: string, own: string) {
  if (color.toLowerCase() === own.toLowerCase()) return url
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height)
  const avg = [0, 0, 0]
  for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) avg[k] += lin(d.data[i + k] / 255)
  const n = d.data.length / 4
  const t = hexLin(color)
  const f = t.map((v, k) => Math.min(8, v / Math.max(1e-3, avg[k] / n)))
  for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = Math.round(255 * srgb(Math.min(1, lin(d.data[i + k] / 255) * f[k])))
  g.putImageData(d, 0, 0)
  return c.toDataURL('image/jpeg', 0.9)
}

/** A wide look at the chosen material in the chosen colour, as it will be in the room. */
export function FinishPreview({ presetId, color }: { presetId: string; color: string }) {
  const preset = presetById(presetId)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!preset) return
    let live = true
    void flatSample(preset)
      .then((u) => (u ? tinted(u, color, preset.ceiling ? '' : preset.color) : null))
      .then((u) => live && setUrl(u))
      .catch(() => {})
    return () => void (live = false)
  }, [preset, color])
  if (!preset) return null
  return (
    <div className="relative h-16 overflow-hidden rounded-md border border-line-strong" style={{ background: color }} title="How the floor looks in this colour">
      {url && <img src={url} alt="" draggable={false} className="size-full object-cover" />}
      <span className="absolute bottom-1 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/90 backdrop-blur-sm">{preset.name}</span>
    </div>
  )
}
