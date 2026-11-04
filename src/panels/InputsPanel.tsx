import { AnimatePresence, motion } from 'motion/react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { findPreset } from '@/generation/spaces'
import type { ViewTag } from '@/generation/types'
import { actions } from '@/lib/actions'
import { cn } from '@/lib/cn'
import { useActiveProject, useWorkspace } from '@/store/workspace'
import { Button, IconButton, SectionTitle, ease } from '@/ui/primitives'

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
  const settings = useWorkspace((s) => s.settings)
  const { setImageView, removeImage, clearImages, setPropertyTab } = useWorkspace.getState()
  const [over, setOver] = useState(false)
  const running = job.status === 'running'
  const preset = settings.providerId === 'hf-space' ? findPreset(settings.spaceId) : undefined
  const scan = settings.providerId === 'photogrammetry'
  // Claude reads every photo: full views for proportions, detail shots for small parts.
  const claude = settings.providerId === 'claude-parts'
  const multiView = settings.providerId === 'local-worker' || !preset || preset.multiView
  const hasFront = project.images.some((i) => i.view === 'front')
  const hasDetail = project.images.some((i) => i.view === 'detail')
  const unusedSides = !multiView && project.images.some((i) => i.view !== 'front' && i.view !== 'detail')

  // Which images will actually be sent: Front always; sides only for multi-view models.
  const used = (v: ViewTag) => scan || claude || v === 'front' || (multiView && v !== 'detail')
  const canGenerate = scan ? project.images.length >= 3 : hasFront

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
                {!scan && (
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
                )}
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

        <RealSizeRow />

        <div className="mt-2 space-y-1.5 text-2xs leading-snug text-faint">
          {scan ? (
            <p className={project.images.length < 30 ? 'text-warn' : undefined}>
              Photogrammetry uses every photo{project.images.length < 30 ? ` (${project.images.length} so far, 30–80 recommended)` : ''}. Walk all the way round, overlap each shot by about two thirds, add a higher ring, and keep the object filling most of the frame. Matte light, no motion blur.
            </p>
          ) : (
            <>
              {project.images.length > 0 && !hasFront && <p className="text-warn">Tag one image as Front: a full view of the whole object.</p>}
              {hasDetail && !claude && <p>Detail shots stay as reference and aren't used for geometry. Tag an image Back/Left/Right only if it shows the whole object from that side.</p>}
              {claude && <p>Claude uses every photo: Front and side views for proportions, Detail shots for small parts. Add the Real size for an exact result.</p>}
              {unusedSides && !claude && <p>{preset?.label} uses the Front image only. Choose Hunyuan3D-2mv to use side views too.</p>}
            </>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 border-t border-line p-2">
        <Button variant="ghost" className="px-2" onClick={() => setPropertyTab('generate')}>
          Settings
        </Button>
        <Button variant="primary" className="flex-1" disabled={running || !canGenerate} onClick={actions.generate}>
          {running ? (scan ? 'Reconstructing…' : 'Generating…') : scan ? 'Reconstruct' : 'Generate Mesh'}
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
