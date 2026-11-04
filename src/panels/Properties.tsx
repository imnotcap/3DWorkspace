import { Lock, Unlock } from 'lucide-react'
import { useRef, useState } from 'react'
import ScrubField from '@/components/reactbits/ScrubField'
import { SPACE_PRESETS, findPreset } from '@/generation/spaces'
import type { ProviderId, Quality } from '@/generation/types'
import { actions } from '@/lib/actions'
import { scaleForSize, useActiveProject, useWorkspace, type MaterialOverride, type PropertyTab, type RealSize, type SceneObject, type ShadeMode, type Vec3 } from '@/store/workspace'
import { MATERIAL_PRESETS } from '@/viewport/materialPresets'
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
            { value: 'photogrammetry', label: 'Photogrammetry · exact' },
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
      ) : s.providerId === 'photogrammetry' ? (
        <Field label="Worker URL" hint="Measures the real object from 30–80 photos taken all around it. Runs on any computer (CPU). Set Real size for exact scale.">
          <input className={inputCls} value={s.photogrammetryUrl} onChange={(e) => update({ photogrammetryUrl: e.target.value })} />
        </Field>
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
            { value: 'ultra', label: 'Ultra · slow' },
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
  const { updateObject, checkpoint, commit } = useWorkspace.getState()
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
      {obj.stats?.size && (
        <DimensionsField
          base={obj.stats.size}
          scale={t.scale}
          realSize={project.realSize}
          onChange={(scale) => set({ scale })}
          onCommit={done}
          onApply={() => project.realSize && commit('Real size', obj.id, { transform: { ...t, scale: scaleForSize(obj.stats!.size, project.realSize, t.scale) } })}
        />
      )}
      <div className="h-px bg-line" />
      <Field label="Shading">
        <Segmented<ShadeMode>
          value={obj.shade}
          onChange={(shade) => commit('Shading', obj.id, { shade })}
          options={[
            { value: 'original', label: 'As made' },
            { value: 'smooth', label: 'Smooth' },
            { value: 'auto', label: 'Auto' },
          ]}
        />
      </Field>
      <MaterialSection obj={obj} />
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

const RES_PRESETS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'uhd', label: '4K UHD · 3840×2160', w: 3840, h: 2160 },
  { id: 'sq4k', label: 'Square 4K · 4096×4096', w: 4096, h: 4096 },
  { id: 'qhd', label: '1440p · 2560×1440', w: 2560, h: 1440 },
  { id: 'fhd', label: '1080p · 1920×1080', w: 1920, h: 1080 },
  { id: 'sq2k', label: 'Square 2K · 2048×2048', w: 2048, h: 2048 },
  { id: 'portrait', label: 'Portrait 4K · 2160×3840', w: 2160, h: 3840 },
]

function RenderTab() {
  const s = useWorkspace((st) => st.settings)
  const update = useWorkspace((st) => st.updateSettings)
  const cameraView = useWorkspace((st) => st.cameraView)
  const project = useActiveProject()
  const front = project.images.find((i) => i.view === 'front')
  const preset = RES_PRESETS.find((p) => p.w === s.renderWidth && p.h === s.renderHeight)?.id ?? 'custom'
  const focal = project.camera?.focal ?? 50
  const keyed = project.animation.keys.length > 0

  const matchPhoto = () => {
    if (!front) return
    const img = new Image()
    img.onload = () => {
      // Photo aspect at 4K on the long edge; H.264 wants even sizes.
      const scale = 3840 / Math.max(img.naturalWidth, img.naturalHeight)
      const even = (n: number) => Math.round((n * scale) / 2) * 2
      update({ renderWidth: even(img.naturalWidth), renderHeight: even(img.naturalHeight), refOpacity: s.refOpacity || 0.4 })
      useWorkspace.getState().setCameraView(true)
    }
    img.src = front.url
  }

  return (
    <div className="space-y-2.5 p-3">
      <Field label="Resolution">
        <Select
          value={preset}
          onChange={(id) => {
            const p = RES_PRESETS.find((x) => x.id === id)
            if (p) update({ renderWidth: p.w, renderHeight: p.h })
          }}
          options={[...RES_PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(preset === 'custom' ? [{ value: 'custom', label: `Custom · ${s.renderWidth}×${s.renderHeight}` }] : [])]}
        />
      </Field>
      <Field label="Size">
        <div className="grid grid-cols-2 gap-1">
          <ScrubField label="W" suffix="" value={s.renderWidth} min={256} max={8192} step={2} size="sm" showDelta={false} rubberReach={0} chipColor="#0d0d0d" accent="#4c8dff" className="!h-6.5 !w-full font-mono !text-2xs" onChange={(renderWidth) => update({ renderWidth })} />
          <ScrubField label="H" suffix="" value={s.renderHeight} min={256} max={8192} step={2} size="sm" showDelta={false} rubberReach={0} chipColor="#0d0d0d" accent="#4c8dff" className="!h-6.5 !w-full font-mono !text-2xs" onChange={(renderHeight) => update({ renderHeight })} />
        </div>
      </Field>
      <Field label="Transparent" hint="PNG with alpha. Videos are always opaque.">
        <Toggle checked={s.transparent} onChange={(transparent) => update({ transparent })} />
      </Field>

      <div className="h-px bg-line" />
      <Field label="Camera" hint={project.camera || keyed ? undefined : 'Auto: front three-quarter, slightly above.'}>
        <div className="flex gap-1">
          <Button className="flex-1 px-2" onClick={actions.cameraFromView}>
            From View
          </Button>
          <Button variant={cameraView ? 'primary' : 'default'} className="px-2" onClick={actions.toggleCameraView}>
            Look · 0
          </Button>
        </div>
      </Field>
      <Field label="Focal length">
        <ScrubField label="mm" suffix="" value={focal} min={12} max={200} step={1} size="sm" showDelta={false} rubberReach={0} chipColor="#0d0d0d" accent="#4c8dff" className="!h-6.5 !w-full font-mono !text-2xs" onChange={actions.setFocal} />
      </Field>
      {project.camera && (
        <Button variant="ghost" className="ml-[100px] h-6 px-2" onClick={actions.resetCamera}>
          Reset to auto framing
        </Button>
      )}
      {front && (
        <>
          <Field label="Reference" hint="Overlay the Front photo in camera view to match its angle.">
            <Slider value={s.refOpacity} min={0} max={1} onChange={(refOpacity) => update({ refOpacity })} />
          </Field>
          <Button variant="ghost" className="ml-[100px] h-6 px-2" onClick={matchPhoto}>
            Match photo aspect
          </Button>
        </>
      )}

      <div className="h-px bg-line" />
      <Field label="Exposure">
        <Slider value={s.exposure} min={0.2} max={2.5} onChange={(exposure) => update({ exposure })} />
      </Field>
      <Field label="Environment">
        <Slider value={s.envIntensity} min={0} max={3} onChange={(envIntensity) => update({ envIntensity })} />
      </Field>
      <div className="h-px bg-line" />
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="primary" onClick={actions.renderImage}>
          Image · F12
        </Button>
        <Button onClick={actions.renderAnimation}>Animation · ⌃F12</Button>
      </div>
    </div>
  )
}

/** Blender's Dimensions: bounding-box size in cm. Locked = edit one axis, scale all proportionally. */
function DimensionsField({ base, scale, realSize, onChange, onCommit, onApply }: {
  base: Vec3
  scale: Vec3
  realSize: RealSize | null
  onChange: (scale: Vec3) => void
  onCommit: () => void
  onApply: () => void
}) {
  const [locked, setLocked] = useState(true)
  const cm = base.map((b, i) => +(b * scale[i] * 100).toFixed(1)) as Vec3
  return (
    <>
      <VecField
        label="Size (cm)"
        value={cm}
        step={1}
        min={0.1}
        max={100000}
        suffix=""
        onChange={(next) => {
          const i = next.findIndex((v, k) => v !== cm[k])
          if (i < 0 || base[i] <= 0) return
          if (locked) {
            const f = next[i] / cm[i]
            onChange(scale.map((v) => v * f) as Vec3)
          } else {
            const s = [...scale] as Vec3
            s[i] = next[i] / 100 / base[i]
            onChange(s)
          }
        }}
        onCommit={onCommit}
      />
      <div className="ml-[100px] flex items-center gap-2">
        <button type="button" onClick={() => setLocked(!locked)} className="flex items-center gap-1 text-2xs text-dim hover:text-fg">
          {locked ? <Lock className="size-3" /> : <Unlock className="size-3" />} {locked ? 'Proportional' : 'Free'}
        </button>
        {realSize && (
          <Button variant="ghost" className="h-6 whitespace-nowrap px-2" onClick={onApply}>
            Apply real size
          </Button>
        )}
      </div>
    </>
  )
}

function MaterialSection({ obj }: { obj: SceneObject }) {
  const commit = useWorkspace((s) => s.commit)
  const update = useWorkspace((s) => s.updateObject)
  const m = obj.material
  const base: MaterialOverride = m ?? { color: '#bcbcbc', roughness: 0.5, metalness: 0, keepTexture: true }
  const set = (patch: Partial<MaterialOverride>, undoable = false) =>
    undoable ? commit('Material', obj.id, { material: { ...base, ...patch } }) : update(obj.id, { material: { ...base, ...patch } })

  return (
    <>
      <Field label="Material">
        <Select
          value={m ? 'custom' : 'generated'}
          onChange={(v) => {
            if (v === 'generated') return commit('Material', obj.id, { material: null })
            const p = MATERIAL_PRESETS.find((x) => x.name === v)
            if (p) commit('Material', obj.id, { material: { ...p.m, keepTexture: false } })
            else set({}, true)
          }}
          options={[
            { value: 'generated', label: 'As generated' },
            { value: 'custom', label: 'Custom' },
            ...MATERIAL_PRESETS.map((p) => ({ value: p.name, label: p.name })),
          ]}
        />
      </Field>
      {m && (
        <>
          <Field label="Base color">
            <div className="flex items-center gap-1.5">
              <input type="color" value={m.color} onChange={(e) => set({ color: e.target.value })} className="h-6.5 w-9 cursor-pointer rounded-md border border-line-strong bg-transparent p-0.5" />
              <input className={inputCls} value={m.color} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && set({ color: e.target.value })} />
            </div>
          </Field>
          <Field label="Roughness">
            <Slider value={m.roughness} min={0} max={1} onChange={(roughness) => set({ roughness })} />
          </Field>
          <Field label="Metallic">
            <Slider value={m.metalness} min={0} max={1} onChange={(metalness) => set({ metalness })} />
          </Field>
          <Field label="Keep texture" hint="Tint the generated texture instead of replacing it.">
            <Toggle checked={m.keepTexture} onChange={(keepTexture) => set({ keepTexture }, true)} />
          </Field>
        </>
      )}
    </>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="grid rounded-md border border-line-strong bg-app/60 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`h-5.5 rounded text-2xs transition-colors ${o.value === value ? 'bg-active text-fg' : 'text-dim hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PropertiesPanel({ tab }: { tab: Exclude<PropertyTab, null> }) {
  if (tab === 'generate') return <GenerateTab />
  if (tab === 'object') return <ObjectTab />
  return <RenderTab />
}
