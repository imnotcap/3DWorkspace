import { AnimatePresence, motion } from 'motion/react'
import { ImagePlus, Shapes, Trash2, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { ViewTag } from '@/generation/types'
import { actions } from '@/lib/actions'
import { cn } from '@/lib/cn'
import { useActiveProject, useWorkspace } from '@/store/workspace'
import { Button, IconButton, SectionTitle, ease, inputCls } from '@/ui/primitives'

const PartEditor = lazy(() => import('./PartEditor').then((m) => ({ default: m.PartEditor })))

const VIEWS: { id: ViewTag; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'detail', label: 'Detail' },
]

export function InputsPanel() {
  const project = useActiveProject()
  const job = useWorkspace((s) => s.job)
  const { setImageView, removeImage, clearImages, setPropertyTab, setPrompt } = useWorkspace.getState()
  const [over, setOver] = useState(false)
  const [editing, setEditing] = useState(false)
  const running = job.status === 'running'
  const hasFront = project.images.some((i) => i.view === 'front')
  const others = project.images.some((i) => i.view !== 'front')
  const seg = project.segmentation
  // SAM 3D builds from the Front photo; the others stay as your reference.
  const used = (v: ViewTag) => v === 'front'

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        actions.handleDrop([...e.dataTransfer.files])
      }}
    >
      <SectionTitle
        right={
          project.images.length > 0 && (
            <IconButton size="sm" aria-label="Clear inputs" onClick={clearImages}>
              <Trash2 className="size-3" />
            </IconButton>
          )
        }
      >
        Inputs · {project.images.length}
      </SectionTitle>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <div className="grid grid-cols-3 gap-1.5">
          <AnimatePresence initial={false}>
            {project.images.map((img) => (
              <motion.div
                key={img.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.16, ease }}
                className={cn(
                  'group relative aspect-square overflow-hidden rounded-md border bg-app',
                  used(img.view) ? 'border-line-strong' : 'border-dashed border-line-strong',
                  img.view === 'front' && 'border-accent/70',
                )}
              >
                <img src={img.url} alt="" draggable={false} className={cn('size-full object-cover', !used(img.view) && 'opacity-45')} />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() => removeImage(img.id)}
                  className="absolute right-1 top-1 grid size-4.5 place-items-center rounded bg-black/70 text-dim opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
                <select
                  value={img.view}
                  onChange={(e) => setImageView(img.id, e.target.value as ViewTag)}
                  aria-label="Image role"
                  className={cn(
                    'absolute inset-x-1 bottom-1 h-4.5 appearance-none rounded px-1 text-center text-2xs outline-none backdrop-blur',
                    img.view === 'front' ? 'bg-accent text-white' : 'bg-black/75 text-fg',
                  )}
                >
                  {VIEWS.map((v) => (
                    <option key={v.id} value={v.id} className="bg-panel-2 text-fg">
                      {v.label}
                    </option>
                  ))}
                </select>
              </motion.div>
            ))}
          </AnimatePresence>
          <button
            type="button"
            onClick={actions.addImages}
            className={cn(
              'grid aspect-square place-items-center rounded-md border border-dashed text-faint transition-colors duration-100 hover:border-dim hover:text-dim',
              over ? 'border-accent text-accent' : 'border-line-strong',
            )}
          >
            <ImagePlus className="size-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="mt-2.5 space-y-1.5">
          <label className="block">
            <span className="mb-1 block text-2xs font-medium uppercase tracking-[0.08em] text-faint">What is it?</span>
            <input className={inputCls} placeholder="e.g. office chair" value={project.prompt.object} onChange={(e) => setPrompt({ object: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs font-medium uppercase tracking-[0.08em] text-faint">Parts</span>
            <input className={inputCls} placeholder="seat, backrest, armrest, wheel · or leave empty" value={project.prompt.parts} onChange={(e) => setPrompt({ parts: e.target.value })} />
          </label>
          <button
            type="button"
            disabled={!hasFront}
            onClick={() => setEditing(true)}
            className="flex h-7 w-full items-center gap-2 rounded-md border border-line-strong bg-app/60 px-2 text-left text-xs text-fg transition-colors hover:border-dim disabled:opacity-40"
          >
            <Shapes className="size-3.5 text-dim" />
            {seg ? (
              <>
                <span className="flex-1 truncate">
                  {seg.segments.filter((s) => s.enabled).length} of {seg.segments.length} parts
                </span>
                <span className="flex -space-x-0.5">
                  {seg.segments.slice(0, 8).map((s) => (
                    <span key={s.id} className="size-2 rounded-full ring-1 ring-panel" style={{ background: s.color, opacity: s.enabled ? 1 : 0.3 }} />
                  ))}
                </span>
                <span className="text-2xs text-dim">Edit</span>
              </>
            ) : (
              <>
                <span className="flex-1">Review parts</span>
                <span className="text-2xs text-faint">optional</span>
              </>
            )}
          </button>
        </div>

        <RealSizeRow />

        <div className="mt-2 space-y-1.5 text-2xs leading-snug text-faint">
          {project.images.length > 0 && !hasFront && <p className="text-warn">Tag one photo as Front: a full view of the whole object. SAM 3D builds from it.</p>}
          {hasFront && !seg && <p>Generate finds the parts with SAM 3 and builds each one with SAM 3D. Review them first to fix any part by clicking.</p>}
          {others && <p>Only the Front photo is used for 3D. The others stay here as your reference.</p>}
        </div>
      </div>
      {editing && (
        <Suspense fallback={null}>
          <PartEditor onClose={() => setEditing(false)} />
        </Suspense>
      )}

      <div className="flex gap-1.5 border-t border-line p-2">
        <Button variant="ghost" className="px-2" onClick={() => setPropertyTab('generate')}>
          Settings
        </Button>
        <Button variant="primary" className="flex-1" disabled={running || !hasFront} onClick={actions.generate}>
          {running ? 'Generating…' : 'Generate with SAM 3D'}
        </Button>
      </div>
    </div>
  )
}

/** Spec-sheet dimensions (cm). Generated meshes are scaled to exactly this box. */
function RealSizeRow() {
  const project = useActiveProject()
  const setRealSize = useWorkspace((s) => s.setRealSize)
  const rs = project.realSize ?? {}
  const field = (k: 'x' | 'y' | 'z', label: string) => (
    <label className="flex h-6.5 min-w-0 items-center gap-1 rounded-md border border-line-strong bg-app/60 px-1.5 focus-within:border-accent">
      <span className="text-2xs text-faint">{label}</span>
      <input
        inputMode="decimal"
        placeholder="—"
        value={rs[k] ? +(rs[k]! * 100).toFixed(1) : ''}
        onChange={(e) => {
          const cm = parseFloat(e.target.value.replace(',', '.'))
          const next = { ...rs, [k]: Number.isFinite(cm) && cm > 0 ? cm / 100 : undefined }
          setRealSize(next.x || next.y || next.z ? next : null)
        }}
        className="w-full min-w-0 bg-transparent text-right font-mono text-2xs text-fg outline-none placeholder:text-faint"
      />
    </label>
  )
  return (
    <div className="mt-2.5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">Real size · cm</span>
        <span className="text-2xs text-faint">from the spec sheet</span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {field('x', 'W')}
        {field('y', 'H')}
        {field('z', 'D')}
      </div>
    </div>
  )
}
