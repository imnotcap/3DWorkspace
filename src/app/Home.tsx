import { Box, Check, FileUp, LayoutTemplate, Plus, Trash2 } from 'lucide-react'
import { lazy, Suspense, useMemo, useState, createElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { DARK_THEME, drawPlan, type SvgNode } from '@/plan/draw'
import { analyse } from '@/plan/geometry'
import { TEMPLATES } from '@/plan/templates'
import { useWorkspace, type Project } from '@/store/workspace'
import { IconButton } from '@/ui/primitives'

const ImportDialog = lazy(() => import('@/panels/ImportDialog').then((m) => ({ default: m.ImportDialog })))

/** What you get, free, with nothing to install or sign up for. */
const FREE = ['Unlimited 4K renders and walkthrough videos', 'No watermark, no account', 'Materials list, cost estimate and BR18 checks', 'Runs in your browser; your plans stay on this device']

const reactProps = (a: SvgNode['attrs']) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith('data-')).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]))
const render = (n: SvgNode, key: number | string): ReactNode => createElement(n.tag, { key, ...reactProps(n.attrs) }, n.text ?? n.children?.map((c, i) => render(c, i)))

/** The first floor of a project, as a small plan drawing. */
function PlanThumb({ project }: { project: Project }) {
  const level = project.levels[0]
  const walls = useMemo(() => project.walls.filter((w) => w.levelId === level.id), [project.walls, level.id])
  const view = useMemo(() => {
    if (!walls.length) return null
    const geom = analyse(walls)
    const xs = walls.flatMap((w) => [w.a[0], w.b[0]])
    const ys = walls.flatMap((w) => [w.a[1], w.b[1]])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const pad = 0.6
    const scale = 260 / Math.max(1, x1 - x0 + pad * 2)
    const objects = project.objects.filter((o) => !o.parentId && (o.levelId ?? level.id) === level.id)
    const nodes = drawPlan({ geom, levelId: level.id, walls, openings: project.openings, rooms: project.rooms, objects, scale, theme: DARK_THEME, dimensions: false })
    return { nodes, box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}` }
  }, [walls, project.openings, project.rooms, project.objects, level.id])
  if (!view) return <div className="grid size-full place-items-center text-2xs text-faint">Empty plan</div>
  return (
    <svg viewBox={view.box} className="size-full" preserveAspectRatio="xMidYMid meet">
      {view.nodes.map((n, i) => render(n, i))}
    </svg>
  )
}

function area(p: Project) {
  return p.levels.reduce((a, l) => a + analyse(p.walls.filter((w) => w.levelId === l.id)).faces.reduce((b, f) => b + f.area, 0), 0)
}

/** Workspaces: every project you have, new ones, and templates. Opening one goes to the planner. */
export function Home() {
  const projects = useWorkspace((s) => s.projects)
  const { openProject, addProject, closeProject, renameProject, loadTemplate } = useWorkspace.getState()
  const [editing, setEditing] = useState<string | null>(null)
  /** The import dialog: open (true), or open on a dropped drawing. */
  const [importing, setImporting] = useState<File | boolean>(false)
  const [over, setOver] = useState(false)

  const blank = () => {
    addProject()
    openProject(useWorkspace.getState().activeProjectId)
  }
  const fromTemplate = (id: string) => {
    // Reuse the untouched starter project rather than leaving an empty one behind.
    const st = useWorkspace.getState()
    const cur = st.projects.find((p) => p.id === st.activeProjectId)
    if (!cur || cur.walls.length || cur.objects.length) addProject()
    const t = TEMPLATES.find((x) => x.id === id)!
    loadTemplate(t.build())
    openProject(useWorkspace.getState().activeProjectId)
  }
  // A fresh, never-touched "Untitled" is clutter here.
  const shown = projects.filter((p) => p.walls.length || p.objects.length || projects.length === 1 || p.name !== 'Untitled')

  return (
    <div className="h-full overflow-y-auto bg-app">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8 flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-panel-2">
            <Box className="size-4.5 text-fg" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-base font-medium text-fg">Workspaces</h1>
            <p className="text-xs text-dim">Your homes and plans. Open one to draw, furnish and render it.</p>
          </div>
        </header>

        <section className="mb-10 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <button
            type="button"
            onClick={() => setImporting(true)}
            onDragEnter={(e) => (e.preventDefault(), setOver(true))}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = [...e.dataTransfer.files].find((x) => /^image\/|pdf$/.test(x.type) || /\.pdf$/i.test(x.name))
              if (f) setImporting(f)
            }}
            className={cn(
              'group flex min-h-40 items-center gap-5 rounded-2xl border border-dashed p-6 text-left transition-colors',
              over ? 'border-accent bg-accent/10' : 'border-line-strong bg-panel/60 hover:border-accent',
            )}
          >
            <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent transition-transform duration-200 group-hover:scale-105">
              <FileUp className="size-6" />
            </span>
            <span>
              <span className="block text-lg font-medium text-fg">Import your floor plan</span>
              <span className="mt-1 block max-w-md text-xs leading-relaxed text-dim">
                Drop a PDF or a picture of the drawing from the estate agent or architect. Walls, doors, windows, wardrobes, room names and m² are read, and every room comes out at its printed size.
              </span>
              <span className="mt-3 inline-flex h-7 items-center rounded-md bg-fg px-3 text-xs font-medium text-app">Choose a file</span>
            </span>
          </button>
          <div className="flex flex-col justify-center gap-2 rounded-2xl border border-line-strong bg-panel/40 p-5">
            <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">Free, all of it</span>
            {FREE.map((f) => (
              <span key={f} className="flex items-start gap-2 text-xs text-dim">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                {f}
              </span>
            ))}
          </div>
        </section>
        {importing && (
          <Suspense fallback={null}>
            <ImportDialog file={importing instanceof File ? importing : undefined} onClose={() => setImporting(false)} />
          </Suspense>
        )}

        <section className="mb-10">
          <h2 className="mb-3 text-2xs font-medium uppercase tracking-[0.08em] text-faint">Or start from</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button type="button" onClick={blank} className="flex h-28 flex-col items-start justify-between rounded-xl border border-dashed border-line-strong bg-panel/40 p-4 text-left transition-colors hover:border-accent">
              <Plus className="size-4 text-dim" />
              <span>
                <span className="block text-sm text-fg">Blank plan</span>
                <span className="text-2xs text-dim">Draw your walls from scratch</span>
              </span>
            </button>
            {TEMPLATES.filter((t) => t.id !== 'empty').map((t) => (
              <button key={t.id} type="button" onClick={() => fromTemplate(t.id)} className="flex h-28 flex-col items-start justify-between rounded-xl border border-line-strong bg-panel/60 p-4 text-left transition-colors hover:border-accent">
                <LayoutTemplate className="size-4 text-dim" />
                <span>
                  <span className="block text-sm text-fg">{t.name}</span>
                  <span className="line-clamp-2 text-2xs leading-snug text-dim">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-2xs font-medium uppercase tracking-[0.08em] text-faint">Your workspaces · {shown.length}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p) => (
              <div key={p.id} className="group relative overflow-hidden rounded-xl border border-line-strong bg-panel transition-colors hover:border-accent">
                <button type="button" onClick={() => openProject(p.id)} className="block h-44 w-full bg-[#141414] p-3" aria-label={`Open ${p.name}`}>
                  <PlanThumb project={p} />
                </button>
                <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    {editing === p.id ? (
                      <input
                        autoFocus
                        defaultValue={p.name}
                        onBlur={(e) => (renameProject(p.id, e.target.value.trim() || p.name), setEditing(null))}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
                        className="w-full bg-transparent text-sm text-fg outline-none"
                      />
                    ) : (
                      <button type="button" onDoubleClick={() => setEditing(p.id)} onClick={() => openProject(p.id)} className="block w-full truncate text-left text-sm text-fg" title="Double-click to rename">
                        {p.name}
                      </button>
                    )}
                    <span className="font-mono text-2xs text-faint">
                      {area(p).toFixed(1)} m² · {p.levels.length} floor{p.levels.length === 1 ? '' : 's'} · {p.objects.filter((o) => !o.parentId).length} pieces
                    </span>
                  </div>
                  <IconButton size="sm" aria-label={`Delete ${p.name}`} className="opacity-0 group-hover:opacity-100" onClick={() => confirm(`Delete “${p.name}”? This can't be undone.`) && closeProject(p.id)}>
                    <Trash2 className="size-3" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
