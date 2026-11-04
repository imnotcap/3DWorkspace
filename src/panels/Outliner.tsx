import { Camera, CameraOff, ChevronDown, Eye, EyeOff, Layers, Search, Shapes } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { useActiveProject, useWorkspace } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'

export function Outliner() {
  const project = useActiveProject()
  const selectedId = useWorkspace((s) => s.selectedId)
  const { select, updateObject } = useWorkspace.getState()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const objects = project.objects.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 p-1.5">
        <span className="grid size-6.5 place-items-center rounded-md bg-raised text-dim">
          <Layers className="size-3.5" />
        </span>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-6.5 w-full rounded-md bg-raised pl-6.5 pr-2 text-xs text-fg outline-none placeholder:text-faint focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        <div className="flex h-5.5 items-center gap-1 rounded px-1 text-xs text-fg hover:bg-hover/60" onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={cn('size-3 text-dim transition-transform duration-150', !open && '-rotate-90')} />
          <span className="flex-1">Scene Collection</span>
          <span className="pr-1 font-mono text-2xs text-faint">{project.objects.length}</span>
        </div>

        {open &&
          objects.map((o) => {
            const sel = o.id === selectedId
            return (
              <div
                key={o.id}
                onPointerDown={() => select(o.id)}
                onDoubleClick={() => setEditing(o.id)}
                className={cn(
                  'group relative ml-3 flex h-5.5 items-center gap-1.5 rounded pl-3 pr-1 text-xs',
                  sel ? 'bg-active text-fg' : 'text-fg/90 hover:bg-hover/60',
                  !o.visible && 'text-faint',
                )}
              >
                <span className="absolute left-0 top-0 h-full w-px bg-line-strong" />
                <Shapes className={cn('size-3 shrink-0', sel ? 'text-accent' : 'text-dim')} />
                {editing === o.id ? (
                  <input
                    autoFocus
                    defaultValue={o.name}
                    onBlur={(e) => (updateObject(o.id, { name: e.target.value.trim() || o.name }), setEditing(null))}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
                    className="min-w-0 flex-1 bg-transparent outline-none"
                  />
                ) : (
                  <span className="flex-1 truncate">{o.name}</span>
                )}
                <button
                  type="button"
                  aria-label="Toggle in renders"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => updateObject(o.id, { renderable: !o.renderable })}
                  className="grid size-4.5 place-items-center rounded text-faint hover:text-fg"
                >
                  {o.renderable ? <Camera className="size-3" /> : <CameraOff className="size-3" />}
                </button>
                <button
                  type="button"
                  aria-label="Toggle visibility"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    updateObject(o.id, { visible: !o.visible })
                    viewport.invalidate()
                  }}
                  className="grid size-4.5 place-items-center rounded text-dim hover:text-fg"
                >
                  {o.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </button>
              </div>
            )
          })}

        {open && project.objects.length === 0 && <p className="ml-7 py-1 text-2xs text-faint">Empty</p>}
      </div>
    </div>
  )
}
