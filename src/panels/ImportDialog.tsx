import { FileUp, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { detectWalls, readDrawing, toPlan, type Detection } from '@/plan/importPlan'
import { activeProject, uid, useWorkspace } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'
import { Button, IconButton, Toggle } from '@/ui/primitives'

/**
 * Import a floor plan (image or PDF): its walls, doors and windows are found and the plan is built
 * from them, without furniture, in a new project. Set the building's real width so the scale is
 * right; the drawing can stay under the plan to check against or trace the rest.
 */
export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [src, setSrc] = useState<{ file: File; canvas: HTMLCanvasElement; url: string; det: Detection } | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [keep, setKeep] = useState(true)

  // Outside width of what was found, in pixels (walls' outer faces).
  const pxWidth = useMemo(() => {
    if (!src?.det.walls.length) return 0
    const lo = Math.min(...src.det.walls.map((w) => Math.min(w.a[0], w.b[0]) - (w.horizontal ? 0 : w.t / 2)))
    const hi = Math.max(...src.det.walls.map((w) => Math.max(w.a[0], w.b[0]) + (w.horizontal ? 0 : w.t / 2)))
    return hi - lo
  }, [src])

  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,.pdf,application/pdf'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setBusy(true)
      setError(null)
      try {
        const canvas = await readDrawing(file)
        const det = detectWalls(canvas)
        const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
        setSrc({ file, canvas, url: URL.createObjectURL(blob), det })
        // First guess at the scale: walls drawn about 20 cm thick.
        const lo = Math.min(...det.walls.map((w) => Math.min(w.a[0], w.b[0])))
        const hi = Math.max(...det.walls.map((w) => Math.max(w.a[0], w.b[0])))
        setWidth(det.walls.length ? Math.round(((hi - lo + det.thickness) * 0.2) / det.thickness * 10) / 10 : null)
      } catch (e) {
        setError((e as Error).message || 'Could not read that file.')
      } finally {
        setBusy(false)
      }
    }
    input.click()
  }

  const create = async () => {
    if (!src) return
    const k = width && pxWidth ? width / pxWidth : 0.2 / src.det.thickness
    const s = useWorkspace.getState()
    s.addProject()
    const p = activeProject(useWorkspace.getState())
    const level = p.levels[0]
    const plan = toPlan(src.det, k, level.id, uid)
    s.renameProject(p.id, src.file.name.replace(/\.[^.]+$/, '') || 'Imported plan')
    s.editPlan('Import plan', (pl) => ({ ...pl, walls: plan.walls, openings: plan.openings }))
    if (keep) {
      const blob = await new Promise<Blob>((r) => src.canvas.toBlob((b) => r(b!), 'image/png'))
      s.setUnderlay({ blob, url: URL.createObjectURL(blob), x: plan.offset[0], y: plan.offset[1], w: src.det.width * k, h: src.det.height * k, opacity: 0.35 })
    }
    s.openProject(p.id)
    s.setView('split')
    onClose()
    setTimeout(() => (viewport.fitPlan(), viewport.frameAll()), 80)
  }

  const scale = src && width && pxWidth ? width / pxWidth : null
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Import a floor plan" className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-white/[0.06] bg-panel p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg">Import a floor plan</h2>
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>
        <p className="mb-3 text-xs leading-snug text-dim">
          A drawing of the plan (PNG, JPG or PDF). The walls are found from the thick lines, gaps in them become doors (inside) and windows (outside walls). It becomes a new project with no furniture; check the result against the drawing, which stays faintly under the plan.
        </p>
        {!src ? (
          <button type="button" onClick={pick} disabled={busy} className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-app/50 text-sm text-dim transition-colors hover:border-accent hover:text-fg">
            <FileUp className="size-5" />
            {busy ? 'Reading the drawing…' : 'Choose a drawing'}
          </button>
        ) : (
          <>
            <div className="relative min-h-0 flex-1 overflow-auto rounded-lg bg-white">
              <div className="relative mx-auto" style={{ aspectRatio: `${src.det.width} / ${src.det.height}`, maxHeight: '52vh' }}>
                <img src={src.url} alt="" className="absolute inset-0 size-full" />
                <svg viewBox={`0 0 ${src.det.width} ${src.det.height}`} className="absolute inset-0 size-full">
                  {src.det.walls.map((w, i) => (
                    <line key={i} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke="#2f6fed" strokeOpacity={0.75} strokeWidth={w.t} strokeLinecap="square" />
                  ))}
                </svg>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-dim">
              <span className={src.det.walls.length ? 'text-fg' : 'text-danger'}>{src.det.walls.length ? `${src.det.walls.length} walls found (blue)` : 'No walls found: you can still trace over the drawing.'}</span>
              <label className="flex items-center gap-1.5">
                Building width (outside)
                <input type="number" min={1} step={0.05} value={width ?? ''} onChange={(e) => setWidth(Number(e.target.value) || null)} className="h-6.5 w-20 rounded-md bg-raised px-1.5 font-mono text-xs text-fg outline-none focus:ring-1 focus:ring-accent" />
                m
              </label>
              {scale && <span className="font-mono text-2xs text-faint">walls ≈ {Math.round(src.det.thickness * scale * 100)} cm thick</span>}
              <label className="flex items-center gap-1.5">
                <Toggle checked={keep} onChange={setKeep} /> Keep the drawing under the plan
              </label>
            </div>
          </>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          {src && (
            <Button variant="ghost" onClick={pick}>
              Another file
            </Button>
          )}
          <Button variant="primary" disabled={!src} onClick={() => void create()}>
            Create plan
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
