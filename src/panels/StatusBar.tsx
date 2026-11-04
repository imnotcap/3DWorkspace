import { useActiveProject, useWorkspace } from '@/store/workspace'

const Hint = ({ k, label }: { k: string; label: string }) => (
  <span className="flex items-center gap-1.5">
    <kbd className="rounded border border-line-strong px-1 font-mono text-[9.5px] leading-3.5 text-dim">{k}</kbd>
    {label}
  </span>
)

export function StatusBar() {
  const settings = useWorkspace((s) => s.settings)
  const selectedId = useWorkspace((s) => s.selectedId)
  const project = useActiveProject()
  const selected = project.objects.find((o) => o.id === selectedId)
  const backend = settings.providerId === 'hf-space' ? settings.spaceId || 'No Space set' : settings.workerUrl

  return (
    <div className="flex h-6 shrink-0 items-center gap-5 px-3 text-2xs text-faint">
      <Hint k="LMB" label="Orbit" />
      <Hint k="⇧ Drag" label="Pan" />
      <Hint k="Wheel" label="Zoom" />
      <Hint k="F" label="Frame" />
      <div className="flex-1" />
      {selected && <span className="text-dim">{selected.name}</span>}
      <span className="font-mono">{backend}</span>
    </div>
  )
}
