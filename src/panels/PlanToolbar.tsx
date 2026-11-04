import { Magnet, Box, BrickWall, DoorOpen, Footprints, FileDown, LayoutTemplate, Maximize2, MousePointer2, PanelsTopLeft, Plus, Square, SquareDashed, AppWindow, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { lazy, Suspense, useState } from 'react'
import { cn } from '@/lib/cn'
import { actions } from '@/lib/actions'
import { OPENING_DEFAULTS, type OpeningKind } from '@/plan/types'
import { newLevel, useActiveProject, useWorkspace, type PlanTool, type View } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'
import { Tooltip } from '@/ui/primitives'

const TemplatesDialog = lazy(() => import('./TemplatesDialog').then((m) => ({ default: m.TemplatesDialog })))

const VIEWS: { id: View; label: string; icon: ReactNode }[] = [
  { id: 'plan', label: 'Plan', icon: <SquareDashed className="size-3.5" /> },
  { id: 'split', label: 'Split', icon: <PanelsTopLeft className="size-3.5" /> },
  { id: '3d', label: '3D', icon: <Box className="size-3.5" /> },
]

const TOOLS: { id: PlanTool; label: string; key: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: <MousePointer2 className="size-3.5" /> },
  { id: 'wall', label: 'Wall', key: 'W', icon: <BrickWall className="size-3.5" /> },
  { id: 'room', label: 'Room', key: 'M', icon: <Square className="size-3.5" /> },
  { id: 'door', label: 'Door', key: 'D', icon: <DoorOpen className="size-3.5" /> },
  { id: 'window', label: 'Window', key: 'O', icon: <AppWindow className="size-3.5" /> },
  { id: 'tour', label: 'Tour', key: 'T', icon: <Footprints className="size-3.5" /> },
]

const DOORS: OpeningKind[] = ['door', 'double-door', 'sliding-door', 'archway']
const WINDOWS: OpeningKind[] = ['window', 'wide-window', 'french-window']

function Seg({ active, onClick, children, label }: { active?: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn('flex h-6.5 items-center gap-1.5 rounded-md px-2 text-xs transition-colors', active ? 'bg-active text-fg' : 'text-dim hover:bg-hover hover:text-fg')}
    >
      {children}
    </button>
  )
}

const Divider = () => <div className="mx-1 h-4 w-px bg-line-strong" />

export function PlanToolbar() {
  const view = useWorkspace((s) => s.view)
  const tool = useWorkspace((s) => s.planTool)
  const kind = useWorkspace((s) => s.openingKind)
  const thickness = useWorkspace((s) => s.settings.wallThickness)
  const snap = useWorkspace((s) => s.settings.snap)
  const grid = useWorkspace((s) => s.settings.grid)
  const project = useActiveProject()
  const { setView, setPlanTool, setOpeningKind, updateSettings, setActiveLevel, editPlan } = useWorkspace.getState()
  const [templates, setTemplates] = useState(false)

  const pickTool = (t: PlanTool) => {
    setPlanTool(t)
    if (view === '3d') setView('split')
  }

  const addLevel = () => {
    const prev = project.levels[project.levels.length - 1]
    const l = newLevel(project.levels.length === 1 ? 'First floor' : `Floor ${project.levels.length}`)
    l.height = prev.height
    editPlan('Add level', (p) => ({ ...p, levels: [...p.levels, l] }))
    setActiveLevel(l.id)
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none]">
      <div className="flex items-center rounded-lg bg-app/70 p-0.5">
        {VIEWS.map((v) => (
          <Seg key={v.id} active={view === v.id} onClick={() => setView(v.id)} label={`${v.label} view`}>
            {v.icon}
            {v.label}
          </Seg>
        ))}
      </div>
      <Divider />
      {TOOLS.map((t) => (
        <Tooltip key={t.id} label={t.label} shortcut={t.key} side="bottom">
          <Seg active={tool === t.id} onClick={() => pickTool(t.id)} label={t.label}>
            {t.icon}
            <span className="hidden xl:inline">{t.label}</span>
          </Seg>
        </Tooltip>
      ))}
      <Divider />
      {(tool === 'wall' || tool === 'room') && (
        <label className="flex items-center gap-1.5 text-2xs text-dim">
          Thickness
          <select value={thickness} onChange={(e) => updateSettings({ wallThickness: Number(e.target.value) })} className="h-6 rounded-md bg-raised px-1.5 text-xs text-fg outline-none">
            {[0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4].map((t) => (
              <option key={t} value={t}>
                {Math.round(t * 100)} cm
              </option>
            ))}
          </select>
        </label>
      )}
      {(tool === 'door' || tool === 'window') && (
        <div className="flex items-center gap-0.5">
          {(tool === 'door' ? DOORS : WINDOWS).map((k) => (
            <Seg key={k} active={kind === k} onClick={() => setOpeningKind(k)}>
              {OPENING_DEFAULTS[k].label}
            </Seg>
          ))}
        </div>
      )}
      {tool === 'tour' && (
        <div className="flex items-center gap-1">
          <Seg onClick={actions.autoTour}>Auto tour</Seg>
          <Seg onClick={actions.clearTour}>
            <Trash2 className="size-3" /> Clear
          </Seg>
          <span className="text-2xs text-faint">Click to add points · play with Space</span>
        </div>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-0.5 rounded-lg bg-app/70 p-0.5">
        <Tooltip label={snap ? 'Snap to grid: on (plan and 3D)' : 'Snap to grid: off'} side="bottom">
          <Seg active={snap} onClick={() => updateSettings({ snap: !snap })} label="Snap to grid">
            <Magnet className="size-3.5" />
            <span className="hidden xl:inline">Snap</span>
          </Seg>
        </Tooltip>
        {snap && (
          <select aria-label="Grid size" value={grid} onChange={(e) => updateSettings({ grid: Number(e.target.value) })} className="h-6 rounded-md bg-raised px-1 text-2xs text-fg outline-none">
            {[0.01, 0.05, 0.1, 0.25, 0.5].map((g) => (
              <option key={g} value={g}>
                {Math.round(g * 100)} cm
              </option>
            ))}
          </select>
        )}
      </div>
      <Divider />
      <div className="flex items-center gap-0.5 rounded-lg bg-app/70 p-0.5">
        {[...project.levels].reverse().map((l) => (
          <Seg key={l.id} active={l.id === project.activeLevelId} onClick={() => setActiveLevel(l.id)}>
            {l.name}
          </Seg>
        ))}
        <Tooltip label="Add a floor" side="bottom">
          <Seg onClick={addLevel} label="Add level">
            <Plus className="size-3.5" />
          </Seg>
        </Tooltip>
      </div>
      <Divider />
      <Tooltip label="Fit plan" side="bottom">
        <Seg onClick={() => (viewport.fitPlan(), viewport.frameAll())} label="Fit">
          <Maximize2 className="size-3.5" />
        </Seg>
      </Tooltip>
      <Seg onClick={() => setTemplates(true)} label="Templates">
        <LayoutTemplate className="size-3.5" /> Templates
      </Seg>
      <button
        type="button"
        onClick={actions.exportPdf}
        className="ml-1 flex h-6.5 shrink-0 items-center gap-1.5 rounded-md bg-fg px-2.5 text-xs font-medium text-app hover:bg-white"
      >
        <FileDown className="size-3.5" /> Export PDF
      </button>
      {templates && (
        <Suspense fallback={null}>
          <TemplatesDialog onClose={() => setTemplates(false)} />
        </Suspense>
      )}
    </div>
  )
}
