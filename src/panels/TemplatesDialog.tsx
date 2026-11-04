import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { TEMPLATES } from '@/plan/templates'
import { useActiveProject, useWorkspace } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'
import { IconButton } from '@/ui/primitives'

/** Start from a furnished home (replaces this project's plan; undo brings it back). */
export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const project = useActiveProject()
  const hasWork = project.walls.length > 0 || project.objects.length > 0
  const load = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)!
    useWorkspace.getState().loadTemplate(t.build())
    onClose()
    setTimeout(() => (viewport.fitPlan(), viewport.frameAll()), 50)
  }
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Templates" className="w-full max-w-2xl rounded-xl border border-white/[0.06] bg-panel p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg">Start from a template</h2>
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="size-3.5" />
          </IconButton>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" onClick={() => load(t.id)} className="flex flex-col gap-1.5 rounded-lg border border-line-strong bg-app/50 p-3 text-left transition-colors hover:border-accent">
              <span className="text-xs font-medium text-fg">{t.name}</span>
              <span className="text-2xs leading-snug text-dim">{t.description}</span>
            </button>
          ))}
        </div>
        {hasWork && <p className="mt-3 text-2xs text-faint">This replaces the plan and furniture in “{project.name}”. Undo (⌘Z) brings them back.</p>}
      </div>
    </div>,
    document.body,
  )
}
