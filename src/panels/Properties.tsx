import { Diamond, Lock, Unlock } from 'lucide-react'
import { objectTransformAt } from '@/lib/anim'
import { useRef, useState } from 'react'
import ScrubField from '@/components/reactbits/ScrubField'
import { SPACE_PRESETS, findPreset } from '@/generation/spaces'
import type { ProviderId, Quality } from '@/generation/types'
import { actions } from '@/lib/actions'
import { scaleForSize, useActiveProject, useWorkspace, type PropertyTab, type RealSize, type SceneObject, type ShadeMode, type Vec3 } from '@/store/workspace'
import { PRIMITIVES, SHAPE_FIELDS, restingHeight } from '@/lib/primitives'
import { MaterialsSection } from './MaterialsSection'
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
            { value: 'claude-parts', label: 'Parts · Claude (exact)' },
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
      ) : s.providerId === 'claude-parts' ? (
        <>
          <Field label="API key" hint="From console.anthropic.com (your team's org). Stored only in this browser; sent only to api.anthropic.com.">
            <input className={inputCls} type="password" placeholder="sk-ant-…" value={s.anthropicKey} onChange={(e) => update({ anthropicKey: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Model">
            <Select
              value={s.claudeModel}
              onChange={(claudeModel) => update({ claudeModel })}
              options={[
                { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 · most accurate' },
                { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 · faster, half the price' },
              ]}
            />
          </Field>
          <Field label="Self-check" hint="Renders the result from the photo's angle and has Claude correct it. About twice the cost, noticeably more accurate.">
            <Toggle checked={s.claudeSelfCheck} onChange={(claudeSelfCheck) => update({ claudeSelfCheck })} />
          </Field>
          <p className="ml-[100px] text-2xs leading-snug text-faint">
            Builds hard-surface products (furniture, cases, appliances) from exact parts at real size, with materials. Typically ≈$0.20–0.80 per model on Opus 5.5. If Claude declines a request, it is retried on a fallback model automatically.
          </p>
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

      <div className="h-px bg-line" />
      <KeysSection />
    </div>
  )
}

/** This site has no keys of its own: every visitor brings theirs, kept in their browser only. */
function KeysSection() {
  const s = useWorkspace((st) => st.settings)
  const update = useWorkspace((st) => st.updateSettings)
  const forgetKeys = useWorkspace((st) => st.forgetKeys)
  const hasKeys = !!(s.hfToken || s.anthropicKey)
  return (
    <>
      <Field
        label="Your keys"
        hint={
          s.rememberKeys
            ? 'Saved in this browser on this device. Anyone using this browser profile can use them.'
            : 'Kept in memory only: gone when you close or reload the tab.'
        }
      >
        <label className="flex items-center gap-2 text-xs text-dim">
          <Toggle checked={s.rememberKeys} onChange={(rememberKeys) => update({ rememberKeys })} />
          Remember on this device
        </label>
      </Field>
      <p className="ml-[100px] text-2xs leading-snug text-faint">
        This site has no API keys of its own. Your keys are sent only to the service they belong to (Hugging Face or Anthropic), never to this site, and aren't saved with projects or exports.
      </p>
      {hasKeys && (
        <Button variant="ghost" className="ml-[100px] h-6 px-2" onClick={forgetKeys}>
          Forget my keys
        </Button>
      )}
    </>
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

  const frame = useWorkspace((s) => s.frame)

  if (!obj) return <p className="p-3 text-xs text-dim">Nothing selected.</p>
  // Keyed objects show (and edit) their value at the current frame; edits auto-key that frame.
  const t = objectTransformAt(obj, frame)
  const keyed = !!obj.keys?.length
  const onKey = obj.keys?.some((k) => k.frame === frame)
  const set = (patch: Partial<typeof t>) => {
    if (!editing.current) {
      checkpoint('Transform')
      editing.current = true
    }
    const transform = { ...t, ...patch }
    if (keyed) updateObject(obj.id, { transform, keys: [...obj.keys!.filter((k) => k.frame !== frame), { frame, transform }].sort((a, b) => a.frame - b.frame) })
    else updateObject(obj.id, { transform })
  }
  const done = () => (editing.current = false)

  return (
    <div className="space-y-2.5 p-3">
      <Field label="Name">
        <input className={inputCls} value={obj.name} onChange={(e) => updateObject(obj.id, { name: e.target.value })} />
      </Field>
      <Field label="Animation" hint={keyed ? 'Moving, rotating or scaling now updates the key at this frame.' : 'Press I to key location, rotation and scale at this frame.'}>
        <div className="flex items-center gap-1.5">
          <Button className="h-6 gap-1.5 px-2" onClick={onKey ? actions.deleteKey : actions.insertKey}>
            <Diamond className={onKey ? 'size-3 fill-warn text-warn' : 'size-3'} />
            {onKey ? `Remove key · ${frame}` : `Key frame ${frame}`}
          </Button>
          {keyed && (
            <Button variant="ghost" className="h-6 px-2" onClick={() => useWorkspace.getState().setObjectKeys(obj.id, [])}>
              Clear ({obj.keys!.length})
            </Button>
          )}
        </div>
      </Field>
      {obj.primitive && <ShapeSection obj={obj} />}
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
      <MaterialsSection obj={obj} />
      {obj.spec != null && <RefineSection obj={obj} />}
      {obj.spec != null && (
        <Field label="Parts" hint="Turn every part into its own object you can move, resize and recolour.">
          <Button className="h-6.5 px-2.5" onClick={actions.separateSelected}>
            Separate into parts
          </Button>
        </Field>
      )}
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

/** Objects you model yourself: shape parameters in cm, drag to scrub or click to type. */
function ShapeSection({ obj }: { obj: SceneObject }) {
  const p = obj.primitive!
  const { updateObject, checkpoint } = useWorkspace.getState()
  const editing = useRef(false)
  const fields = SHAPE_FIELDS[p.shape]
  const label = p.shape === 'cylinder' && p.dims[0] === 0 ? 'Cone' : (PRIMITIVES.find((x) => x.shape === p.shape)?.label ?? p.shape)
  const set = (i: number, cm: number) => {
    if (!editing.current) {
      checkpoint('Shape')
      editing.current = true
    }
    const dims = [...p.dims]
    dims[i] = cm / 100
    const next = { ...p, dims }
    // An unrotated object resting on the floor stays on the floor as its height changes.
    const t = obj.transform
    const resting = Math.abs(t.position[1] - restingHeight(p) * t.scale[1]) < 1e-4 && t.rotation.every((r) => Math.abs(r) < 1e-6)
    const transform = resting ? { ...t, position: [t.position[0], restingHeight(next) * t.scale[1], t.position[2]] as Vec3 } : t
    updateObject(obj.id, { primitive: next, transform })
  }
  return (
    <>
      <Field label="Shape">
        <span className="text-xs text-fg">{label}</span>
      </Field>
      {fields.map((f, i) => (
        <Field key={f} label={f}>
          <ScrubField
            label="cm"
            suffix=""
            value={+(p.dims[i] * 100).toFixed(1)}
            min={f.startsWith('Top') || f.startsWith('Corner') ? 0 : 0.1}
            max={5000}
            step={0.5}
            size="sm"
            showDelta={false}
            rubberReach={0}
            chipColor="#0d0d0d"
            accent="#4c8dff"
            className="!h-6.5 !w-full font-mono !text-2xs"
            onChange={(v) => set(i, v)}
            onCommit={() => (editing.current = false)}
          />
        </Field>
      ))}
      <div className="h-px bg-line" />
    </>
  )
}

/** Claude parts objects: describe a change in words, Claude edits the parts. */
function RefineSection({ obj }: { obj: SceneObject }) {
  const [text, setText] = useState('')
  const running = useWorkspace((s) => s.job.status === 'running')
  const spec = obj.spec as { parts?: unknown[]; assumptions?: string[] }
  const [showAssumptions, setShowAssumptions] = useState(false)
  const submit = async () => {
    const { refineObject } = await import('@/generation/run')
    await refineObject(obj.id, text)
    setText('')
  }
  return (
    <>
      <div className="h-px bg-line" />
      <Field label="Refine" hint={`${spec.parts?.length ?? 0} parts. Describe what's wrong, e.g. "legs are square 6×6 cm, the top is 2.5 cm thick".`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim() && !running && submit()}
          rows={3}
          placeholder="What should change?"
          className={`${inputCls} h-auto resize-none py-1.5 leading-snug`}
        />
      </Field>
      <div className="ml-[100px] flex items-center gap-1.5">
        <Button variant="primary" className="h-6.5 whitespace-nowrap px-3" disabled={!text.trim() || running} onClick={submit}>
          {running ? 'Working…' : 'Refine with Claude'}
        </Button>
        {!!spec.assumptions?.length && (
          <Button variant="ghost" className="h-6.5 px-2" onClick={() => setShowAssumptions(!showAssumptions)}>
            Assumptions ({spec.assumptions.length})
          </Button>
        )}
      </div>
      {showAssumptions && (
        <ul className="ml-[100px] list-disc space-y-0.5 pl-4 text-2xs leading-snug text-dim">
          {spec.assumptions!.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
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
