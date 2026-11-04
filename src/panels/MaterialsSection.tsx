import { RotateCcw } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useWorkspace, type MaterialOverride, type SceneObject } from '@/store/workspace'
import { Button, Field, Slider, Toggle, inputCls } from '@/ui/primitives'
import { COLOR_PALETTE, MATERIAL_LIBRARY, presetById, type MaterialPreset } from '@/viewport/materialPresets'

const ALL = '__all'
const CATEGORIES = ['Fabric', 'Wood', 'Metal', 'Coating', 'Plastic', 'Stone', 'Glass', 'Floor'] as const

/** CSS "material ball" so swatches read as metal / gloss / matte at a glance. */
function Ball({ color, roughness = 0.5, metalness = 0, size = 'size-4' }: { color: string; roughness?: number; metalness?: number; size?: string }) {
  const hi = metalness > 0.5 ? 0.9 : 0.6 * (1 - roughness) + 0.15
  return (
    <span
      className={cn('inline-block shrink-0 rounded-full border border-white/10', size)}
      style={{ background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,${hi}) 0%, rgba(255,255,255,0) ${metalness > 0.5 ? 38 : 55}%), radial-gradient(circle at 50% 60%, ${color} 40%, color-mix(in srgb, ${color} 55%, black) 100%)` }}
    />
  )
}

export function MaterialsSection({ obj }: { obj: SceneObject }) {
  const surfaces = obj.stats?.surfaces ?? []
  const [slot, setSlot] = useState<string>(surfaces.length > 1 ? ALL : (surfaces[0]?.key ?? ALL))
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Metal')
  const { commit, updateObject, checkpoint } = useWorkspace.getState()
  const editing = useRef(false)

  const overrideFor = (key: string) => (key === ALL ? obj.material : (obj.surfaces?.[key] ?? obj.material))
  const current = overrideFor(slot)
  const generated = surfaces.find((s) => s.key === slot)?.color ?? surfaces[0]?.color ?? '#bcbcbc'
  const base: MaterialOverride = current ?? { color: generated, roughness: 0.5, metalness: 0, keepTexture: true }

  /** Write an override for the selected slot (or every slot). Undoable once per gesture. */
  const write = (next: MaterialOverride | null, undoable: boolean) => {
    const patch: Partial<SceneObject> =
      slot === ALL ? { material: next, surfaces: undefined } : { surfaces: { ...(obj.surfaces ?? {}), ...(next ? { [slot]: next } : {}) } }
    if (slot !== ALL && !next) {
      const rest = { ...(obj.surfaces ?? {}) }
      delete rest[slot]
      patch.surfaces = rest
    }
    if (undoable) return commit('Material', obj.id, patch)
    if (!editing.current) {
      checkpoint('Material')
      editing.current = true
    }
    updateObject(obj.id, patch)
  }
  const done = () => (editing.current = false)
  const applyPreset = (p: MaterialPreset) => write({ preset: p.id, color: p.color, roughness: p.roughness, metalness: p.metalness, keepTexture: false }, true)
  const preset = presetById(current?.preset)

  return (
    <>
      <Field label="Materials">
        <div className="space-y-0.5">
          {surfaces.length > 1 && (
            <SlotRow active={slot === ALL} name="All surfaces" detail={obj.material ? (presetById(obj.material.preset)?.name ?? 'Custom') : 'As generated'} color={obj.material?.color ?? surfaces[0].color} onClick={() => setSlot(ALL)} />
          )}
          {surfaces.map((s) => {
            const o = overrideFor(s.key)
            return <SlotRow key={s.key} active={slot === s.key} name={s.key} detail={o ? (presetById(o.preset)?.name ?? 'Custom') : 'As generated'} color={o?.color ?? s.color} onClick={() => setSlot(s.key)} />
          })}
        </div>
      </Field>

      <div className="ml-[100px] space-y-2">
        <div className="flex flex-wrap gap-0.5">
          {CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={cn('h-5.5 rounded px-1.5 text-2xs transition-colors', c === category ? 'bg-active text-fg' : 'text-dim hover:text-fg')}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {MATERIAL_LIBRARY.filter((p) => p.category === category).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p)}
              title={p.texture ? `${p.name} · textured` : p.name}
              className={cn('flex h-7 items-center gap-1.5 rounded-md border px-1.5 text-left text-2xs transition-colors', current?.preset === p.id ? 'border-accent bg-accent-soft text-fg' : 'border-line-strong bg-app/40 text-dim hover:text-fg')}
            >
              <Ball color={p.color} roughness={p.roughness} metalness={p.metalness} />
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <Field label="Colour">
        <div className="space-y-1.5" onPointerUp={done}>
          <div className="grid grid-cols-8 gap-1">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                aria-label={`Colour: ${c.name}`}
                onClick={() => write({ ...base, color: c.hex }, true)}
                className={cn('aspect-square rounded border transition-transform hover:scale-110', base.color.toLowerCase() === c.hex ? 'border-accent ring-1 ring-accent' : 'border-white/10')}
                style={{ background: c.hex }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="color" value={base.color} onChange={(e) => write({ ...base, color: e.target.value }, false)} onBlur={done} className="h-6.5 w-9 cursor-pointer rounded-md border border-line-strong bg-transparent p-0.5" aria-label="Custom colour" />
            <input className={inputCls} value={base.color} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && write({ ...base, color: e.target.value }, true)} aria-label="Hex colour" />
          </div>
        </div>
      </Field>
      <Field label="Roughness">
        <div onPointerUp={done}>
          <Slider value={base.roughness} min={0} max={1} onChange={(roughness) => write({ ...base, roughness }, false)} />
        </div>
      </Field>
      <Field label="Metallic">
        <div onPointerUp={done}>
          <Slider value={base.metalness} min={0} max={1} onChange={(metalness) => write({ ...base, metalness }, false)} />
        </div>
      </Field>
      {!preset?.texture && (
        <Field label="Keep texture" hint="Tint the generated texture instead of replacing it.">
          <Toggle checked={base.keepTexture} onChange={(keepTexture) => write({ ...base, keepTexture }, true)} />
        </Field>
      )}
      {current && (
        <Button variant="ghost" className="ml-[100px] h-6 gap-1.5 px-2" onClick={() => write(null, true)}>
          <RotateCcw className="size-3" /> Back to generated
        </Button>
      )}
    </>
  )
}

function SlotRow({ active, name, detail, color, onClick }: { active: boolean; name: string; detail: string; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex h-6.5 w-full items-center gap-2 rounded-md px-1.5 text-left text-xs transition-colors', active ? 'bg-active text-fg' : 'text-dim hover:bg-hover hover:text-fg')}>
      <Ball color={color} size="size-3.5" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 truncate text-2xs text-faint">{detail}</span>
    </button>
  )
}
