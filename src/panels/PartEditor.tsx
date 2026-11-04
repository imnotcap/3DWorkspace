import { Eye, EyeOff, Loader2, MousePointerClick, Plus, Merge, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { findParts, maskFromClicks } from '@/generation/run'
import { preparePhoto, type PreparedPhoto } from '@/generation/sam3d/image'
import { decodeMask, type MaskData } from '@/generation/sam3d/masks'
import { addPart, mergeParts } from '@/generation/sam3d/segments'
import { cn } from '@/lib/cn'
import { useActiveProject, useWorkspace, type Segmentation } from '@/store/workspace'
import { Button, IconButton, Toggle, inputCls } from '@/ui/primitives'

type Click = [number, number, 0 | 1]

/** Decoded masks, cached by Blob (a changed part gets a new Blob). */
const decoded = new WeakMap<Blob, Promise<MaskData>>()
const decode = (b: Blob) => {
  let p = decoded.get(b)
  if (!p) decoded.set(b, (p = decodeMask(b)))
  return p
}

/** Which part owns each pixel (0 = none, i + 1 = segments[i]). Parts never overlap. */
async function labelMap(seg: Segmentation): Promise<Uint8Array> {
  const labels = new Uint8Array(seg.width * seg.height)
  for (const [i, s] of seg.segments.entries()) {
    const m = await decode(s.mask)
    if (m.width !== seg.width || m.height !== seg.height) continue
    for (let j = 0; j < m.data.length; j++) if (m.data[j]) labels[j] = i + 1
  }
  return labels
}

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Colour every part over the photo; outlines are opaque so boundaries can be judged to the pixel. */
function paint(ctx: CanvasRenderingContext2D, w: number, h: number, seg: Segmentation | null, labels: Uint8Array | null, highlight: Set<number>, preview: MaskData | null) {
  const img = ctx.createImageData(w, h)
  const d = img.data
  const colors = seg?.segments.map((s) => hex(s.color)) ?? []
  const dim = !!preview || highlight.size > 0
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    if (preview?.data[i]) {
      const x = i % w
      const edge = x === 0 || x === w - 1 || !preview.data[i - 1] || !preview.data[i + 1] || !preview.data[i - w] || !preview.data[i + w]
      d[j] = d[j + 1] = d[j + 2] = 255
      d[j + 3] = edge ? 255 : 110
      continue
    }
    const l = labels?.[i]
    if (!l || !seg || !labels) continue
    const s = seg.segments[l - 1]
    const x = i % w
    const edge = x === 0 || x === w - 1 || labels[i - 1] !== l || labels[i + 1] !== l || labels[i - w] !== l || labels[i + w] !== l
    const [r, g, b] = colors[l - 1]
    d[j] = r
    d[j + 1] = g
    d[j + 2] = b
    const strong = highlight.has(l - 1)
    d[j + 3] = !s.enabled ? (edge ? 90 : 0) : edge ? 255 : strong ? 150 : dim ? 40 : 95
  }
  ctx.putImageData(img, 0, 0)
}

export function PartEditor({ onClose }: { onClose: () => void }) {
  const project = useActiveProject()
  const job = useWorkspace((s) => s.job)
  const autoParts = useWorkspace((s) => s.settings.autoParts)
  const { setPrompt, setSegmentation, updateSegment, updateSettings } = useWorkspace.getState()
  const front = project.images.find((i) => i.view === 'front')
  const seg = project.segmentation
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null)
  const [labels, setLabels] = useState<Uint8Array | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [hover, setHover] = useState<string | null>(null)
  const [mode, setMode] = useState<'select' | 'add'>(seg ? 'select' : 'add')
  const [clicks, setClicks] = useState<Click[]>([])
  const [preview, setPreview] = useState<{ mask: MaskData; score: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const finding = job.status === 'running'

  useEffect(() => {
    if (front) preparePhoto(front).then(setPhoto, (e) => setError((e as Error).message))
  }, [front])

  useEffect(() => {
    setLabels(null)
    if (seg) void labelMap(seg).then(setLabels)
  }, [seg])

  const highlight = useMemo(() => {
    const ids = new Set(selected)
    if (hover) ids.add(hover)
    return new Set(seg?.segments.flatMap((s, i) => (ids.has(s.id) ? [i] : [])) ?? [])
  }, [seg, selected, hover])

  useEffect(() => {
    const c = canvas.current
    if (!c || !photo) return
    c.width = photo.width
    c.height = photo.height
    const ctx = c.getContext('2d')!
    const fits = !!seg && !!labels && seg.width === photo.width && seg.height === photo.height
    paint(ctx, photo.width, photo.height, fits ? seg : null, fits ? labels : null, highlight, preview?.mask ?? null)
  }, [photo, seg, labels, highlight, preview])

  // The photo is shown at the largest size that fits, at its exact aspect ratio, so a click maps to one pixel.
  const stage = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const el = stage.current
    if (!el || !photo) return
    const ro = new ResizeObserver(([e]) => {
      const k = Math.min(e.contentRect.width / photo.width, e.contentRect.height / photo.height)
      setFit({ width: photo.width * k, height: photo.height * k })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [photo])

  useEffect(() => {
    // While the editor is open, the workspace's single-key shortcuts (X = delete…) are off.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
      if (e.key !== 'Escape') return void (!typing && e.stopPropagation())
      e.stopPropagation()
      if (clicks.length) {
        setClicks([])
        setPreview(null)
      } else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [clicks.length, onClose])

  // Photo pixel under the pointer.
  const toPixel = (e: RMouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (!photo) return null
    const x = ((e.clientX - r.left) / r.width) * photo.width
    const y = ((e.clientY - r.top) / r.height) * photo.height
    return x >= 0 && y >= 0 && x < photo.width && y < photo.height ? ([x, y] as const) : null
  }
  const partAt = (p: readonly [number, number] | null) => {
    if (!p || !seg || !labels) return null
    const l = labels[Math.floor(p[1]) * seg.width + Math.floor(p[0])]
    return l ? seg.segments[l - 1] : null
  }

  const runClicks = async (next: Click[]) => {
    setClicks(next)
    if (!next.some((c) => c[2] === 1)) return setPreview(null)
    setBusy(true)
    setError(null)
    try {
      setPreview(await maskFromClicks(next))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onPhotoClick = (e: RMouseEvent) => {
    const p = toPixel(e)
    if (!p) return
    if (mode === 'select') {
      const part = partAt(p)
      if (!part) return setSelected(new Set())
      setSelected((s) => {
        if (!(e.shiftKey || e.metaKey || e.ctrlKey)) return new Set([part.id])
        const n = new Set(s)
        if (n.has(part.id)) n.delete(part.id)
        else n.add(part.id)
        return n
      })
      return
    }
    const label: 0 | 1 = e.altKey || e.shiftKey ? 0 : 1
    void runClicks([...clicks, [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, label]])
  }

  const confirmAdd = async () => {
    if (!preview || !photo || !front) return
    setBusy(true)
    try {
      const base: Segmentation = seg ?? {
        imageId: front.id,
        width: photo.width,
        height: photo.height,
        objectLabel: project.prompt.object.trim() || 'Model',
        segments: [],
        prompt: { object: project.prompt.object.trim(), parts: project.prompt.parts.trim(), auto: autoParts },
        edited: true,
      }
      const name = newName.trim() || `Part ${(seg?.segments.length ?? 0) + 1}`
      setSegmentation(await addPart(base, preview.mask, name))
      setClicks([])
      setPreview(null)
      setNewName('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const merge = async () => {
    if (!seg || selected.size < 2) return
    setBusy(true)
    try {
      // Keep list order: the first selected in the list keeps its name.
      const ids = seg.segments.filter((s) => selected.has(s.id)).map((s) => s.id)
      setSegmentation(await mergeParts(seg, ids))
      setSelected(new Set([ids[0]]))
    } finally {
      setBusy(false)
    }
  }

  const enabled = seg?.segments.filter((s) => s.enabled).length ?? 0
  const total = seg?.segments.reduce((a, s) => a + s.area, 0) ?? 0

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Parts" className="flex h-full max-h-[900px] w-full max-w-[1400px] flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-panel shadow-2xl">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="text-xs font-medium text-fg">Parts</span>
          <span className="text-2xs text-faint">SAM 3 splits the Front photo; SAM 3D builds each part, already in place.</span>
          <div className="flex-1" />
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-3">
              <Button variant={mode === 'select' ? 'default' : 'ghost'} className="h-6.5 px-2" onClick={() => (setMode('select'), setClicks([]), setPreview(null))} disabled={!seg}>
                <MousePointerClick className="size-3.5" /> Select
              </Button>
              <Button variant={mode === 'add' ? 'default' : 'ghost'} className="h-6.5 px-2" onClick={() => setMode('add')}>
                <Plus className="size-3.5" /> Add part by clicking
              </Button>
              <span className="ml-2 text-2xs text-faint">
                {mode === 'add' ? 'Click on the part. Shift or Alt + click to exclude an area. Each click refines it.' : 'Click a part to select it. Shift + click to select more.'}
              </span>
              {busy && <Loader2 className="ml-auto size-3.5 animate-spin text-dim" />}
            </div>
            <div ref={stage} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-app">
              {photo && fit ? (
                <div
                  className={cn('relative', mode === 'add' ? 'cursor-crosshair' : 'cursor-pointer')}
                  style={{ width: fit.width, height: fit.height }}
                  onClick={onPhotoClick}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    const p = toPixel(e)
                    if (mode === 'add' && p) void runClicks([...clicks, [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, 0]])
                  }}
                  onMouseMove={(e) => mode === 'select' && setHover(partAt(toPixel(e))?.id ?? null)}
                  onMouseLeave={() => setHover(null)}
                  data-testid="part-photo"
                >
                  <img src={photo.url} alt="Front photo" draggable={false} className="absolute inset-0 size-full select-none" />
                  <canvas ref={canvas} className="pointer-events-none absolute inset-0 size-full" />
                  <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${photo.width} ${photo.height}`}>
                    {clicks.map(([x, y, l], i) => (
                      <circle key={i} cx={x} cy={y} r={Math.max(photo.width, photo.height) / 160} fill={l ? '#46a758' : '#e5484d'} stroke="#fff" strokeWidth={Math.max(photo.width, photo.height) / 500} />
                    ))}
                  </svg>
                </div>
              ) : (
                <p className="absolute text-xs text-dim">{front ? 'Loading photo…' : 'Add a photo and tag it Front.'}</p>
              )}
            </div>
            {mode === 'add' && (
              <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-3">
                <input className={cn(inputCls, 'w-48')} placeholder={`Part ${(seg?.segments.length ?? 0) + 1}`} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New part name" />
                <Button variant="primary" className="h-6.5 px-3" disabled={!preview || busy} onClick={confirmAdd}>
                  Add part
                </Button>
                <Button variant="ghost" className="h-6.5 px-2" disabled={!clicks.length} onClick={() => (setClicks([]), setPreview(null))}>
                  Clear clicks
                </Button>
                {preview && <span className="text-2xs text-faint">SAM confidence {(preview.score * 100).toFixed(0)}%. It takes these pixels from any part that had them.</span>}
              </div>
            )}
          </div>

          <aside className="flex w-80 shrink-0 flex-col border-l border-line">
            <div className="space-y-2 border-b border-line p-3">
              <label className="block">
                <span className="mb-1 block text-2xs text-dim">What is it?</span>
                <input className={inputCls} placeholder="e.g. office chair" value={project.prompt.object} onChange={(e) => setPrompt({ object: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-2xs text-dim">Parts to find (comma-separated)</span>
                <input className={inputCls} placeholder="seat, backrest, armrest, wheel" value={project.prompt.parts} onChange={(e) => setPrompt({ parts: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-2xs text-dim">
                <Toggle checked={autoParts} onChange={(v) => updateSettings({ autoParts: v })} /> With no names, find the parts automatically
              </label>
              <Button className="w-full" disabled={finding || !front} onClick={() => void findParts()}>
                {finding ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                {seg ? 'Find parts again' : 'Find parts'}
              </Button>
              {seg?.edited && <p className="text-2xs leading-snug text-faint">You edited these parts, so Generate keeps them. Finding again replaces them.</p>}
              {error && <p className="text-2xs leading-snug text-danger">{error}</p>}
            </div>

            <div className="flex h-8 shrink-0 items-center justify-between px-3">
              <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">
                {seg ? `${enabled} of ${seg.segments.length} parts` : 'No parts yet'}
              </span>
              <Button variant="ghost" className="h-6 px-2" disabled={selected.size < 2 || busy} onClick={merge}>
                <Merge className="size-3" /> Merge {selected.size > 1 ? selected.size : ''}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="part-list">
              {seg?.segments.map((s) => (
                <div
                  key={s.id}
                  onMouseEnter={() => setHover(s.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) =>
                    setSelected((cur) => {
                      if (!(e.shiftKey || e.metaKey || e.ctrlKey)) return new Set([s.id])
                      const n = new Set(cur)
                      if (n.has(s.id)) n.delete(s.id)
                      else n.add(s.id)
                      return n
                    })
                  }
                  className={cn('flex h-7 items-center gap-2 rounded px-1.5', selected.has(s.id) ? 'bg-active' : 'hover:bg-hover/60', !s.enabled && 'opacity-50')}
                >
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                  <input
                    value={s.name}
                    onChange={(e) => updateSegment(s.id, { name: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Part name"
                    className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none focus:underline"
                  />
                  {s.group && <span className="shrink-0 text-2xs text-faint">in {s.group}</span>}
                  <span className="w-10 shrink-0 text-right font-mono text-2xs tabular text-faint">{total ? ((s.area / total) * 100).toFixed(1) : 0}%</span>
                  <button
                    type="button"
                    aria-label={s.enabled ? `Leave ${s.name} out` : `Build ${s.name}`}
                    onClick={(e) => (e.stopPropagation(), updateSegment(s.id, { enabled: !s.enabled }))}
                    className="grid size-5 shrink-0 place-items-center rounded text-dim hover:text-fg"
                  >
                    {s.enabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                  </button>
                </div>
              ))}
              {!seg && <p className="px-1.5 py-1 text-2xs leading-snug text-faint">Find parts with SAM 3, or click on the photo to add parts yourself.</p>}
            </div>
            <div className="border-t border-line p-3">
              <Button variant="primary" className="w-full" onClick={onClose}>
                Done
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  )
}
