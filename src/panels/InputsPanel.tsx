import { AnimatePresence, motion } from 'motion/react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { findPreset } from '@/generation/spaces'
import type { ViewTag } from '@/generation/types'
import { actions } from '@/lib/actions'
import { cn } from '@/lib/cn'
import { useActiveProject, useWorkspace } from '@/store/workspace'
import { Button, IconButton, SectionTitle, ease } from '@/ui/primitives'

const VIEWS: ViewTag[] = ['auto', 'front', 'back', 'left', 'right']

export function InputsPanel() {
  const project = useActiveProject()
  const job = useWorkspace((s) => s.job)
  const settings = useWorkspace((s) => s.settings)
  const { setImageView, removeImage, clearImages, setPropertyTab } = useWorkspace.getState()
  const [over, setOver] = useState(false)
  const running = job.status === 'running'
  const preset = settings.providerId === 'hf-space' ? findPreset(settings.spaceId) : undefined
  const singleOnly = preset && !preset.multiView

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
            {project.images.map((img, i) => (
              <motion.div
                key={img.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: singleOnly && i > 0 ? 0.35 : 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.16, ease }}
                className="group relative aspect-square overflow-hidden rounded-md border border-line-strong bg-app"
              >
                <img src={img.url} alt="" draggable={false} className="size-full object-cover" />
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
                  className="absolute inset-x-1 bottom-1 h-4.5 appearance-none rounded bg-black/75 px-1 text-center text-2xs capitalize text-fg outline-none backdrop-blur"
                >
                  {VIEWS.map((v) => (
                    <option key={v} value={v} className="bg-panel-2">
                      {v}
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
        {singleOnly && project.images.length > 1 && (
          <p className="mt-2 text-2xs leading-snug text-faint">{preset.label} uses one image. Switch to Hunyuan3D-2mv to use all views.</p>
        )}
      </div>

      <div className="flex gap-1.5 border-t border-line p-2">
        <Button variant="ghost" className="px-2" onClick={() => setPropertyTab('generate')}>
          Settings
        </Button>
        <Button variant="primary" className="flex-1" disabled={running || project.images.length === 0} onClick={actions.generate}>
          {running ? 'Generating…' : 'Generate Mesh'}
        </Button>
      </div>
    </div>
  )
}
