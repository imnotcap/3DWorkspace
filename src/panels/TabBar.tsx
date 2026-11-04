import { motion } from 'motion/react'
import { Box, Menu as MenuIcon, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { actions } from '@/lib/actions'
import { cn } from '@/lib/cn'
import { useWorkspace } from '@/store/workspace'
import { IconButton, Menu } from '@/ui/primitives'

export function TabBar() {
  const projects = useWorkspace((s) => s.projects)
  const activeId = useWorkspace((s) => s.activeProjectId)
  const { setActiveProject, closeProject, addProject, renameProject } = useWorkspace.getState()
  const job = useWorkspace((s) => s.job)
  const undoLabel = useWorkspace((s) => s.past.at(-1)?.label)
  const redoLabel = useWorkspace((s) => s.future.at(-1)?.label)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 px-1.5">
      <Menu
        trigger={<MenuIcon className="size-3.5" />}
        className="h-7 px-1.5"
        items={[
          { label: 'New Project', shortcut: '⇧N', onSelect: addProject },
          { separator: true, label: '' },
          { label: undoLabel ? `Undo ${undoLabel}` : 'Undo', shortcut: '⌘Z', onSelect: useWorkspace.getState().undo, disabled: !undoLabel },
          { label: redoLabel ? `Redo ${redoLabel}` : 'Redo', shortcut: '⇧⌘Z', onSelect: useWorkspace.getState().redo, disabled: !redoLabel },
          { separator: true, label: '' },
          { label: 'Import GLB…', shortcut: '⌘I', onSelect: actions.importGlb },
          { label: 'Add Images…', onSelect: actions.addImages },
          { separator: true, label: '' },
          { label: 'Render Image', shortcut: 'F12', onSelect: actions.renderImage },
          { label: 'Export Selected (.glb)', shortcut: '⌘E', onSelect: actions.exportSelected },
        ]}
      />
      <div className="flex h-7 items-center gap-1 rounded-md bg-panel-2 px-2 text-dim">
        <Box className="size-3.5 text-fg" strokeWidth={1.75} />
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {projects.map((p) => {
          const active = p.id === activeId
          return (
            <div
              key={p.id}
              onPointerDown={() => setActiveProject(p.id)}
              onDoubleClick={() => setEditing(p.id)}
              className={cn(
                'group relative flex h-7 min-w-28 max-w-44 shrink-0 cursor-default items-center gap-2 rounded-md pl-2.5 pr-1 text-xs transition-colors duration-100',
                active ? 'text-fg' : 'text-dim hover:bg-panel-2 hover:text-fg',
              )}
            >
              {active && <motion.div layoutId="tab-active" className="absolute inset-0 rounded-md bg-raised" transition={{ type: 'spring', stiffness: 600, damping: 45 }} />}
              {editing === p.id ? (
                <input
                  autoFocus
                  defaultValue={p.name}
                  onBlur={(e) => (renameProject(p.id, e.target.value.trim() || p.name), setEditing(null))}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
                  className="relative z-10 w-full bg-transparent text-xs outline-none"
                />
              ) : (
                <span className="relative z-10 flex-1 truncate">{p.name}</span>
              )}
              <IconButton
                size="sm"
                aria-label={`Close ${p.name}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => closeProject(p.id)}
                className={cn('relative z-10', !active && 'opacity-0 group-hover:opacity-100')}
              >
                <X className="size-3" />
              </IconButton>
            </div>
          )
        })}
        <IconButton size="sm" aria-label="New project" onClick={addProject} className="ml-1 size-6">
          <Plus className="size-3.5" />
        </IconButton>
      </div>

      {job.status === 'running' && (
        <div className="flex h-7 items-center gap-2 rounded-md bg-panel-2 px-2.5 text-2xs text-dim">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/60" />
            <span className="size-1.5 rounded-full bg-accent" />
          </span>
          {job.message}
        </div>
      )}
    </div>
  )
}
