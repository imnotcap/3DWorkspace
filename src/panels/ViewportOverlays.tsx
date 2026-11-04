import { AnimatePresence, motion } from 'motion/react'
import { Aperture, Grid3x3, Hash, Layers, SlidersHorizontal, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { cancelGeneration } from '@/generation/run'
import { actions } from '@/lib/actions'
import { cn } from '@/lib/cn'
import { useActiveProject, useWorkspace, type PropertyTab, type ShadingMode } from '@/store/workspace'
import { Button, IconButton, Menu, Tooltip, ease } from '@/ui/primitives'
import CountUp from '@/components/reactbits/CountUp'
import ShinyText from '@/components/reactbits/ShinyText'

const PropertiesPanel = lazy(() => import('./Properties').then((m) => ({ default: m.PropertiesPanel })))

/* ───────── Header pill (View / Select / Add / Object) ───────── */

export function ViewportHeader() {
  const selectedId = useWorkspace((s) => s.selectedId)
  const showGrid = useWorkspace((s) => s.settings.showGrid)
  const showStats = useWorkspace((s) => s.settings.showStats)
  const project = useActiveProject()
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
          { label: 'Cycle Shading', shortcut: 'Z', onSelect: actions.cycleShading },
        ]}
      />
      <Menu
        trigger="Select"
        items={
          project.objects.length
            ? [
                ...project.objects.map((o) => ({ label: o.name, checked: o.id === selectedId, onSelect: () => select(o.id) })),
                { separator: true, label: '' },
                { label: 'None', shortcut: 'Esc', onSelect: () => select(null) },
              ]
            : [{ label: 'Scene is empty', disabled: true }]
        }
      />
      <Menu
        trigger="Add"
        items={[
          { label: 'Mesh from Images…', onSelect: () => (setPropertyTab('generate'), actions.addImages()) },
          { label: 'Import GLB…', onSelect: actions.importGlb },
        ]}
      />
      <Menu
        trigger="Object"
        items={[
          { label: 'Properties', shortcut: 'N', onSelect: () => setPropertyTab('object'), disabled: !selectedId },
          { label: 'Export GLB', shortcut: '⌘E', onSelect: actions.exportSelected, disabled: !selectedId },
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
  { id: 'generate', label: 'Generate', icon: <Hash className="size-3.5" /> },
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
            className="absolute right-13 top-2 z-20 w-72 overflow-hidden rounded-xl border border-white/[0.06] bg-panel-2/92 shadow-2xl shadow-black/60 backdrop-blur-lg"
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

/* ───────── Stats (bottom-left) ───────── */

export function StatsOverlay() {
  const show = useWorkspace((s) => s.settings.showStats)
  const project = useActiveProject()
  if (!show) return null
  const visible = project.objects.filter((o) => o.visible && !o.error)
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
              <div className="mt-2.5 flex justify-end">
                <Button variant="ghost" className="h-6 px-2" onClick={cancelGeneration}>
                  Cancel
                </Button>
              </div>
            </>
          )}
          {job.status === 'error' && (
            <div className="flex items-start gap-3">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-fg">{job.message}</p>
                {job.hint && <p className="mt-1 text-2xs leading-snug text-dim">{job.hint}</p>}
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

/* ───────── Empty state + drop target ───────── */

export function EmptyState({ dragging }: { dragging: boolean }) {
  const project = useActiveProject()
  const show = dragging || project.objects.length === 0
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className={cn('pointer-events-none absolute inset-0 z-10 grid place-items-center', dragging && 'bg-accent/[0.04]')}
        >
          <div
            className={cn(
              'flex flex-col items-center gap-1.5 rounded-xl border border-dashed px-10 py-7 text-center transition-colors duration-150',
              dragging ? 'border-accent/70 bg-panel-2/80' : 'border-line-strong/80 bg-panel/40',
            )}
          >
            <span className="text-sm text-fg">{dragging ? 'Release to add' : 'Drop reference images'}</span>
            <span className="text-2xs text-dim">Photos go to Inputs · .glb files import directly</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
