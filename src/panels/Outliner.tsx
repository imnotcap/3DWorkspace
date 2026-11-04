import { Box, Camera, CameraOff, ChevronDown, ChevronRight, Eye, EyeOff, Folder, Layers, Search, Shapes } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { ancestorIds, useActiveProject, useWorkspace, type SceneObject } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'

/**
 * Scene tree. A SAM 3D model is a row you can open (the chevron) to reach its folders and parts;
 * click any row to select it and move or edit just that piece.
 */
export function Outliner() {
  const project = useActiveProject()
  const selectedId = useWorkspace((s) => s.selectedId)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(true)
  // Models start open; this records the ones you closed.
  const [closed, setClosed] = useState<Set<string>>(() => new Set())

  const children = useMemo(() => {
    const ids = new Set(project.objects.map((o) => o.id))
    const map = new Map<string | null, SceneObject[]>()
    for (const o of project.objects) {
      const key = o.parentId && ids.has(o.parentId) ? o.parentId : null
      map.set(key, [...(map.get(key) ?? []), o])
    }
    return map
  }, [project.objects])

  // Search keeps matching rows plus the models and folders that contain them.
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!q) return null
    const keep = new Set<string>()
    for (const o of project.objects)
      if (o.name.toLowerCase().includes(q)) {
        keep.add(o.id)
        ancestorIds(project.objects, o.id).forEach((a) => keep.add(a))
      }
    return keep
  }, [q, project.objects])

  // The selected part's model and folders open so its row is visible.
  const forcedOpen = useMemo(() => new Set(selectedId ? ancestorIds(project.objects, selectedId) : []), [selectedId, project.objects])

  const toggle = (id: string) =>
    setClosed((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const rows: { o: SceneObject; depth: number; expanded: boolean; hasKids: boolean }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const o of children.get(parent) ?? []) {
      if (shown && !shown.has(o.id)) continue
      const hasKids = !!children.get(o.id)?.length
      const expanded = hasKids && (!!shown || forcedOpen.has(o.id) || !closed.has(o.id))
      rows.push({ o, depth, expanded, hasKids })
      if (expanded) walk(o.id, depth + 1)
    }
  }
  walk(null, 0)

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
          <span className="pr-1 font-mono text-2xs text-faint">{children.get(null)?.length ?? 0}</span>
        </div>

        {open && rows.map(({ o, depth, expanded, hasKids }) => <Row key={o.id} o={o} depth={depth} expanded={expanded} hasKids={hasKids} selected={o.id === selectedId} onToggle={() => toggle(o.id)} count={children.get(o.id)?.length ?? 0} />)}

        {open && project.objects.length === 0 && <p className="ml-7 py-1 text-2xs text-faint">Empty</p>}
      </div>
    </div>
  )
}

function Row({ o, depth, expanded, hasKids, selected, onToggle, count }: { o: SceneObject; depth: number; expanded: boolean; hasKids: boolean; selected: boolean; onToggle: () => void; count: number }) {
  const { select, updateObject } = useWorkspace.getState()
  const [editing, setEditing] = useState(false)
  const Icon = o.isGroup ? (o.parentId ? Folder : Box) : Shapes
  return (
    <div
      onPointerDown={() => select(o.id)}
      onDoubleClick={() => setEditing(true)}
      data-outliner-row={o.name}
      className={cn(
        'group relative ml-3 flex h-5.5 items-center gap-1.5 rounded pr-1 text-xs',
        selected ? 'bg-active text-fg' : 'text-fg/90 hover:bg-hover/60',
        !o.visible && 'text-faint',
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      <span className="absolute left-0 top-0 h-full w-px bg-line-strong" />
      {hasKids ? (
        <button
          type="button"
          aria-label={expanded ? `Collapse ${o.name}` : `Expand ${o.name}`}
          aria-expanded={expanded}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggle}
          className="grid size-3.5 shrink-0 place-items-center rounded text-dim hover:text-fg"
        >
          <ChevronRight className={cn('size-3 transition-transform duration-150', expanded && 'rotate-90')} />
        </button>
      ) : (
        <span className="size-3.5 shrink-0" />
      )}
      <Icon className={cn('size-3 shrink-0', selected ? 'text-accent' : 'text-dim')} />
      {editing ? (
        <input
          autoFocus
          defaultValue={o.name}
          onBlur={(e) => (updateObject(o.id, { name: e.target.value.trim() || o.name }), setEditing(false))}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      ) : (
        <span className="flex-1 truncate" title={o.error}>
          {o.name}
          {o.isGroup && <span className="ml-1.5 font-mono text-2xs text-faint">{count}</span>}
          {o.error && <span className="ml-1.5 text-2xs text-danger">{o.error}</span>}
        </span>
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
}
