import { useRef } from 'react'
import ScrubField from '@/components/reactbits/ScrubField'
import { SPACE_PRESETS, findPreset } from '@/generation/spaces'
import type { ProviderId, Quality } from '@/generation/types'
import { actions } from '@/lib/actions'
import { useActiveProject, useWorkspace, type PropertyTab, type Vec3 } from '@/store/workspace'
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

const AXES = ['x', 'y', 'z'] as const
const AXIS_COLOR = { x: '#e5484d', y: '#46a758', z: '#3e63dd' }
const DEG = 180 / Math.PI

/** Three React Bits ScrubFields: drag to scrub (Shift coarse, Alt fine), click to type. */
function VecField({ label, value, onChange, onCommit, step, min, max, suffix = '' }: {
  label: string
  value: Vec3
  onChange: (v: Vec3) => void
  onCommit: () => void
  step: number
  min: number
  max: number
  suffix?: string
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-3 gap-1">
        {AXES.map((k, i) => (
          <ScrubField
            key={k}
            label={k.toUpperCase()}
            suffix={suffix}
            value={value[i]}
            min={min}
            max={max}
            step={step}
            size="sm"
            sensitivity={3}
            rubberReach={0}
            showFill={false}
            showDelta={false}
            accent={AXIS_COLOR[k]}
            chipColor="#0d0d0d"
            className="!h-6.5 !w-full !gap-0 !pr-1.5 font-mono !text-2xs [&_label]:!px-1 [&_label]:![color:var(--sf-accent)]"
            onChange={(n) => {
              const next = [...value] as Vec3
              next[i] = n
              onChange(next)
            }}
            onCommit={onCommit}
          />
        ))}
      </div>
    </Field>
  )
}

function ObjectTab() {
  const selectedId = useWorkspace((s) => s.selectedId)
  const project = useActiveProject()
  const obj = project.objects.find((o) => o.id === selectedId)
  const { updateObject, checkpoint } = useWorkspace.getState()
  // One undo step per scrub gesture: checkpoint on its first change, close it on commit.
  const editing = useRef(false)

  if (!obj) return <p className="p-3 text-xs text-dim">Nothing selected.</p>
  const t = obj.transform
  const set = (patch: Partial<typeof t>) => {
    if (!editing.current) {
      checkpoint('Transform')
      editing.current = true
    }
    updateObject(obj.id, { transform: { ...t, ...patch } })
  }
  const done = () => (editing.current = false)

  return (
    <div className="space-y-2.5 p-3">
      <Field label="Name">
        <input className={inputCls} value={obj.name} onChange={(e) => updateObject(obj.id, { name: e.target.value })} />
      </Field>
      <VecField label="Location" value={t.position} step={0.01} min={-1000} max={1000} onChange={(position) => set({ position })} onCommit={done} />
      <VecField
        label="Rotation"
        value={t.rotation.map((r) => +(r * DEG).toFixed(1)) as Vec3}
        step={0.5}
        min={-360}
        max={360}
        suffix="°"
        onChange={(deg) => set({ rotation: deg.map((d) => d / DEG) as Vec3 })}
        onCommit={done}
      />
      <VecField label="Scale" value={t.scale} step={0.01} min={0.01} max={100} onChange={(scale) => set({ scale })} onCommit={done} />
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
