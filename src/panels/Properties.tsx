import { Lock, Unlock } from 'lucide-react'
import { objectTransformAt } from '@/lib/anim'
import { useRef, useState } from 'react'
import ScrubField from '@/components/reactbits/ScrubField'
import { actions } from '@/lib/actions'
import { ancestorIds, useActiveProject, useWorkspace, type Ambience, type PropertyTab, type RenderEngine, type SceneObject, type ShadeMode, type Vec3 } from '@/store/workspace'
import { PRIMITIVES, SHAPE_FIELDS, restingHeight } from '@/lib/primitives'
import { MaterialsSection } from './MaterialsSection'
import { LIGHT_COLORS, TEMPERATURES, kelvinToHex, lightOf } from '@/furniture/lights'
import { viewport } from '@/viewport/bridge'
import { Button, Field, Select, Slider, Toggle, inputCls } from '@/ui/primitives'

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

  const inModel = !!(obj.isGroup || obj.parentId)
  const descendants = obj.isGroup ? project.objects.filter((o) => ancestorIds(project.objects, o.id).includes(obj.id)) : []
  const triangles = obj.isGroup ? descendants.reduce((a, o) => a + (o.stats?.triangles ?? 0), 0) : obj.stats?.triangles

  return (
    <div className="space-y-2.5 p-3">
      {inModel && <PartPicker obj={obj} />}
      <Field label="Name">
        <input className={inputCls} value={obj.name} onChange={(e) => updateObject(obj.id, { name: e.target.value })} />
      </Field>
      {obj.primitive && <ShapeSection obj={obj} />}
      {obj.furniture && <FurnitureSection obj={obj} />}
      {lightOf(obj) && <LightSection obj={obj} />}
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
      {obj.stats?.size && !obj.furniture && (
        <DimensionsField base={obj.stats.size} scale={t.scale} onChange={(scale) => set({ scale })} onCommit={done} />
      )}
      <div className="h-px bg-line" />
      {obj.isGroup ? (
        <GroupSection obj={obj} descendants={descendants} />
      ) : (
        <>
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
        </>
      )}
      {obj.parentId && (
        <Field label="Model" hint="Make this part a separate object, exactly where it is now.">
          <Button className="h-6.5 px-2.5" onClick={actions.unparentSelected}>
            Take out of model
          </Button>
        </Field>
      )}
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
        <span className="font-mono text-2xs tabular text-fg">{triangles?.toLocaleString('en-US') ?? '—'}</span>
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

/**
 * The model's parts as a dropdown: pick the whole model, a folder (all legs) or one part
 * to move and edit it. Same as clicking it in the outliner.
 */
function PartPicker({ obj }: { obj: SceneObject }) {
  const project = useActiveProject()
  const select = useWorkspace((s) => s.select)
  const rootId = [obj.id, ...ancestorIds(project.objects, obj.id)].at(-1)!
  const options: { value: string; label: string }[] = []
  const walk = (id: string, depth: number) => {
    const o = project.objects.find((x) => x.id === id)
    if (!o) return
    const indent = '\u2002\u2002'.repeat(depth)
    options.push({ value: o.id, label: depth === 0 ? `${o.name} · whole model` : `${indent}${o.isGroup ? '▸ ' : ''}${o.name}` })
    project.objects.filter((c) => c.parentId === id).forEach((c) => walk(c.id, depth + 1))
  }
  walk(rootId, 0)
  return (
    <Field label="Part" hint={obj.id === rootId ? 'Pick a part to move or edit it on its own. Clicking a part in the viewport does the same.' : undefined}>
      <Select value={obj.id} onChange={(id) => select(id)} options={options} />
    </Field>
  )
}

/** A model or folder: its parts at a glance, with visibility. */
function GroupSection({ obj, descendants }: { obj: SceneObject; descendants: SceneObject[] }) {
  const { select, updateObject } = useWorkspace.getState()
  const parts = descendants.filter((o) => !o.isGroup)
  const hidden = parts.filter((o) => !o.visible).length
  return (
    <>
      <Field label="Parts" hint={hidden ? `${hidden} hidden` : undefined}>
        <div className="flex flex-wrap gap-1">
          {descendants
            .filter((o) => o.parentId === obj.id)
            .map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => select(o.id)}
                className={`h-5.5 rounded border border-line-strong px-1.5 text-2xs hover:border-dim hover:text-fg ${o.visible ? 'text-dim' : 'text-faint line-through'}`}
              >
                {o.isGroup ? '▸ ' : ''}
                {o.name}
              </button>
            ))}
        </div>
      </Field>
      {hidden > 0 && (
        <Button
          variant="ghost"
          className="ml-[100px] h-6 px-2"
          onClick={() => {
            descendants.forEach((o) => !o.visible && updateObject(o.id, { visible: true }))
            viewport.invalidate()
          }}
        >
          Show all parts
        </Button>
      )}
    </>
  )
}

const AMBIENCE_HINT: Record<Ambience, string> = {
  day: 'Bright sky and sun through the windows.',
  evening: 'Low, warm sun; the lamps start to show.',
  night: 'Dark outside: only your lamps light the rooms.',
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
  const preset = RES_PRESETS.find((p) => p.w === s.renderWidth && p.h === s.renderHeight)?.id ?? 'custom'
  const focal = project.camera?.focal ?? 50
  const keyed = project.animation.keys.length > 0

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
      <div className="h-px bg-line" />
      <Field label="Engine" hint={s.engine === 'pathtrace' ? 'Path tracing, like Cycles: real light bounces, soft shadows, glass and glowing lamps. Rendered view (Z) previews it live.' : 'Real-time rasteriser, like Eevee: fast, less realistic.'}>
        <Select<RenderEngine>
          value={s.engine}
          onChange={(engine) => update({ engine })}
          options={[
            { value: 'pathtrace', label: 'Path tracing · Cycles' },
            { value: 'raster', label: 'Real-time · Eevee' },
          ]}
        />
      </Field>
      {s.engine === 'pathtrace' && (
        <>
          <Field label="Samples" hint="Per pixel, for images and PDF renders. More = less noise, slower.">
            <Select value={String(s.samples)} onChange={(v) => update({ samples: Number(v) })} options={[32, 64, 128, 256, 512, 1024, 2048].map((v) => ({ value: String(v), label: String(v) }))} />
          </Field>
          <Field label="Video samples" hint="Per frame of an animation.">
            <Select value={String(s.videoSamples)} onChange={(v) => update({ videoSamples: Number(v) })} options={[8, 16, 24, 48, 96, 192].map((v) => ({ value: String(v), label: String(v) }))} />
          </Field>
          <Field label="Viewport samples" hint="The Rendered view stops refining after this many.">
            <Select value={String(s.viewportSamples)} onChange={(v) => update({ viewportSamples: Number(v) })} options={[64, 256, 1024, 4096].map((v) => ({ value: String(v), label: String(v) }))} />
          </Field>
          <Field label="Bounces">
            <Select value={String(s.bounces)} onChange={(v) => update({ bounces: Number(v) })} options={[2, 4, 6, 8, 12].map((v) => ({ value: String(v), label: String(v) }))} />
          </Field>
          <Field label="Denoise" hint="Smooths the remaining grain.">
            <Toggle checked={s.denoise} onChange={(denoise) => update({ denoise })} />
          </Field>
        </>
      )}
      <Field label="Daylight" hint={AMBIENCE_HINT[s.ambience]}>
        <Select<Ambience>
          value={s.ambience}
          onChange={(ambience) => update({ ambience })}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'evening', label: 'Evening' },
            { value: 'night', label: 'Night' },
          ]}
        />
      </Field>
      <div className="h-px bg-line" />
      <Field label="Exposure">
        <Slider value={s.exposure} min={0.2} max={2.5} onChange={(exposure) => update({ exposure })} />
      </Field>
      <Field label="Environment">
        <Slider value={s.envIntensity} min={0} max={3} onChange={(envIntensity) => update({ envIntensity })} />
      </Field>
      <div className="h-px bg-line" />
      <Field label="PDF photos" hint="Each room render in the PDF is turned into a photograph by OpenAI's image model (ChatGPT images), keeping the room's layout and furniture. Uses your own API key and credits.">
        <Toggle checked={s.aiPhotos} onChange={(aiPhotos) => update({ aiPhotos })} />
      </Field>
      {s.aiPhotos && (
        <>
          <Field label="OpenAI key" hint={s.rememberKeys ? 'Saved in this browser on this device.' : 'Kept in memory only: gone when you close the tab.'}>
            <input className={inputCls} type="password" placeholder="sk-…" value={s.openaiKey} autoComplete="off" onChange={(e) => update({ openaiKey: e.target.value.trim() })} />
          </Field>
          <Field label="Model">
            <input className={inputCls} value={s.aiModel} onChange={(e) => update({ aiModel: e.target.value.trim() })} />
          </Field>
          <Field label="Remember key">
            <Toggle checked={s.rememberKeys} onChange={(rememberKeys) => update({ rememberKeys })} />
          </Field>
          <p className="ml-[100px] text-2xs leading-snug text-faint">The key goes only to api.openai.com, from this browser. It is never saved with projects or exports.</p>
        </>
      )}
      <div className="h-px bg-line" />
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="primary" onClick={actions.renderImage}>
          Image · F12
        </Button>
        <Button onClick={actions.renderAnimation}>Tour video · ⌃F12</Button>
      </div>
    </div>
  )
}

/** Blender's Dimensions: bounding-box size in cm. Locked = edit one axis, scale all proportionally. */
function DimensionsField({ base, scale, onChange, onCommit }: { base: Vec3; scale: Vec3; onChange: (scale: Vec3) => void; onCommit: () => void }) {
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
      </div>
    </>
  )
}

/** Catalog furniture: its real size in cm. The piece is rebuilt to fit (more seats, more doors…). */
function FurnitureSection({ obj }: { obj: SceneObject }) {
  const f = obj.furniture!
  const { updateObject, checkpoint } = useWorkspace.getState()
  const editing = useRef(false)
  const set = (i: number, cm: number) => {
    if (!editing.current) {
      checkpoint('Size')
      editing.current = true
    }
    const size = [...f.size] as Vec3
    size[i] = Math.max(0.01, cm / 100)
    updateObject(obj.id, { furniture: { ...f, size } })
  }
  return (
    <>
      <Field label="Size (cm)" hint="Width, height, depth. Resizing rebuilds the piece: a wider sofa gets more seats, a wider wardrobe more doors.">
        <div className="grid grid-cols-3 gap-1">
          {(['W', 'H', 'D'] as const).map((k, i) => (
            <ScrubField
              key={k}
              label={k}
              suffix=""
              value={+(f.size[i] * 100).toFixed(1)}
              min={1}
              max={2000}
              step={1}
              size="sm"
              showDelta={false}
              rubberReach={0}
              chipColor="#0d0d0d"
              accent="#4c8dff"
              className="!h-6.5 !w-full !gap-0 !pr-1.5 font-mono !text-2xs"
              onChange={(v) => set(i, v)}
              onCommit={() => (editing.current = false)}
            />
          ))}
        </div>
      </Field>
      <div className="h-px bg-line" />
    </>
  )
}

/** Lamps: the light they give off. Shows live in the 3D view (Rendered view: real light, path traced). */
function LightSection({ obj }: { obj: SceneObject }) {
  const light = lightOf(obj)!
  const { commit, updateObject, checkpoint } = useWorkspace.getState()
  const editing = useRef(false)
  const set = (patch: Partial<typeof light>, undoable = true) => {
    const next = { ...light, ...patch }
    if (undoable) return commit('Light', obj.id, { light: next })
    if (!editing.current) {
      checkpoint('Light')
      editing.current = true
    }
    updateObject(obj.id, { light: next })
  }
  const done = () => (editing.current = false)
  return (
    <>
      <Field label="Light" hint="Real light from the bulb. Switch the viewport to Rendered (Z) to see it path traced.">
        <label className="flex items-center gap-2 text-xs text-dim">
          <Toggle checked={light.on} onChange={(on) => set({ on })} />
          {light.on ? 'On' : 'Off'}
        </label>
      </Field>
      <Field label="Temperature">
        <div className="grid grid-cols-3 gap-1">
          {TEMPERATURES.map((t) => (
            <button
              key={t.kelvin}
              type="button"
              title={`${t.kelvin} K`}
              onClick={() => set({ kelvin: t.kelvin, color: kelvinToHex(t.kelvin) })}
              className={`flex h-6 items-center gap-1 rounded border px-1 text-2xs ${light.kelvin === t.kelvin ? 'border-accent text-fg' : 'border-line-strong text-dim hover:text-fg'}`}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: kelvinToHex(t.kelvin) }} />
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Colour">
        <div className="space-y-1.5" onPointerUp={done}>
          <div className="grid grid-cols-8 gap-1">
            {LIGHT_COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Light colour ${c}`} onClick={() => set({ color: c, kelvin: null })} className={`aspect-square rounded border ${light.kelvin === null && light.color.toLowerCase() === c ? 'border-accent ring-1 ring-accent' : 'border-white/10'}`} style={{ background: c }} />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="color" value={light.color} onChange={(e) => set({ color: e.target.value, kelvin: null }, false)} onBlur={done} className="h-6.5 w-9 cursor-pointer rounded-md border border-line-strong bg-transparent p-0.5" aria-label="Custom light colour" />
            <span className="font-mono text-2xs text-dim">{light.kelvin ? `${light.kelvin} K` : light.color}</span>
          </div>
        </div>
      </Field>
      <Field label="Brightness" hint={`${Math.round(light.lumens)} lm · a 60 W bulb is about 800 lm.`}>
        <div onPointerUp={done}>
          <Slider value={light.lumens} min={50} max={4000} onChange={(lumens) => set({ lumens }, false)} />
        </div>
      </Field>
      <div className="h-px bg-line" />
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
  if (tab === 'object') return <ObjectTab />
  return <RenderTab />
}
