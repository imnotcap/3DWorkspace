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
