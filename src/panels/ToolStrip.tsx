import { Aperture, Focus, Maximize2, Move, MousePointer2, RotateCw, Scaling } from 'lucide-react'
import type { ReactNode } from 'react'
import { actions } from '@/lib/actions'
import { useWorkspace, type Tool } from '@/store/workspace'
import { IconButton, Tooltip } from '@/ui/primitives'

const TOOLS: { id: Tool; label: string; key: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Select', key: 'Q', icon: <MousePointer2 className="size-3.5" /> },
  { id: 'translate', label: 'Move', key: 'G', icon: <Move className="size-3.5" /> },
  { id: 'rotate', label: 'Rotate', key: 'R', icon: <RotateCw className="size-3.5" /> },
  { id: 'scale', label: 'Scale', key: 'S', icon: <Scaling className="size-3.5" /> },
]

const Divider = () => <div className="mx-auto my-1 h-px w-5 bg-line-strong" />

export function ToolStrip() {
  const tool = useWorkspace((s) => s.tool)
  const setTool = useWorkspace((s) => s.setTool)
  return (
    <div className="flex w-10 shrink-0 flex-col items-center gap-0.5 rounded-lg bg-panel py-1.5">
      {TOOLS.map((t) => (
        <Tooltip key={t.id} label={t.label} shortcut={t.key}>
          <IconButton active={tool === t.id} aria-label={t.label} onClick={() => setTool(t.id)}>
            {t.icon}
          </IconButton>
        </Tooltip>
      ))}
      <Divider />
      <Tooltip label="Frame Selected" shortcut="F">
        <IconButton aria-label="Frame selected" onClick={actions.frameSelected}>
          <Focus className="size-3.5" />
        </IconButton>
      </Tooltip>
      <Tooltip label="Frame All" shortcut="Home">
        <IconButton aria-label="Frame all" onClick={actions.frameAll}>
          <Maximize2 className="size-3.5" />
        </IconButton>
      </Tooltip>
      <Divider />
      <Tooltip label="Render Image" shortcut="F12">
        <IconButton aria-label="Render image" onClick={actions.renderImage}>
          <Aperture className="size-3.5" />
        </IconButton>
      </Tooltip>
    </div>
  )
}
