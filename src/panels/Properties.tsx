import { useEffect, useState } from 'react'
import { SPACE_PRESETS, findPreset } from '@/generation/spaces'
import type { ProviderId, Quality } from '@/generation/types'
import { actions } from '@/lib/actions'
import { useActiveProject, useWorkspace, type PropertyTab } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'
import { Button, Field, Select, Slider, Toggle, inputCls } from '@/ui/primitives'

const CUSTOM = '__custom'

function GenerateTab() {
  const s = useWorkspace((st) => st.settings)
  const update = useWorkspace((st) => st.updateSettings)
  const preset = findPreset(s.spaceId)

  return (
    <div className="space-y-2.5 p-3">
      <Field label="Backend">
        <Select<ProviderId>
          value={s.providerId}
          onChange={(providerId) => update({ providerId })}
          options={[
            { value: 'hf-space', label: 'Hugging Face Space' },
            { value: 'local-worker', label: 'Local GPU worker' },
          ]}
        />
      </Field>

      {s.providerId === 'hf-space' ? (
        <>
          <Field label="Model" hint={preset?.note ?? 'Any Gradio Space that outputs a .glb.'}>
            <Select
              value={preset ? s.spaceId : CUSTOM}
              onChange={(v) => update({ spaceId: v === CUSTOM ? '' : v })}
              options={[...SPACE_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: CUSTOM, label: 'Custom Space…' }]}
            />
          </Field>
          {!preset && (
            <Field label="Space id">
              <input className={inputCls} placeholder="user/space" value={s.spaceId} onChange={(e) => update({ spaceId: e.target.value.trim() })} />
            </Field>
          )}
          <Field label="HF token" hint="Optional. Raises your free GPU quota. Stored only in this browser.">
            <input className={inputCls} type="password" placeholder="hf_…" value={s.hfToken} onChange={(e) => update({ hfToken: e.target.value })} autoComplete="off" />
          </Field>
        </>
      ) : (
        <Field label="Worker URL" hint="Run worker/ with Docker on a machine with an NVIDIA GPU.">
          <input className={inputCls} value={s.workerUrl} onChange={(e) => update({ workerUrl: e.target.value })} />
        </Field>
      )}

      <div className="h-px bg-line" />

      <Field label="Quality">
        <Select<Quality>
          value={s.quality}
          onChange={(quality) => update({ quality })}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'standard', label: 'Standard' },
            { value: 'high', label: 'High' },
          ]}
        />
      </Field>
      <Field label="Remove BG">
        <Toggle checked={s.removeBackground} onChange={(removeBackground) => update({ removeBackground })} />
      </Field>
      <Field label="Seed" hint="Empty = random">
        <input
          className={inputCls}
          inputMode="numeric"
          placeholder="Random"
          value={s.seed ?? ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            update({ seed: Number.isFinite(n) ? n : null })
          }}
        />
      </Field>
    </div>
  )
}

function ObjectTab() {
  const selectedId = useWorkspace((s) => s.selectedId)
  const project = useActiveProject()
  const obj = project.objects.find((o) => o.id === selectedId)
  const updateObject = useWorkspace((s) => s.updateObject)
  const [, force] = useState(0)

  // Transform readout is imperative (gizmo moves the object directly), so poll lightly while open.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [])

  if (!obj) return <p className="p-3 text-xs text-dim">Nothing selected.</p>
  const o3 = viewport.objects.get(obj.id)
  const vec = (label: string, v: { x: number; y: number; z: number } | undefined, digits = 3) => (
    <Field label={label}>
      <div className="grid grid-cols-3 gap-1 font-mono text-2xs tabular">
        {(['x', 'y', 'z'] as const).map((k) => (
          <span key={k} className="flex h-6 items-center gap-1 rounded border border-line-strong bg-app/60 px-1.5 text-fg">
            <span className={k === 'x' ? 'text-axis-x' : k === 'y' ? 'text-axis-y' : 'text-axis-z'}>{k.toUpperCase()}</span>
            {(v?.[k] ?? 0).toFixed(digits)}
          </span>
        ))}
      </div>
    </Field>
  )
  const deg = o3 ? { x: (o3.rotation.x * 180) / Math.PI, y: (o3.rotation.y * 180) / Math.PI, z: (o3.rotation.z * 180) / Math.PI } : undefined

  return (
    <div className="space-y-2.5 p-3">
      <Field label="Name">
        <input className={inputCls} value={obj.name} onChange={(e) => updateObject(obj.id, { name: e.target.value })} />
      </Field>
      {vec('Location', o3?.position)}
      {vec('Rotation', deg, 1)}
      {vec('Scale', o3?.scale)}
      <div className="h-px bg-line" />
      <Field label="Source">
        <span className="block truncate text-xs text-fg">{obj.source}</span>
      </Field>
      <Field label="Triangles">
        <span className="font-mono text-2xs tabular text-fg">{obj.stats?.triangles.toLocaleString('en-US') ?? '—'}</span>
      </Field>
      <div className="flex gap-1.5 pt-1">
        <Button className="flex-1" onClick={actions.exportSelected}>
          Export GLB
        </Button>
        <Button variant="ghost" onClick={actions.deleteSelected}>
          Delete
        </Button>
      </div>
    </div>
  )
}

function RenderTab() {
  const s = useWorkspace((st) => st.settings)
  const update = useWorkspace((st) => st.updateSettings)
  return (
    <div className="space-y-2.5 p-3">
      <Field label="Exposure">
        <Slider value={s.exposure} min={0.2} max={2.5} onChange={(exposure) => update({ exposure })} />
      </Field>
      <Field label="Environment">
        <Slider value={s.envIntensity} min={0} max={3} onChange={(envIntensity) => update({ envIntensity })} />
      </Field>
      <div className="h-px bg-line" />
      <Button variant="primary" className="w-full" onClick={actions.renderImage}>
        Render Image · F12
      </Button>
      <p className="text-2xs leading-snug text-faint">Renders the current view at 2× resolution without grid or gizmos.</p>
    </div>
  )
}

export function PropertiesPanel({ tab }: { tab: Exclude<PropertyTab, null> }) {
  if (tab === 'generate') return <GenerateTab />
  if (tab === 'object') return <ObjectTab />
  return <RenderTab />
}
