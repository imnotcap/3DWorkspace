import { FlipHorizontal2, Trash2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import ScrubField from '@/components/reactbits/ScrubField'
import { cn } from '@/lib/cn'
import { actions } from '@/lib/actions'
import { analyse, add, dist, mul, norm, pointInPolygon, sub } from '@/plan/geometry'
import { levelElevations, roomFor } from '@/plan/levels'
import { DEFAULT_CEILING_FINISH, DEFAULT_FLOOR_FINISH, DEFAULT_WALL_FINISH, OPENING_DEFAULTS, type Finish, type OpeningKind, type RoomInfo, type Vec2 } from '@/plan/types'
import { uid, useActiveProject, useWorkspace, type PlanData } from '@/store/workspace'
import { Button, Field, Select, inputCls } from '@/ui/primitives'
import { MATERIAL_LIBRARY, PAINT_COLORS, presetById } from '@/viewport/materialPresets'
import { PropertiesPanel } from './Properties'

/** Right-hand panel: whatever is selected in the plan or the 3D view. */
export function Inspector() {
  const sel = useWorkspace((s) => s.planSel)
  const selectedId = useWorkspace((s) => s.selectedId)
  if (selectedId) return <PropertiesPanel tab="object" />
  if (sel?.kind === 'wall') return <WallInspector id={sel.id} side={sel.side} />
  if (sel?.kind === 'opening') return <OpeningInspector id={sel.id} />
  if (sel?.kind === 'room' && sel.at) return <RoomInspector levelId={sel.id} at={sel.at} />
  if (sel?.kind === 'tour') return <TourInspector id={sel.id} />
  return <ProjectSummary />
}

const Title = ({ children, onDelete }: { children: string; onDelete?: () => void }) => (
  <div className="flex items-center justify-between">
    <h3 className="text-xs font-medium text-fg">{children}</h3>
    {onDelete && (
      <Button variant="ghost" className="h-6 gap-1 px-2" onClick={onDelete}>
        <Trash2 className="size-3" /> Delete
      </Button>
    )}
  </div>
)

/** Number field in cm, drag to scrub or click to type. One undo step per gesture. */
function Cm({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (m: number, first: boolean) => void }) {
  const editing = useRef(false)
  return (
    <Field label={label}>
      <ScrubField
        label="cm"
        suffix=""
        value={+(value * 100).toFixed(1)}
        min={min * 100}
        max={max * 100}
        step={1}
        size="sm"
        showDelta={false}
        rubberReach={0}
        chipColor="#0d0d0d"
        accent="#4c8dff"
        className="!h-6.5 !w-full font-mono !text-2xs"
        onChange={(v) => {
          onChange(v / 100, !editing.current)
          editing.current = true
        }}
        onCommit={() => (editing.current = false)}
      />
    </Field>
  )
}

const edit = (label: string, first: boolean, fn: (p: PlanData) => PlanData) => useWorkspace.getState().editPlan(first ? label : null, fn)

/** Paint colours and/or library materials as swatches. */
function FinishPicker({ value, onChange, materials }: { value: Finish; onChange: (f: Finish) => void; materials: string[] }) {
  return (
    <div className="space-y-1.5">
      {materials.length > 0 && (
        <div className="grid grid-cols-4 gap-1">
          {materials.map((id) => {
            const p = presetById(id)!
            return (
              <button
                key={id}
                type="button"
                title={p.name}
                onClick={() => onChange({ color: p.color, preset: p.id })}
                className={cn('flex h-9 flex-col items-center justify-end overflow-hidden rounded-md border pb-0.5 text-[9px] text-white/90', value.preset === id ? 'border-accent ring-1 ring-accent' : 'border-line-strong')}
                style={{ background: `linear-gradient(160deg, color-mix(in srgb, ${p.color} 80%, white), ${p.color})`, textShadow: '0 1px 2px #0008' }}
              >
                {p.name.replace(' planks', '').replace(' tiles', '')}
              </button>
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-9 gap-1">
        {PAINT_COLORS.map((c) => (
          <button
            key={c.hex}
            type="button"
            title={c.name}
            aria-label={c.name}
            onClick={() => onChange({ color: c.hex, preset: value.preset && materials.includes(value.preset) ? value.preset : undefined })}
            className={cn('aspect-square rounded border', value.color.toLowerCase() === c.hex ? 'border-white ring-1 ring-accent' : 'border-black/30')}
            style={{ background: c.hex }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="color" value={value.color} onChange={(e) => onChange({ ...value, color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-line-strong bg-transparent" />
        <span className="font-mono text-2xs text-dim">{value.color}</span>
        {value.preset && <span className="text-2xs text-faint">· {presetById(value.preset)?.name}</span>}
      </div>
    </div>
  )
}

const FLOORS = MATERIAL_LIBRARY.filter((m) => m.category === 'Floor').map((m) => m.id)
const WALL_MATERIALS = ['white-tile', 'concrete', 'oak', 'marble']

function WallInspector({ id, side }: { id: string; side?: 'left' | 'right' }) {
  const project = useActiveProject()
  const w = project.walls.find((x) => x.id === id)
  if (!w) return null
  const L = dist(w.a, w.b)
  const level = project.levels.find((l) => l.id === w.levelId)!
  const setLength = (m: number, first: boolean) => {
    const dir = norm(sub(w.b, w.a))
    const b = add(w.a, mul(dir, Math.max(0.2, m)))
    edit('Wall length', first, (p) => ({ ...p, walls: p.walls.map((x) => (x.levelId !== w.levelId ? x : x.id === id ? { ...x, b } : dist(x.a, w.b) < 2e-3 ? { ...x, a: b } : dist(x.b, w.b) < 2e-3 ? { ...x, b } : x)) }))
  }
  const sides: ('left' | 'right')[] = side ? [side, side === 'left' ? 'right' : 'left'] : ['left', 'right']
  return (
    <div className="space-y-2.5 p-3">
      <Title onDelete={actions.deleteSelected}>Wall</Title>
      <Cm label="Length" value={L} min={0.2} max={60} onChange={setLength} />
      <Cm label="Thickness" value={w.thickness} min={0.05} max={0.6} onChange={(t, f) => edit('Wall thickness', f, (p) => ({ ...p, walls: p.walls.map((x) => (x.id === id ? { ...x, thickness: t } : x)) }))} />
      <Cm label="Height" value={w.height ?? level.height} min={0.3} max={6} onChange={(h, f) => edit('Wall height', f, (p) => ({ ...p, walls: p.walls.map((x) => (x.id === id ? { ...x, height: Math.abs(h - level.height) < 0.005 ? undefined : h } : x)) }))} />
      <p className="ml-[100px] text-2xs leading-snug text-faint">Lower than the ceiling makes a half wall or railing.</p>
      {sides.map((s) => (
        <div key={s} className="space-y-1.5 border-t border-line pt-2">
          <div className="flex items-center justify-between">
            <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">{s === side ? 'Paint · this side' : side ? 'Paint · other side' : `Paint · ${s} side`}</span>
            {w.paint?.[s] && (
              <Button variant="ghost" className="h-5.5 px-1.5" onClick={() => edit('Paint', true, (p) => ({ ...p, walls: p.walls.map((x) => (x.id === id ? { ...x, paint: { ...x.paint, [s]: undefined } } : x)) }))}>
                Use room colour
              </Button>
            )}
          </div>
          <FinishPicker value={w.paint?.[s] ?? DEFAULT_WALL_FINISH} materials={WALL_MATERIALS} onChange={(f) => edit('Paint', true, (p) => ({ ...p, walls: p.walls.map((x) => (x.id === id ? { ...x, paint: { ...x.paint, [s]: f } } : x)) }))} />
        </div>
      ))}
    </div>
  )
}

function OpeningInspector({ id }: { id: string }) {
  const project = useActiveProject()
  const o = project.openings.find((x) => x.id === id)
  if (!o) return null
  const w = project.walls.find((x) => x.id === o.wallId)
  const level = project.levels.find((l) => l.id === w?.levelId)
  const set = (label: string, first: boolean, patch: Partial<typeof o>) => edit(label, first, (p) => ({ ...p, openings: p.openings.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
  const door = OPENING_DEFAULTS[o.kind].door
  return (
    <div className="space-y-2.5 p-3">
      <Title onDelete={actions.deleteSelected}>{OPENING_DEFAULTS[o.kind].label}</Title>
      <Field label="Type">
        <Select<OpeningKind>
          value={o.kind}
          onChange={(kind) => set('Opening type', true, { kind, ...(OPENING_DEFAULTS[kind].door !== door ? { sill: OPENING_DEFAULTS[kind].sill, height: OPENING_DEFAULTS[kind].height } : {}) })}
          options={(Object.keys(OPENING_DEFAULTS) as OpeningKind[]).map((k) => ({ value: k, label: OPENING_DEFAULTS[k].label }))}
        />
      </Field>
      <Cm label="Width" value={o.width} min={0.3} max={w ? dist(w.a, w.b) - 0.1 : 6} onChange={(v, f) => set('Opening width', f, { width: v })} />
      <Cm label="Height" value={o.height} min={0.3} max={(level?.height ?? 2.6) - o.sill - 0.02} onChange={(v, f) => set('Opening height', f, { height: v })} />
      {!door && <Cm label="Sill height" value={o.sill} min={0} max={(level?.height ?? 2.6) - o.height - 0.02} onChange={(v, f) => set('Sill height', f, { sill: v })} />}
      {o.kind !== 'archway' && (
        <Field label="Swing">
          <div className="flex gap-1">
            {(o.kind === 'door' || o.kind === 'french-window') && (
              <Button className="h-6.5 flex-1 gap-1 px-2" onClick={() => set('Flip hinge', true, { hinge: o.hinge === 'a' ? 'b' : 'a' })}>
                <FlipHorizontal2 className="size-3" /> Hinge
              </Button>
            )}
            <Button className="h-6.5 flex-1 px-2" onClick={() => set('Flip side', true, { side: o.side === 'left' ? 'right' : 'left' })}>
              Opens to other side
            </Button>
          </div>
        </Field>
      )}
      {(door || o.kind === 'french-window') && o.kind !== 'archway' && (
        <Field label="Open in 3D">
          <input type="range" min={0} max={1} step={0.05} value={o.open} onChange={(e) => set('Open', false, { open: Number(e.target.value) })} className="w-full accent-[#4c8dff]" onPointerDown={() => useWorkspace.getState().checkpoint('Open')} />
        </Field>
      )}
      <div className="space-y-1.5 border-t border-line pt-2">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">Frame and door colour</span>
        <FinishPicker value={o.frame} materials={['oak', 'walnut', 'powder-black', 'powder-anthracite']} onChange={(frame) => set('Frame colour', true, { frame })} />
      </div>
    </div>
  )
}

/** Find the room (face) at a point; edits create its saved settings on first change. */
function useRoom(levelId: string, at: Vec2) {
  const project = useActiveProject()
  const walls = useMemo(() => project.walls.filter((w) => w.levelId === levelId), [project.walls, levelId])
  const geom = useMemo(() => analyse(walls), [walls])
  const face = geom.faces.find((f) => pointInPolygon(at, f.polygon))
  const info = face ? roomFor(face, project.rooms, levelId) : undefined
  const update = (label: string, first: boolean, patch: Partial<RoomInfo>) =>
    face &&
    edit(label, first, (p) => {
      const existing = info && p.rooms.find((r) => r.id === info.id)
      if (existing) return { ...p, rooms: p.rooms.map((r) => (r.id === existing.id ? { ...r, ...patch } : r)) }
      const fresh: RoomInfo = { id: uid(), levelId, anchor: face.center, name: 'Room', floor: DEFAULT_FLOOR_FINISH, walls: DEFAULT_WALL_FINISH, ceiling: DEFAULT_CEILING_FINISH, ...patch }
      return { ...p, rooms: [...p.rooms, fresh] }
    })
  return { face, info, update }
}

export const ROOM_NAMES = ['Living room', 'Kitchen', 'Dining room', 'Bedroom', 'Bathroom', 'Hallway', 'Office', 'Kids room', 'Toilet', 'Utility', 'Walk-in closet', 'Storage']

function RoomInspector({ levelId, at }: { levelId: string; at: Vec2 }) {
  const project = useActiveProject()
  const { face, info, update } = useRoom(levelId, at)
  if (!face) return <p className="p-3 text-xs text-dim">Room no longer enclosed.</p>
  const level = project.levels.find((l) => l.id === levelId)!
  return (
    <div className="space-y-2.5 p-3">
      <Title>Room</Title>
      <Field label="Name">
        <input className={inputCls} list="room-names" value={info?.name ?? 'Room'} onChange={(e) => update('Rename room', true, { name: e.target.value })} />
        <datalist id="room-names">
          {ROOM_NAMES.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <Field label="Floor area">
        <span className="font-mono text-xs text-fg">{face.area.toFixed(2)} m²</span>
      </Field>
      <Field label="Ceiling">
        <span className="font-mono text-xs text-fg">{Math.round(level.height * 100)} cm</span>
      </Field>
      <div className="space-y-1.5 border-t border-line pt-2">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">Floor</span>
        <FinishPicker value={info?.floor ?? DEFAULT_FLOOR_FINISH} materials={FLOORS} onChange={(floor) => update('Floor', true, { floor })} />
      </div>
      <div className="space-y-1.5 border-t border-line pt-2">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">Walls · paint</span>
        <FinishPicker value={info?.walls ?? DEFAULT_WALL_FINISH} materials={WALL_MATERIALS} onChange={(walls) => update('Paint walls', true, { walls })} />
      </div>
      <div className="space-y-1.5 border-t border-line pt-2">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">Ceiling</span>
        <FinishPicker value={info?.ceiling ?? DEFAULT_CEILING_FINISH} materials={[]} onChange={(ceiling) => update('Ceiling', true, { ceiling })} />
      </div>
    </div>
  )
}

function TourInspector({ id }: { id: string }) {
  const project = useActiveProject()
  const idx = project.tour.points.findIndex((p) => p.id === id)
  const { editPlan } = useWorkspace.getState()
  return (
    <div className="space-y-2.5 p-3">
      <Title onDelete={actions.deleteSelected}>{`Tour point ${idx + 1} of ${project.tour.points.length}`}</Title>
      <TourSettings />
      <Button
        className="w-full"
        onClick={() => editPlan('Reverse tour', (p) => ({ ...p, tour: { ...p.tour, points: [...p.tour.points].reverse() } }))}
      >
        Reverse direction
      </Button>
    </div>
  )
}

export function TourSettings() {
  const project = useActiveProject()
  const { editPlan } = useWorkspace.getState()
  const t = project.tour
  const set = (patch: Partial<typeof t>) => editPlan(null, (p) => ({ ...p, tour: { ...p.tour, ...patch } }))
  return (
    <>
      <Field label="Speed">
        <Select value={String(t.speed)} onChange={(v) => set({ speed: Number(v) })} options={[0.4, 0.55, 0.7, 0.9, 1.2].map((v) => ({ value: String(v), label: `${v} m/s${v === 0.7 ? ' · walk' : v < 0.6 ? ' · slow' : ''}` }))} />
      </Field>
      <Field label="Lens">
        <Select value={String(t.focal)} onChange={(v) => set({ focal: Number(v) })} options={[14, 18, 20, 24, 28, 35].map((v) => ({ value: String(v), label: `${v} mm` }))} />
      </Field>
      <Field label="Eye height">
        <Select value={String(t.eyeHeight)} onChange={(v) => set({ eyeHeight: Number(v) })} options={[1.2, 1.4, 1.6, 1.7].map((v) => ({ value: String(v), label: `${Math.round(v * 100)} cm` }))} />
      </Field>
    </>
  )
}

function ProjectSummary() {
  const project = useActiveProject()
  const elev = levelElevations(project.levels)
  const rows = project.levels.map((l) => {
    const g = analyse(project.walls.filter((w) => w.levelId === l.id))
    return { l, rooms: g.faces.map((f) => ({ f, info: roomFor(f, project.rooms, l.id) })) }
  })
  const total = rows.reduce((a, r) => a + r.rooms.reduce((b, x) => b + x.f.area, 0), 0)
  const { selectPlan, setActiveLevel, editPlan } = useWorkspace.getState()
  const level = project.levels.find((l) => l.id === project.activeLevelId)!
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-medium text-fg">{project.name}</h3>
        <span className="font-mono text-2xs text-dim">{total.toFixed(1)} m²</span>
      </div>
      {rows.map(({ l, rooms }) => (
        <div key={l.id} className="space-y-0.5">
          <button type="button" onClick={() => setActiveLevel(l.id)} className={cn('flex w-full items-baseline justify-between text-2xs font-medium uppercase tracking-[0.08em]', l.id === project.activeLevelId ? 'text-fg' : 'text-faint hover:text-dim')}>
            <span>{l.name}</span>
            <span className="font-mono normal-case tracking-normal">+{(elev.get(l.id) ?? 0).toFixed(2)} m</span>
          </button>
          {rooms.map(({ f, info }) => (
            <button key={f.index} type="button" onClick={() => (setActiveLevel(l.id), selectPlan({ kind: 'room', id: l.id, at: f.center }))} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-xs text-dim hover:bg-hover/60 hover:text-fg">
              <span className="size-2 rounded-sm" style={{ background: (info?.floor ?? DEFAULT_FLOOR_FINISH).color }} />
              <span className="flex-1 truncate text-left">{info?.name ?? 'Room'}</span>
              <span className="font-mono text-2xs">{f.area.toFixed(1)} m²</span>
            </button>
          ))}
          {!rooms.length && <p className="px-1 text-2xs text-faint">No rooms yet.</p>}
        </div>
      ))}
      <div className="space-y-2 border-t border-line pt-2.5">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">{level.name}</span>
        <Field label="Name">
          <input className={inputCls} value={level.name} onChange={(e) => editPlan(null, (p) => ({ ...p, levels: p.levels.map((x) => (x.id === level.id ? { ...x, name: e.target.value } : x)) }))} />
        </Field>
        <Cm label="Ceiling height" value={level.height} min={2} max={6} onChange={(h, f) => edit('Ceiling height', f, (p) => ({ ...p, levels: p.levels.map((x) => (x.id === level.id ? { ...x, height: h } : x)) }))} />
        {project.levels.length > 1 && (
          <Button variant="ghost" className="ml-[100px] h-6 gap-1 px-2" onClick={actions.deleteLevel}>
            <Trash2 className="size-3" /> Delete this floor
          </Button>
        )}
      </div>
      <div className="space-y-2 border-t border-line pt-2.5">
        <span className="text-2xs font-medium uppercase tracking-[0.08em] text-faint">Walkthrough</span>
        <TourSettings />
      </div>
    </div>
  )
}
