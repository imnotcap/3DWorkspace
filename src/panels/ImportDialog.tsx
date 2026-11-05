import { Check, FileUp, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { analyseDrawing, planAt, rasterOf, readDrawing, type ImportAnalysis, type PxWall } from '@/plan/importPlan'
import { ocrLines } from '@/plan/importText'
import type { OpeningKind } from '@/plan/types'
import { activeProject, uid, useWorkspace } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'
import { Button, IconButton, Toggle } from '@/ui/primitives'

const KIND_COLOR: Record<OpeningKind, string> = {
  door: '#f59e0b',
  'double-door': '#f59e0b',
  'sliding-door': '#a855f7',
  archway: '#22c55e',
  window: '#06b6d4',
  'wide-window': '#06b6d4',
  'floor-window': '#06b6d4',
  'french-window': '#0ea5e9',
}
const KIND_LABEL: Record<string, string> = { door: 'Doors', 'sliding-door': 'Sliding doors', archway: 'Passages', window: 'Windows' }
const family = (k: OpeningKind) => (k === 'double-door' ? 'door' : k === 'wide-window' || k === 'floor-window' || k === 'french-window' ? 'window' : k)

/** Outside width of the walls found, in pixels (their outer faces). */
function pxWidth(walls: PxWall[]) {
  if (!walls.length) return 0
  const lo = Math.min(...walls.map((w) => (w.hor ? w.a : w.o - w.t / 2)))
  const hi = Math.max(...walls.map((w) => (w.hor ? w.b : w.o + w.t / 2)))
  return hi - lo
}

/**
 * Import a floor plan (image or PDF): walls (thick and thin), doors with their swing, windows,
 * sliding doors and passages are found, wardrobes are recognised (and kept out of the walls), the
 * room names and m² are read, and the scale is set from those areas so every room comes out at
 * the size printed on the drawing. It becomes a new project, without furniture.
 */
export function ImportDialog({ onClose, file }: { onClose: () => void; file?: File }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [src, setSrc] = useState<{ file: File; canvas: HTMLCanvasElement; url: string; an: ImportAnalysis } | null>(null)
  /** Building width typed by the user (overrides the scale from the labels). */
  const [width, setWidth] = useState<number | null>(null)
  const [keep, setKeep] = useState(true)

  const auto = src ? (src.an.labelScale ?? src.an.guessScale) : 0
  const base = useMemo(() => (src ? planAt(src.an.ctx, auto) : null), [src, auto])
  const wPx = base ? pxWidth(base.px) : 0
  const k = width && wPx ? width / wPx : auto
  const plan = useMemo(() => (src ? (k === auto ? base : planAt(src.an.ctx, k)) : null), [src, k, auto, base])

  const read = async (file: File) => {
    setBusy('Reading the drawing…')
    setError(null)
    try {
      const d = await readDrawing(file)
      const an = await analyseDrawing(rasterOf(d.canvas), {
        text: d.text,
        ocr: (ink, w, h) => {
          setBusy('Reading room names and m²…')
          return ocrLines(ink, w, h, (p) => setBusy(`Reading room names and m²… ${Math.round(p * 100)} %`))
        },
      })
      const blob = await new Promise<Blob>((r) => d.canvas.toBlob((b) => r(b!), 'image/png'))
      setSrc({ file, canvas: d.canvas, url: URL.createObjectURL(blob), an })
      setWidth(null)
    } catch (e) {
      setError((e as Error).message || 'Could not read that file.')
    } finally {
      setBusy(null)
    }
  }
  const pick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,.pdf,application/pdf'
    input.onchange = () => input.files?.[0] && void read(input.files[0])
    input.click()
  }
  // A drawing dropped on the home screen opens straight into the check.
  const started = useRef(false)
  useEffect(() => {
    if (file && !started.current) {
      started.current = true
      void read(file)
    }
  }, [file]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!src || !plan) return
    const s = useWorkspace.getState()
    s.addProject()
    const p = activeProject(useWorkspace.getState())
    const level = p.levels[0]
    const built = planAt(src.an.ctx, k, level.id, uid)
    s.renameProject(p.id, src.file.name.replace(/\.[^.]+$/, '') || 'Imported plan')
    s.editPlan('Import plan', (pl) => ({ ...pl, walls: built.walls, openings: built.openings, rooms: built.rooms }))
    if (keep) {
      const blob = await new Promise<Blob>((r) => src.canvas.toBlob((b) => r(b!), 'image/png'))
      s.setUnderlay({ blob, url: URL.createObjectURL(blob), x: built.offset[0], y: built.offset[1], w: src.canvas.width * k, h: src.canvas.height * k, opacity: 0.35 })
    }
    s.openProject(p.id)
    s.setView('split')
    onClose()
    setTimeout(() => (viewport.fitPlan(), viewport.frameAll()), 80)
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of plan?.openings ?? []) c[family(o.kind)] = (c[family(o.kind)] ?? 0) + 1
    return c
  }, [plan])
  const checks = plan?.checks ?? []
  const fits = (c: (typeof checks)[number]) => c.computed !== null && c.unique && Math.abs(c.computed - c.label) <= Math.max(0.15, c.label * 0.02)
  const W = src?.canvas.width ?? 1
  const H = src?.canvas.height ?? 1
  const sw = Math.max(1.5, W / 700)

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Import a floor plan" className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl border border-white/[0.06] bg-panel p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg">Import a floor plan</h2>
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>
        {!src ? (
          <>
            <p className="mb-3 text-xs leading-snug text-dim">
              A drawing of the plan (PNG, JPG or PDF). Walls, doors (and which way they open), windows, sliding doors, passages and wardrobes are recognised; the room names and m² on the drawing are read and set the scale, so the rooms come out at their printed areas. It becomes a new project without furniture.
            </p>
            <button type="button" onClick={pick} disabled={!!busy} className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-app/50 text-sm text-dim transition-colors hover:border-accent hover:text-fg">
              <FileUp className="size-5" />
              {busy ?? 'Choose a drawing'}
            </button>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
            <div className="relative min-h-0 min-w-0 flex-1 overflow-auto rounded-lg bg-white">
              <div className="relative mx-auto" style={{ aspectRatio: `${W} / ${H}`, maxHeight: '64vh' }}>
                <img src={src.url} alt="" className="absolute inset-0 size-full" />
                <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full">
                  {src.an.ctx.cabinets.map(([x0, y0, x1, y1], i) => (
                    <rect key={`c${i}`} x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="#ec4899" fillOpacity={0.18} stroke="#ec4899" strokeWidth={sw} strokeDasharray={`${sw * 3} ${sw * 2}`} />
                  ))}
                  {plan?.px.map((w, i) => (
                    <rect key={`w${i}`} x={w.hor ? w.a : w.o - w.t / 2} y={w.hor ? w.o - w.t / 2 : w.a} width={w.hor ? w.b - w.a : w.t} height={w.hor ? w.t : w.b - w.a} fill="#2f6fed" fillOpacity={0.55} />
                  ))}
                  {plan?.px.flatMap((w, i) =>
                    w.gaps.map((g, j) => {
                      // Openings come out wall by wall, gap by gap, in this order.
                      const o = plan.openings[plan.px.slice(0, i).reduce((n, x) => n + x.gaps.length, 0) + j]
                      const color = o ? KIND_COLOR[o.kind] : '#999'
                      const P = (u: number, v: number) => (w.hor ? `${u},${v}` : `${v},${u}`)
                      const sw2 = g.sym.swing
                      const face = w.o + (sw2?.side ?? 1) * (w.t / 2)
                      return (
                        <g key={`g${i}-${j}`}>
                          <polygon points={[P(g.e, w.o - w.t / 2), P(g.s, w.o - w.t / 2), P(g.s, w.o + w.t / 2), P(g.e, w.o + w.t / 2)].join(' ')} fill={color} fillOpacity={0.75} />
                          {sw2 &&
                            (sw2.double ? [[g.e, 1] as const, [g.s, -1] as const] : [[sw2.hinge === 'e' ? g.e : g.s, sw2.hinge === 'e' ? 1 : -1] as const]).map(([uh, dir], n) => (
                              <polyline
                                key={n}
                                fill="none"
                                stroke={color}
                                strokeWidth={sw}
                                points={[P(uh, face + sw2.side * sw2.r), P(uh, face), ...Array.from({ length: 13 }, (_, q) => P(uh + dir * sw2.r * Math.cos((q / 12) * (Math.PI / 2)), face + sw2.side * sw2.r * Math.sin((q / 12) * (Math.PI / 2))))].join(' ')}
                              />
                            ))}
                        </g>
                      )
                    }),
                  )}
                  {checks.map((c, i) => (
                    <circle key={`l${i}`} cx={c.at[0]} cy={c.at[1]} r={sw * 5} fill={fits(c) ? '#22c55e' : '#ef4444'} fillOpacity={0.85} />
                  ))}
                </svg>
              </div>
            </div>
            <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto text-xs">
              <div className="space-y-1 text-dim">
                <div className={plan?.walls.length ? 'text-fg' : 'text-danger'}>{plan?.walls.length ? `${plan.walls.length} walls (blue)` : 'No walls found: you can still trace over the drawing.'}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {Object.entries(KIND_LABEL).map(([kk, label]) => (
                    <span key={kk} className="flex items-center gap-1">
                      <span className="size-2 rounded-sm" style={{ background: KIND_COLOR[kk as OpeningKind] }} />
                      {counts[kk] ?? 0} {label.toLowerCase()}
                    </span>
                  ))}
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-sm bg-[#ec4899]" />
                    {src.an.ctx.cabinets.length} wardrobes (not walls)
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-app/60 p-2.5">
                {src.an.labelScale && !width ? (
                  <p className="text-fg">
                    Scale from the drawing's {checks.filter((c) => c.unique && c.computed).length} m² labels <span className="font-mono text-faint">({(k * 100).toFixed(3)} cm/px)</span>
                  </p>
                ) : (
                  <p className={width ? 'text-fg' : 'text-warn'}>{width ? 'Scale from the building width you entered.' : 'No m² labels found: the scale is guessed from the wall thickness. Enter the building width to set it.'}</p>
                )}
                <label className="mt-2 flex items-center gap-1.5 text-dim">
                  Building width (outside)
                  <input
                    type="number"
                    min={1}
                    step={0.01}
                    value={width ?? Math.round(wPx * k * 100) / 100}
                    onChange={(e) => setWidth(Number(e.target.value) || null)}
                    className="h-6.5 w-20 rounded-md bg-raised px-1.5 font-mono text-xs text-fg outline-none focus:ring-1 focus:ring-accent"
                  />
                  m
                </label>
                {width && src.an.labelScale && (
                  <button type="button" className="mt-1 text-2xs text-accent hover:underline" onClick={() => setWidth(null)}>
                    Use the scale from the m² labels
                  </button>
                )}
              </div>

              {checks.length > 0 && (
                <div>
                  <div className="mb-1 grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-1 text-2xs uppercase tracking-wide text-faint">
                    <span>Room</span>
                    <span className="text-right">Drawing</span>
                    <span className="text-right">Built</span>
                    <span />
                  </div>
                  <div className="space-y-px">
                    {checks.map((c, i) => (
                      <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-2 rounded px-1 py-0.5 odd:bg-app/40">
                        <span className="truncate text-fg">{c.name ?? '—'}</span>
                        <span className="text-right font-mono text-dim">{c.label.toFixed(1)}</span>
                        <span className="text-right font-mono text-dim">{c.computed?.toFixed(2) ?? '—'}</span>
                        {fits(c) ? <Check className="size-3 text-ok" /> : <TriangleAlert className="size-3 text-warn" aria-label={c.computed === null ? 'Not in a closed room' : c.unique ? 'Area differs' : 'Two labels in one room'} />}
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 px-1 text-2xs leading-snug text-faint">m² on the drawing against the room as built. A warning means the room is open (a wall was not found) or shares its space with another label: check it against the drawing after import.</p>
                </div>
              )}

              <label className="flex items-center gap-1.5 text-dim">
                <Toggle checked={keep} onChange={setKeep} /> Keep the drawing under the plan
              </label>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          {src && (
            <Button variant="ghost" onClick={pick} disabled={!!busy}>
              {busy ?? 'Another file'}
            </Button>
          )}
          <Button variant="primary" disabled={!src || !!busy} onClick={() => void create()}>
            Create plan
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
