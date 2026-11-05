import { Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CATALOG, CATEGORIES, loadLibrary, type CatalogItem, type Category } from '@/furniture/catalog'
import { cn } from '@/lib/cn'
import { useWorkspace } from '@/store/workspace'

let manifest: Promise<Record<string, unknown>> | null = null
/** Which photoreal models were downloaded at build time. */
function useModelManifest() {
  const [files, setFiles] = useState<Set<string> | null>(null)
  useEffect(() => {
    manifest ??= fetch(`${import.meta.env.BASE_URL}models/manifest.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
    void manifest.then((m) => setFiles(new Set(Object.keys(m))))
  }, [])
  return files
}

/** Top-down outline of the piece, to scale within its card. */
function Footprint({ item }: { item: CatalogItem }) {
  const [w, h, d] = item.size
  const tall = item.mount === 'wall'
  const W = tall ? w : w
  const H = tall ? h : d
  const k = 44 / Math.max(W, H, 0.4)
  return (
    <svg viewBox="-30 -30 60 60" className="size-12">
      <rect x={(-W * k) / 2} y={(-H * k) / 2} width={W * k} height={H * k} rx={item.id.includes('round') || item.id === 'side-table' || item.id === 'bar-stool' ? (W * k) / 2 : 2} fill="none" stroke="currentColor" strokeWidth="1.2" />
      {!tall && <line x1={(-W * k) / 2 + 3} x2={(W * k) / 2 - 3} y1={(H * k) / 2 - 3} y2={(H * k) / 2 - 3} stroke="currentColor" strokeWidth="0.8" opacity="0.6" />}
    </svg>
  )
}

/** A rendered picture of the piece (made in the background); its outline until it's ready. */
function Preview({ item }: { item: CatalogItem }) {
  // Library models come with their own picture.
  if (item.thumb) return <img src={`${import.meta.env.BASE_URL}models/${item.thumb}`} alt="" loading="lazy" draggable={false} className="h-20 w-full object-contain transition-transform duration-200 group-hover:scale-105" />
  return <RenderedPreview item={item} />
}

function RenderedPreview({ item }: { item: CatalogItem }) {
  const [url, setUrl] = useState<string | null>(null)
  const [seen, setSeen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  // Lazy: a piece is only rendered once its card scrolls into view.
  useEffect(() => {
    const el = box.current
    if (!el || seen) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { rootMargin: '120px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  useEffect(() => {
    if (!seen) return
    let live = true
    void import('@/viewport/thumbnails')
      .then((m) => m.thumbnail(item))
      .then((u) => live && setUrl(u))
      .catch(() => {})
    return () => void (live = false)
  }, [item, seen])
  if (!url)
    return (
      <span ref={box} className="grid h-20 w-full place-items-center text-dim group-hover:text-fg">
        <Footprint item={item} />
      </span>
    )
  return <img src={url} alt="" draggable={false} className="h-20 w-full object-contain transition-transform duration-200 group-hover:scale-105" />
}

export function Catalog() {
  const [cat, setCat] = useState<Category | 'All'>('All')
  const [q, setQ] = useState('')
  const placing = useWorkspace((s) => s.placing)
  const setPlacing = useWorkspace((s) => s.setPlacing)
  const view = useWorkspace((s) => s.view)
  const setView = useWorkspace((s) => s.setView)
  const files = useModelManifest()
  // The model library (hundreds of CC0 pieces) joins the catalog once it has loaded.
  const [libraryCount, setLibraryCount] = useState(0)
  useEffect(() => void loadLibrary().then(setLibraryCount), [])

  const items = useMemo(
    () =>
      CATALOG.filter((i) => (cat === 'All' || i.category === cat) && i.name.toLowerCase().includes(q.trim().toLowerCase()) && (i.kind === 'parametric' || !!i.thumb || i.model!.file.startsWith('own/') || !files || files.has(i.model!.file))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cat, q, files, libraryCount],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-1.5 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search furniture" className="h-6.5 w-full rounded-md bg-raised pl-6.5 pr-2 text-xs text-fg outline-none placeholder:text-faint focus:ring-1 focus:ring-accent" />
        </div>
        <div className="flex flex-wrap gap-1">
          {(['All', ...CATEGORIES] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCat(c)} className={cn('h-5.5 rounded-full px-2 text-2xs transition-colors', cat === c ? 'bg-fg text-app' : 'bg-raised text-dim hover:text-fg')}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1.5 overflow-y-auto px-2 pb-2" data-testid="catalog">
        {items.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => {
              setPlacing(placing === i.id ? null : i.id)
              if (view === '3d') setView('split')
            }}
            title={i.note ?? i.model?.credit}
            className={cn(
              'group relative flex flex-col items-center gap-1 rounded-lg border p-2 text-left transition-colors',
              placing === i.id ? 'border-accent bg-accent-soft' : 'border-line-strong bg-app/40 hover:border-dim',
            )}
          >
            {i.kind === 'model' && (
              <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded bg-white/5 px-1 text-[9px] text-dim">
                <Sparkles className="size-2.5" /> Photoreal
              </span>
            )}
            <Preview item={i} />
            <span className="w-full truncate text-center text-xs text-fg">{i.name}</span>
            <span className="font-mono text-[9.5px] text-faint">
              {i.size.map((v) => Math.round(v * 100)).join(' × ')} cm
            </span>
          </button>
        ))}
      </div>
      <p className="border-t border-line px-2.5 py-1.5 text-2xs leading-snug text-faint">
        {placing ? 'Click in the plan to place it. R rotates, Shift keeps placing, Esc stops. Pieces snap back-first to walls.' : 'Pick a piece, then click in the plan. Parametric pieces resize to any size in the Inspector.'}
      </p>
    </div>
  )
}
