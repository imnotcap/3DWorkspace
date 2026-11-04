import { AnimatePresence, motion } from 'motion/react'
import { Aperture, Grid3x3, Layers, SlidersHorizontal, X } from 'lucide-react'
import { PRIMITIVES } from '@/lib/primitives'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { actions } from '@/lib/actions'
import { ancestorIds, useActiveProject, useWorkspace, type PropertyTab, type ShadingMode } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'
import { frameRect } from '@/lib/frame'
import { Button, IconButton, Menu, Tooltip, ease } from '@/ui/primitives'
import CountUp from '@/components/reactbits/CountUp'
import ShinyText from '@/components/reactbits/ShinyText'

const PropertiesPanel = lazy(() => import('./Properties').then((m) => ({ default: m.PropertiesPanel })))

/* ───────── Header pill (View / Select / Add / Object) ───────── */

export function ViewportHeader() {
  const selectedId = useWorkspace((s) => s.selectedId)
  const showGrid = useWorkspace((s) => s.settings.showGrid)
  const showStats = useWorkspace((s) => s.settings.showStats)
  const showTimeline = useWorkspace((s) => s.settings.showTimeline)
  const cameraView = useWorkspace((s) => s.cameraView)
  const project = useActiveProject()
  const selected = project.objects.find((o) => o.id === selectedId)
  const { updateSettings, select, setPropertyTab } = useWorkspace.getState()

  return (
    <div className="absolute left-2 top-2 z-10 flex h-7 items-center gap-0.5 rounded-lg border border-white/[0.04] bg-panel-2/90 px-1 backdrop-blur-md">
      <span className="flex h-6 items-center gap-1.5 rounded px-2 text-xs text-fg">
        <Layers className="size-3 text-dim" /> Object Mode
      </span>
      <div className="mx-0.5 h-3.5 w-px bg-line-strong" />
      <Menu
        trigger="View"
        items={[
          { label: 'Frame Selected', shortcut: 'F', onSelect: actions.frameSelected, disabled: !selectedId },
          { label: 'Frame All', shortcut: 'Home', onSelect: actions.frameAll },
          { separator: true, label: '' },
          { label: 'Grid', checked: showGrid, onSelect: () => updateSettings({ showGrid: !showGrid }) },
          { label: 'Statistics', checked: showStats, onSelect: () => updateSettings({ showStats: !showStats }) },
          { label: 'Tour bar', checked: showTimeline, onSelect: () => updateSettings({ showTimeline: !showTimeline }) },
          { separator: true, label: '' },
          { label: 'Camera View', shortcut: '0', checked: cameraView, onSelect: actions.toggleCameraView },
          { label: 'Align Camera to View', shortcut: '⌃⌥0', onSelect: actions.cameraFromView },
          { label: 'Cycle Shading', shortcut: 'Z', onSelect: actions.cycleShading },
        ]}
      />
      <Menu
        trigger="Select"
        items={
          project.objects.length
            ? [
                ...project.objects.map((o) => ({
                  label: `${'\u2003'.repeat(ancestorIds(project.objects, o.id).length)}${o.name}`,
                  checked: o.id === selectedId,
                  onSelect: () => select(o.id),
                })),
                { separator: true, label: '' },
                { label: 'None', shortcut: 'Esc', onSelect: () => select(null) },
              ]
            : [{ label: 'Scene is empty', disabled: true }]
        }
      />
      <Menu
        trigger="Add"
        items={[
          ...PRIMITIVES.map((p) => ({ label: p.label, onSelect: () => (actions.addPrimitive(p.label), setPropertyTab('object')) })),
          { separator: true, label: '' },
          { label: 'Import GLB…', onSelect: actions.importGlb },
        ]}
      />
      <Menu
        trigger="Object"
        items={[
          { label: 'Properties', shortcut: 'N', onSelect: () => setPropertyTab('object'), disabled: !selectedId },
          { label: 'Duplicate', shortcut: '⇧D', onSelect: actions.duplicateSelected, disabled: !selectedId },
          { label: 'Separate into Parts', onSelect: actions.separateSelected, disabled: !selected?.spec },
          { label: 'Take Part out of Model', onSelect: actions.unparentSelected, disabled: !selected?.parentId },
          { separator: true, label: '' },
          { label: 'Export Selected (.glb)', shortcut: '⌘E', onSelect: actions.exportSelected, disabled: !selectedId },
          { label: 'Export Scene (.glb)', onSelect: actions.exportScene, disabled: !project.objects.length },
          { separator: true, label: '' },
          { label: 'Delete', shortcut: 'X', onSelect: actions.deleteSelected, disabled: !selectedId },
        ]}
      />
    </div>
  )
}

/* ───────── Right strip: shading + property tabs ───────── */

function ShadingIcon({ mode }: { mode: ShadingMode }) {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5">
      <defs>
        <radialGradient id={`g-${mode}`} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor={mode === 'solid' ? '#e6e6e6' : '#ffffff'} />
          <stop offset="1" stopColor={mode === 'rendered' ? '#2a2a2a' : '#6b6b6b'} />
        </radialGradient>
      </defs>
      {mode === 'wireframe' ? (
        <g fill="none" stroke="currentColor" strokeWidth="1">
          <circle cx="8" cy="8" r="6" />
          <ellipse cx="8" cy="8" rx="2.6" ry="6" />
          <path d="M2 8h12" />
        </g>
      ) : (
        <>
          <circle cx="8" cy="8" r="6" fill={mode === 'solid' ? '#a8a8a8' : `url(#g-${mode})`} />
          {mode === 'material' && <circle cx="6" cy="5.6" r="1.6" fill="#fff" opacity=".9" />}
          {mode === 'rendered' && <circle cx="5.8" cy="5.4" r="1.2" fill="#fff" />}
        </>
      )}
    </svg>
  )
}

const SHADING: { id: ShadingMode; label: string }[] = [
  { id: 'wireframe', label: 'Wireframe' },
  { id: 'solid', label: 'Solid' },
  { id: 'material', label: 'Material Preview' },
  { id: 'rendered', label: 'Rendered' },
]

const TABS: { id: Exclude<PropertyTab, null>; label: string; icon: ReactNode }[] = [
  { id: 'object', label: 'Object', icon: <SlidersHorizontal className="size-3.5" /> },
  { id: 'render', label: 'Render', icon: <Aperture className="size-3.5" /> },
]

export function ViewportSideStrip() {
  const shading = useWorkspace((s) => s.shading)
  const tab = useWorkspace((s) => s.propertyTab)
  const showGrid = useWorkspace((s) => s.settings.showGrid)
  const { setShading, setPropertyTab, updateSettings } = useWorkspace.getState()

  return (
    <>
      <div className="absolute right-2 top-2 z-20 flex flex-col items-center gap-0.5 rounded-lg border border-white/[0.04] bg-panel-2/90 p-1 backdrop-blur-md">
        {SHADING.map((m) => (
          <Tooltip key={m.id} label={m.label} shortcut="Z" side="left">
            <IconButton aria-label={m.label} active={shading === m.id} onClick={() => setShading(m.id)}>
              <ShadingIcon mode={m.id} />
            </IconButton>
          </Tooltip>
        ))}
        <div className="my-1 h-px w-5 bg-line-strong" />
        {TABS.map((t) => (
          <Tooltip key={t.id} label={t.label} shortcut={t.id === 'object' ? 'N' : undefined} side="left">
            <IconButton aria-label={t.label} active={tab === t.id} onClick={() => setPropertyTab(tab === t.id ? null : t.id)}>
              {t.icon}
            </IconButton>
          </Tooltip>
        ))}
        <div className="my-1 h-px w-5 bg-line-strong" />
        <Tooltip label="Grid" side="left">
          <IconButton aria-label="Toggle grid" active={showGrid} onClick={() => updateSettings({ showGrid: !showGrid })}>
            <Grid3x3 className="size-3.5" />
          </IconButton>
        </Tooltip>
      </div>

      <AnimatePresence>
        {tab && (
          <motion.div
            key="props"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease }}
            className="absolute right-13 top-2 z-20 max-h-[calc(100%-1rem)] w-80 overflow-y-auto rounded-xl border border-white/[0.06] bg-panel-2/92 shadow-2xl shadow-black/60 backdrop-blur-lg"
          >
            <div className="flex h-8 items-center justify-between border-b border-line pl-3 pr-1">
              <span className="text-xs font-medium text-fg">{TABS.find((t) => t.id === tab)?.label}</span>
              <IconButton size="sm" aria-label="Close" onClick={() => setPropertyTab(null)}>
                <X className="size-3" />
              </IconButton>
            </div>
            <Suspense fallback={<div className="h-24" />}>
              <PropertiesPanel tab={tab} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/* ───────── Path tracing progress (top centre) ───────── */

/** Blender-style "Sample 34/1024" while the Rendered view path traces. */
export function TraceStatus() {
  const [p, setP] = useState(viewport.traceProgress)
  useEffect(() => {
    let last = ''
    viewport.onTraceProgress = (next) => {
      const key = `${next.state}:${next.samples}:${next.max}`
      if (key !== last) {
        last = key
        setP({ ...next })
      }
    }
    return () => void (viewport.onTraceProgress = null)
  }, [])
  const shading = useWorkspace((s) => s.shading)
  if (shading !== 'rendered' || p.state === 'off') return null
  const label = p.state === 'building' ? 'Path tracing · preparing scene' : p.state === 'done' ? `Path traced · ${p.samples} samples` : `Path tracing · sample ${p.samples} / ${p.max}`
  return (
    <div className="pointer-events-none absolute left-1/2 top-11 z-10 -translate-x-1/2 rounded-md bg-panel-2/85 px-2.5 py-1 font-mono text-2xs text-dim backdrop-blur-md">
      {label}
      {p.state === 'sampling' && <span className="ml-2 inline-block h-1 w-16 overflow-hidden rounded-full bg-app align-middle"><span className="block h-full bg-accent" style={{ width: `${(p.samples / p.max) * 100}%` }} /></span>}
    </div>
  )
}

/* ───────── Stats (bottom-left) ───────── */

export function StatsOverlay() {
  const show = useWorkspace((s) => s.settings.showStats)
  const project = useActiveProject()
  if (!show) return null
  const byId = new Map(project.objects.map((o) => [o.id, o]))
  // A part counts if it and every model/folder above it are visible; models themselves have no geometry.
  const shown = (o: (typeof project.objects)[number]) => o.visible && ancestorIds(project.objects, o.id).every((a) => byId.get(a)?.visible)
  const visible = project.objects.filter((o) => !o.isGroup && !o.error && shown(o))
  const v = visible.reduce((a, o) => a + (o.stats?.vertices ?? 0), 0)
  const t = visible.reduce((a, o) => a + (o.stats?.triangles ?? 0), 0)
  const rows: [string, number][] = [
    ['Objects', visible.length],
    ['Vertices', v],
    ['Triangles', t],
  ]
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 font-mono text-2xs tabular">
      {rows.map(([k, val]) => (
        <div key={k} className="contents">
          <span className="text-faint">{k}</span>
          <CountUp to={val} duration={0.6} separator="," trigger="load" className="text-dim" />
        </div>
      ))}
    </div>
  )
}

/* ───────── Job progress card (bottom-centre) ───────── */

export function JobCard() {
  const job = useWorkspace((s) => s.job)
  const setJob = useWorkspace((s) => s.setJob)
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (job.status !== 'running') return
    const id = setInterval(() => setNow(performance.now()), 500)
    return () => clearInterval(id)
  }, [job.status])

  useEffect(() => {
    if (job.status !== 'done') return
    const id = setTimeout(() => setJob({ status: 'idle' }), 4000)
    return () => clearTimeout(id)
  }, [job, setJob])

  return (
    <AnimatePresence>
      {job.status !== 'idle' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.18, ease }}
          className="absolute bottom-3 left-1/2 z-20 w-96 -translate-x-1/2 rounded-xl border border-white/[0.06] bg-panel-2/95 p-3 shadow-2xl shadow-black/60 backdrop-blur-lg"
        >
          {job.status === 'running' && (
            <>
              <div className="mb-2 flex items-center justify-between text-xs">
                <ShinyText text={job.message} color="#a3a3a3" shineColor="#ffffff" speed={2.4} className="truncate" />
                <span className="ml-3 shrink-0 font-mono text-2xs tabular text-faint">{((now - job.startedAt) / 1000).toFixed(0)}s</span>
              </div>
              <div className="relative h-1 overflow-hidden rounded-full bg-app">
                {job.progress != null ? (
                  <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${Math.round(job.progress * 100)}%` }} transition={{ duration: 0.3, ease }} />
                ) : (
                  <motion.div
                    className="absolute h-full w-1/3 rounded-full bg-accent/80"
                    animate={{ x: ['-100%', '300%'] }}
                    transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </div>
            </>
          )}
          {job.status === 'error' && (
            <div className="flex items-start gap-3">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-fg">{job.message}</p>
                {job.hint && <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-2xs leading-snug text-dim">{job.hint}</p>}
              </div>
              <IconButton size="sm" aria-label="Dismiss" onClick={() => setJob({ status: 'idle' })}>
                <X className="size-3" />
              </IconButton>
            </div>
          )}
          {job.status === 'done' && (
            <div className="flex items-center gap-3 text-xs text-fg">
              <span className="size-1.5 rounded-full bg-ok" />
              {job.message}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ───────── Camera frame (passepartout + reference photo) ───────── */

export function CameraFrame() {
  const active = useWorkspace((s) => s.cameraView)
  const w = useWorkspace((s) => s.settings.renderWidth)
  const h = useWorkspace((s) => s.settings.renderHeight)
  const project = useActiveProject()
  const keyed = project.animation.keys.length > 0
  const focal = useWorkspace((s) => (s.cameraView ? (viewport.renderPose()?.focal ?? 50) : 50))
  const box = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = box.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(([e]) => setVp({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const r = frameRect(vp.w, vp.h, w / h)
  return (
    <div ref={box} className="pointer-events-none absolute inset-0 z-[5]">
      <AnimatePresence>
        {active && vp.w > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute outline outline-1 outline-white/25"
            style={{ left: r.x, top: r.y, width: r.w, height: r.h, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
          >
            <span className="absolute -top-5 left-0 font-mono text-2xs text-dim">
              Camera · {w}×{h} · {Math.round(focal)}mm{keyed ? ' · keyed' : ' · drag to frame'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───────── Render progress ───────── */

export function RenderProgress() {
  const job = useWorkspace((s) => s.renderJob)
  return (
    <AnimatePresence>
      {job && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 z-40 grid place-items-center bg-app/80 backdrop-blur-sm"
        >
          <div className="w-96 rounded-xl border border-white/[0.06] bg-panel-2 p-4 shadow-2xl shadow-black/60">
            <div className="mb-2.5 flex items-center justify-between text-xs">
              <ShinyText text={job.kind === 'video' ? 'Rendering animation' : 'Rendering image'} color="#d6d6d6" shineColor="#ffffff" speed={2.4} />
              <span className="font-mono text-2xs tabular text-dim">{job.message}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-app">
              <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${(job.done / job.total) * 100}%` }} transition={{ duration: 0.2, ease }} />
            </div>
            {job.kind === 'video' && (
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" className="h-6 px-2" onClick={actions.cancelRender}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
