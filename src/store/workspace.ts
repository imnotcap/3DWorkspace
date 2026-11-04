import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Level, Opening, OpeningKind, RoomInfo, Tour, Wall } from '@/plan/types'
import { wallSafeTransform } from '@/plan/constrain'

export type ShadingMode = 'wireframe' | 'solid' | 'material' | 'rendered'
export type Tool = 'select' | 'translate' | 'rotate' | 'scale'
export type PropertyTab = 'object' | 'render' | null
export type Vec3 = [number, number, number]

export interface MeshStats {
  vertices: number
  triangles: number
  meshes: number
  /** Bounding-box size at scale 1, in metres (1 unit = 1 m). */
  size: Vec3
  /** Material slots found in the mesh, with their generated colour. */
  surfaces?: { key: string; color: string }[]
}

/** A light source on a lamp: real light in the scene, on its bulb. */
export interface LightSettings {
  on: boolean
  /** Light colour (from the colour temperature, or any colour). */
  color: string
  /** Colour temperature in kelvin it was set from (null = custom colour). */
  kelvin: number | null
  /** Luminous flux in lumens (a 60 W bulb ≈ 800 lm). */
  lumens: number
}

export interface Transform {
  position: Vec3
  /** Euler XYZ, radians */
  rotation: Vec3
  scale: Vec3
}

/** Blender's Shade Flat / Smooth / Auto Smooth. */
export type ShadeMode = 'original' | 'smooth' | 'auto'

export interface MaterialOverride {
  color: string
  roughness: number
  metalness: number
  /** Keep the generated texture and tint it, instead of a flat colour. */
  keepTexture: boolean
  /** Material library preset (adds its textures and physical properties). */
  preset?: string
}

/** Orbit-style camera: spherical around a target (azimuth unwrapped, so turntables can spin 360°). */
export interface CameraPose {
  target: Vec3
  azimuth: number
  polar: number
  radius: number
  /** Focal length in mm (36×24 sensor) */
  focal: number
}

export interface ObjectKey {
  frame: number
  transform: Transform
}

export interface CameraKey {
  frame: number
  pose: CameraPose
}

/** Smooth = ease in/out, Linear = constant speed, Hold = no blending (jump at each key). */
export type Interpolation = 'ease' | 'linear' | 'constant'

export interface Animation {
  fps: number
  start: number
  end: number
  /** Camera track interpolation */
  interpolation: Interpolation
  keys: CameraKey[]
}

export type PrimitiveShape = 'box' | 'rounded_box' | 'cylinder' | 'sphere' | 'capsule' | 'torus' | 'extrude' | 'lathe'

/** A shape you model yourself: built from parameters, no file. Units are metres. */
export interface Primitive {
  shape: PrimitiveShape
  /** Same meaning as a Claude part's dims (e.g. box: [w, h, d]). */
  dims: number[]
  profile: number[][]
  material: { name: string; color: string; roughness: number; metalness: number }
}

/** A catalog piece built from parameters (sofa, kitchen cabinet, stairs…). Size in metres: width, height, depth. */
export interface FurnitureSpec {
  item: string
  size: Vec3
  options?: Record<string, string | number>
}

export interface SceneObject {
  id: string
  name: string
  /** The floor it stands on; its transform is relative to that floor. Missing = the first level. */
  levelId?: string
  /** Set for catalog furniture built from parameters. */
  furniture?: FurnitureSpec
  /** Catalog model file in public/models/ (photoreal pieces); replaces `blob`. */
  modelFile?: string
  /** The model or group this object belongs to; its transform is relative to that parent. */
  parentId?: string | null
  /** A container (a whole SAM 3D model, or a folder of parts like "Legs"): no geometry of its own. */
  isGroup?: boolean
  /** GLB bytes; persisted to IndexedDB. Absent for primitives. */
  blob?: Blob
  /** blob: URL for the loader, derived from `blob` */
  url?: string
  /** Set for objects you model yourself; replaces the GLB. */
  primitive?: Primitive
  visible: boolean
  renderable: boolean
  source: string
  transform: Transform
  shade: ShadeMode
  /** Override for every surface (older objects; the UI now edits `surfaces`). */
  material: MaterialOverride | null
  /** Per-surface overrides, keyed by material slot name. */
  surfaces?: Record<string, MaterialOverride>
  stats?: MeshStats
  /** Built at real size (metres); the viewport doesn't rescale it. */
  exact?: boolean
  /** Use the GLB's own coordinates as they are (no recentring): its transform was computed for them (SAM 3D parts). */
  keepOrigin?: boolean
  /** Claude parts description, for refining. */
  spec?: unknown
  /** Transform keyframes; when present they drive the object instead of `transform`. */
  keys?: ObjectKey[]
  /** How this object's keys blend (default: smooth). */
  interpolation?: Interpolation
  /** Lamps: the light it gives off. */
  light?: LightSettings
  error?: string
}

export interface Project {
  id: string
  name: string
  objects: SceneObject[]
  /** null = automatic framing */
  camera: CameraPose | null
  animation: Animation
  // The house
  levels: Level[]
  activeLevelId: string
  walls: Wall[]
  openings: Opening[]
  rooms: RoomInfo[]
  tour: Tour
  /** The render camera follows the tour (walkthrough video) instead of camera keyframes. */
  useTour: boolean
  /** An imported drawing shown under the plan (plan coordinates, metres), to trace or check against. */
  underlay?: Underlay | null
}

export interface Underlay {
  blob: Blob
  url: string
  x: number
  y: number
  w: number
  h: number
  opacity: number
}

/** Everything in the house plan, as one undoable unit. */
export type PlanData = Pick<Project, 'levels' | 'walls' | 'openings' | 'rooms' | 'tour'>

export type View = 'plan' | '3d' | 'split'
export type PlanTool = 'select' | 'wall' | 'arc' | 'room' | 'door' | 'window' | 'tour'
/** A selected plan element. Rooms are picked by a point inside them (`at`), walls optionally by side. */
export type PlanSelection = { kind: 'wall' | 'opening' | 'room' | 'tour' | 'level'; id: string; side?: 'left' | 'right'; at?: [number, number] } | null

export type RenderJob = { kind: 'image' | 'video'; done: number; total: number; message: string } | null

export type JobState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: number; message: string; progress?: number }
  | { status: 'error'; message: string; hint?: string }
  | { status: 'done'; message: string }

/** Path tracing (like Cycles) or the real-time rasteriser (like Eevee). */
export type RenderEngine = 'pathtrace' | 'raster'
/** Daylight outside: full day, a low warm sun, or night (only the lamps light the rooms). */
export type Ambience = 'day' | 'evening' | 'night'

export interface Settings {
  showGrid: boolean
  showStats: boolean
  exposure: number
  envIntensity: number
  renderWidth: number
  renderHeight: number
  transparent: boolean
  showTimeline: boolean
  /** OpenAI (ChatGPT) API key for photoreal PDF images. Memory only unless `rememberKeys`. */
  openaiKey: string
  rememberKeys: boolean
  /** PDF room images: turn each path-traced render into a photograph with OpenAI's image model. */
  aiPhotos: boolean
  aiModel: string
  /** Final renders (F12, video, PDF): path traced or real-time. */
  engine: RenderEngine
  /** Path-tracing samples per pixel for still images (and PDF renders). */
  samples: number
  /** Samples per frame for animations. */
  videoSamples: number
  /** Most samples the Rendered viewport accumulates before it stops. */
  viewportSamples: number
  /** Light bounces. */
  bounces: number
  /** Smooth the remaining path-tracing noise. */
  denoise: boolean
  ambience: Ambience
  /** Ceilings in the 3D view (renders and the tour always have them). */
  showCeilings: boolean
  /** Show the floors above the active one in 3D. */
  showUpperLevels: boolean
  /** Plan snapping grid, m. */
  grid: number
  /** Thickness of new walls, m. */
  wallThickness: number
  /** Snap to the grid: plan drawing and dragging, and the 3D gizmo (move by the grid, rotate by 15°). */
  snap: boolean
  /** The right-hand sidebar (catalog, scene, inspector) is open. */
  sidebar: boolean
}

/** Undo entry: the active project's object list before a change. */
interface Snapshot {
  projectId: string
  label: string
  objects: SceneObject[]
  plan: PlanData
}

/** The workspaces overview, or one project open in the planner. */
export type Screen = 'home' | 'editor'

interface WorkspaceState {
  screen: Screen
  setScreen: (s: Screen) => void
  /** Open a project in the planner. */
  openProject: (id: string) => void
  projects: Project[]
  activeProjectId: string
  selectedId: string | null
  shading: ShadingMode
  tool: Tool
  propertyTab: PropertyTab
  job: JobState
  settings: Settings
  past: Snapshot[]
  future: Snapshot[]
  frame: number
  playing: boolean
  cameraView: boolean
  renderJob: RenderJob
  view: View
  planTool: PlanTool
  planSel: PlanSelection
  /** Catalog item being placed (follows the pointer until you click). */
  placing: string | null
  openingKind: OpeningKind

  // projects
  addProject: () => void
  closeProject: (id: string) => void
  setActiveProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  replaceProjects: (projects: Project[], activeId: string) => void
  // objects
  addObject: (obj: { name: string; blob?: Blob; modelFile?: string; primitive?: Primitive; furniture?: FurnitureSpec; surfaces?: Record<string, MaterialOverride>; light?: LightSettings; levelId?: string; source: string; exact?: boolean; spec?: unknown; transform?: Transform; material?: MaterialOverride | null }, projectId?: string) => string
  /** One undo step: a whole hierarchy (model → groups → parts). `parent` indexes into `nodes`; returns the new ids. */
  addTree: (nodes: TreeNode[], projectId?: string) => string[]
  /** Move an object into another parent (or to the top level with null), keeping it where it is on screen. */
  reparent: (id: string, parentId: string | null, transform: Transform) => void
  /** One undo step: remove `id` and add `objects` in its place (Separate into parts). */
  replaceObject: (id: string, objects: Omit<SceneObject, 'id'>[]) => void
  /** One undo step: remove `remove` and add `objects` (e.g. re-placing a room's sockets). */
  swapObjects: (label: string, remove: string[], objects: Omit<SceneObject, 'id'>[]) => void
  duplicateObject: (id: string) => string | null
  /** Silent update (stats, live scrubbing). Use `commit` for undoable edits. */
  updateObject: (id: string, patch: Partial<SceneObject>) => void
  /** Undoable update. */
  commit: (label: string, id: string, patch: Partial<SceneObject>) => void
  removeObject: (id: string) => void
  select: (id: string | null) => void
  checkpoint: (label: string) => void
  undo: () => void
  redo: () => void
  // ui
  setShading: (m: ShadingMode) => void
  setTool: (t: Tool) => void
  setPropertyTab: (t: PropertyTab) => void
  setJob: (j: JobState) => void
  updateSettings: (patch: Partial<Settings>) => void
  // camera + animation (active project)
  setCamera: (pose: CameraPose | null) => void
  setObjectKey: (id: string, frame: number, transform: Transform, label?: string) => void
  removeObjectKey: (id: string, frame: number) => void
  setObjectKeys: (id: string, keys: ObjectKey[]) => void
  updateAnimation: (patch: Partial<Animation>) => void
  setKey: (frame: number, pose: CameraPose) => void
  removeKey: (frame: number) => void
  setFrame: (f: number) => void
  setPlaying: (p: boolean) => void
  setCameraView: (v: boolean) => void
  setRenderJob: (j: RenderJob) => void
  // house plan (active project)
  /** Change the plan. With a label it is one undo step; without, it is a live edit (call checkpoint first). */
  editPlan: (label: string | null, fn: (plan: PlanData) => PlanData) => void
  setActiveLevel: (id: string) => void
  setView: (v: View) => void
  setPlanTool: (t: PlanTool) => void
  selectPlan: (sel: PlanSelection) => void
  setPlacing: (item: string | null) => void
  setOpeningKind: (k: OpeningKind) => void
  setUseTour: (on: boolean) => void
  setUnderlay: (u: Underlay | null) => void
  /** Replace the active project's contents (a template). */
  loadTemplate: (t: Pick<Project, 'name' | 'levels' | 'walls' | 'openings' | 'rooms' | 'tour'> & { objects: Omit<SceneObject, 'id'>[] }) => void
}

/** A new object in `addTree`; `parent` is the index of its parent in the same list. */
export type TreeNode = Omit<SceneObject, 'id' | 'parentId'> & { parent?: number }

const HISTORY_LIMIT = 64

export const uid = () => Math.random().toString(36).slice(2, 10)
export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
export const DEFAULT_ANIMATION: Animation = { fps: 30, start: 0, end: 120, interpolation: 'ease', keys: [] }
export const DEFAULT_TOUR: Tour = { points: [], speed: 0.7, eyeHeight: 1.6, focal: 20 }
export const newLevel = (name: string, elevation = 0): Level => ({ id: uid(), name, elevation, height: 2.6, slab: 0.25 })
function newProject(name: string): Project {
  const ground = newLevel('Ground floor')
  return {
    id: uid(),
    name,
    objects: [],
    camera: null,
    animation: DEFAULT_ANIMATION,
    levels: [ground],
    activeLevelId: ground.id,
    walls: [],
    openings: [],
    rooms: [],
    tour: DEFAULT_TOUR,
    useTour: false,
  }
}
const planOf = (p: Project): PlanData => ({ levels: p.levels, walls: p.walls, openings: p.openings, rooms: p.rooms, tour: p.tour })

/** `id` and everything nested under it, parents before children. */
export function subtreeIds(objects: SceneObject[], id: string): string[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const o of objects) if (o.parentId === out[i]) out.push(o.id)
  return out
}

/** The chain of parents above `id`, nearest first. */
export function ancestorIds(objects: SceneObject[], id: string): string[] {
  const out: string[] = []
  const byId = new Map(objects.map((o) => [o.id, o]))
  for (let p = byId.get(id)?.parentId; p && !out.includes(p); p = byId.get(p)?.parentId) out.push(p)
  return out
}

export const modelUrl = (file: string) => `${import.meta.env.BASE_URL}models/${file}`

/** Blender-style unique names: Mesh, Mesh.001, Mesh.002 … */
function uniqueName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base
  for (let i = 1; ; i++) {
    const n = `${base}.${String(i).padStart(3, '0')}`
    if (!taken.includes(n)) return n
  }
}

const first = newProject('Untitled')

const patchProject = (s: WorkspaceState, projectId: string, fn: (p: Project) => Project) => ({
  projects: s.projects.map((p) => (p.id === projectId ? fn(p) : p)),
})
const patchActive = (s: WorkspaceState, fn: (p: Project) => Project) => patchProject(s, s.activeProjectId, fn)

/** Furniture never ends up inside a wall: whatever moved, resized or loaded it, it is pushed back out. */
function clear(p: Pick<Project, 'walls' | 'openings' | 'levels'>, o: SceneObject): SceneObject {
  const transform = wallSafeTransform(p, o)
  return transform === o.transform ? o : { ...o, transform }
}
const MOVES: (keyof SceneObject)[] = ['transform', 'furniture', 'stats']

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      screen: 'home',
      setScreen: (screen) => set({ screen }),
      openProject: (id) => set({ activeProjectId: id, selectedId: null, planSel: null, screen: 'editor', playing: false, cameraView: false }),
      projects: [first],
      activeProjectId: first.id,
      selectedId: null,
      shading: 'material',
      tool: 'select',
      propertyTab: null,
      job: { status: 'idle' },
      past: [],
      future: [],
      frame: 0,
      playing: false,
      cameraView: false,
      renderJob: null,
      view: 'split',
      planTool: 'select',
      planSel: null,
      placing: null,
      openingKind: 'door',
      settings: {
        showGrid: true,
        showStats: true,
        exposure: 1,
        envIntensity: 1,
        renderWidth: 3840,
        renderHeight: 2160,
        transparent: false,
        showTimeline: true,
        openaiKey: '',
        rememberKeys: false,
        aiPhotos: false,
        aiModel: 'gpt-image-1',
        engine: 'pathtrace',
        samples: 256,
        videoSamples: 64,
        viewportSamples: 256,
        bounces: 6,
        denoise: true,
        ambience: 'day',
        showCeilings: false,
        showUpperLevels: false,
        grid: 0.05,
        wallThickness: 0.15,
        snap: true,
        sidebar: true,
      },

      addProject: () =>
        set((s) => {
          const p = newProject(uniqueName('Untitled', s.projects.map((x) => x.name)))
          return { projects: [...s.projects, p], activeProjectId: p.id, selectedId: null }
        }),
      closeProject: (id) =>
        set((s) => {
          const closing = s.projects.find((p) => p.id === id)
          closing?.objects.forEach((o) => o.url && URL.revokeObjectURL(o.url))
          let projects = s.projects.filter((p) => p.id !== id)
          if (!projects.length) projects = [newProject('Untitled')]
          const idx = s.projects.findIndex((p) => p.id === id)
          const activeProjectId = s.activeProjectId === id ? projects[Math.max(0, idx - 1)].id : s.activeProjectId
          return {
            projects,
            activeProjectId,
            selectedId: s.activeProjectId === id ? null : s.selectedId,
            past: s.past.filter((h) => h.projectId !== id),
            future: s.future.filter((h) => h.projectId !== id),
          }
        }),
      setActiveProject: (id) => set({ activeProjectId: id, selectedId: null, planSel: null }),
      renameProject: (id, name) => set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)) })),
      // Saved projects are brought in line too: anything that was inside a wall comes out of it.
      replaceProjects: (projects, activeProjectId) => set({ projects: projects.map((p) => ({ ...p, objects: p.objects.map((o) => clear(p, o)) })), activeProjectId, selectedId: null, past: [], future: [] }),

      checkpoint: (label) =>
        set((s) => {
          const p = activeProject(s)
          return { past: [...s.past, { projectId: p.id, label, objects: p.objects, plan: planOf(p) }].slice(-HISTORY_LIMIT), future: [] }
        }),

      replaceObject: (id, objects) => {
        get().checkpoint('Separate')
        const ids = objects.map(() => uid())
        set((s) =>
          ({
            ...patchActive(s, (p) => {
              const taken = p.objects.filter((o) => o.id !== id).map((o) => o.name)
              const added = objects.map((o, i) => {
                const name = uniqueName(o.name, taken)
                taken.push(name)
                return { ...o, id: ids[i], name }
              })
              return { ...p, objects: [...p.objects.filter((o) => o.id !== id), ...added] }
            }),
            selectedId: ids[0] ?? null,
          }),
        )
      },
      swapObjects: (label, remove, objects) => {
        get().checkpoint(label)
        const gone = new Set(remove)
        set((s) =>
          patchActive(s, (p) => {
            const taken = p.objects.filter((o) => !gone.has(o.id)).map((o) => o.name)
            const added = objects.map((o) => {
              const name = uniqueName(o.name, taken)
              taken.push(name)
              return { ...o, id: uid(), name }
            })
            return { ...p, objects: [...p.objects.filter((o) => !gone.has(o.id)), ...added] }
          }),
        )
      },
      duplicateObject: (id) => {
        const objects = activeProject(get()).objects
        const src = objects.find((o) => o.id === id)
        if (!src) return null
        get().checkpoint('Duplicate')
        // The copy takes everything nested under the original with it.
        const ids = subtreeIds(objects, id)
        const fresh = new Map(ids.map((i) => [i, uid()]))
        const nid = fresh.get(id)!
        // Top-level copies sit next to the original (Blender would start a grab); parts stay in place, inside the same model.
        const w = (src.stats?.size[0] ?? 0.5) * src.transform.scale[0]
        const transform = src.parentId ? src.transform : { ...src.transform, position: [src.transform.position[0] + w * 1.1, src.transform.position[1], src.transform.position[2]] as Vec3 }
        set((s) => ({
          ...patchActive(s, (p) => {
            const taken = p.objects.map((o) => o.name)
            const copies = ids.map((i) => {
              const o = p.objects.find((x) => x.id === i)!
              const name = uniqueName(o.name, taken)
              taken.push(name)
              return {
                ...o,
                id: fresh.get(i)!,
                name,
                parentId: i === id ? o.parentId : fresh.get(o.parentId!)!,
                url: o.blob ? URL.createObjectURL(o.blob) : o.modelFile ? modelUrl(o.modelFile) : undefined,
                transform: i === id ? transform : o.transform,
                keys: i === id ? undefined : o.keys,
                stats: o.isGroup ? o.stats : undefined,
              }
            })
            return { ...p, objects: [...p.objects, ...copies] }
          }),
          selectedId: nid,
        }))
        return nid
      },
      addTree: (nodes, projectId) => {
        const target = projectId ?? get().activeProjectId
        if (target === get().activeProjectId) get().checkpoint('Add')
        const ids = nodes.map(() => uid())
        set((s) => ({
          ...patchProject(s, target, (p) => {
            const taken = p.objects.map((o) => o.name)
            const added: SceneObject[] = nodes.map(({ parent, ...n }, i) => {
              const name = uniqueName(n.name, taken)
              taken.push(name)
              return { levelId: p.activeLevelId, ...n, id: ids[i], name, parentId: parent === undefined ? null : ids[parent], url: n.blob ? URL.createObjectURL(n.blob) : undefined }
            })
            return { ...p, objects: [...p.objects, ...added] }
          }),
          selectedId: target === s.activeProjectId ? (ids[0] ?? null) : s.selectedId,
        }))
        return ids
      },
      reparent: (id, parentId, transform) => {
        const objects = activeProject(get()).objects
        // Never into itself or its own descendants.
        if (parentId && subtreeIds(objects, id).includes(parentId)) return
        get().checkpoint(parentId ? 'Move into group' : 'Move out of group')
        set((s) => patchActive(s, (p) => ({ ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, parentId, transform, keys: undefined } : o)) })))
      },
      addObject: ({ name, blob, modelFile, primitive, furniture, surfaces, light, levelId, source, exact, spec, transform, material }, projectId) => {
        const id = uid()
        const target = projectId ?? get().activeProjectId
        if (target === get().activeProjectId) get().checkpoint('Add')
        set((s) => ({
          ...patchProject(s, target, (p) => ({
            ...p,
            objects: [
              ...p.objects,
              clear(p, {
                id,
                name: uniqueName(name, p.objects.map((o) => o.name)),
                blob,
                modelFile,
                url: blob ? URL.createObjectURL(blob) : modelFile ? modelUrl(modelFile) : undefined,
                primitive,
                furniture,
                surfaces,
                light,
                levelId: levelId ?? p.activeLevelId,
                source,
                visible: true,
                renderable: true,
                transform: transform ?? IDENTITY,
                // Primitives and furniture already have correct normals; Auto Smooth is for generated meshes.
                shade: primitive || furniture ? 'original' : 'auto',
                material: material ?? null,
                exact,
                spec,
              }),
            ],
          })),
          selectedId: target === s.activeProjectId ? id : s.selectedId,
        }))
        return id
      },
      updateObject: (id, patch) =>
        set((s) =>
          patchActive(s, (p) => ({
            ...p,
            objects: p.objects.map((o) => (o.id !== id ? o : MOVES.some((k) => k in patch) ? clear(p, { ...o, ...patch }) : { ...o, ...patch })),
          })),
        ),
      commit: (label, id, patch) => {
        get().checkpoint(label)
        get().updateObject(id, patch)
      },
      // URLs are not revoked here: undo may bring the object back.
      // Deleting a model or group deletes everything in it.
      removeObject: (id) => {
        get().checkpoint('Delete')
        set((s) => {
          const gone = new Set(subtreeIds(activeProject(s).objects, id))
          return {
            ...patchActive(s, (p) => ({ ...p, objects: p.objects.filter((o) => !gone.has(o.id)) })),
            selectedId: s.selectedId && gone.has(s.selectedId) ? null : s.selectedId,
          }
        })
      },
      select: (id) => set(id ? { selectedId: id, planSel: null } : { selectedId: null }),

      undo: () =>
        set((s) => {
          const entry = s.past.at(-1)
          if (!entry) return {}
          const current = s.projects.find((p) => p.id === entry.projectId)
          if (!current) return { past: s.past.slice(0, -1) }
          const ids = new Set(entry.objects.map((o) => o.id))
          return {
            ...patchProject(s, entry.projectId, (p) => ({ ...p, objects: entry.objects, ...entry.plan, activeLevelId: entry.plan.levels.some((l) => l.id === p.activeLevelId) ? p.activeLevelId : entry.plan.levels[0].id })),
            activeProjectId: entry.projectId,
            selectedId: s.selectedId && ids.has(s.selectedId) ? s.selectedId : null,
            planSel: null,
            past: s.past.slice(0, -1),
            future: [...s.future, { ...entry, objects: current.objects, plan: planOf(current) }],
          }
        }),
      redo: () =>
        set((s) => {
          const entry = s.future.at(-1)
          if (!entry) return {}
          const current = s.projects.find((p) => p.id === entry.projectId)
          if (!current) return { future: s.future.slice(0, -1) }
          const ids = new Set(entry.objects.map((o) => o.id))
          return {
            ...patchProject(s, entry.projectId, (p) => ({ ...p, objects: entry.objects, ...entry.plan, activeLevelId: entry.plan.levels.some((l) => l.id === p.activeLevelId) ? p.activeLevelId : entry.plan.levels[0].id })),
            activeProjectId: entry.projectId,
            selectedId: s.selectedId && ids.has(s.selectedId) ? s.selectedId : null,
            planSel: null,
            future: s.future.slice(0, -1),
            past: [...s.past, { ...entry, objects: current.objects, plan: planOf(current) }],
          }
        }),

      setShading: (shading) => set({ shading }),
      setTool: (tool) => set({ tool }),
      setPropertyTab: (propertyTab) => set({ propertyTab }),
      setJob: (job) => set({ job }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      setCamera: (camera) => set((s) => patchActive(s, (p) => ({ ...p, camera }))),
      // Object keys live on the object, so they are part of undo snapshots.
      setObjectKey: (id, frame, transform, label = 'Keyframe') => {
        get().checkpoint(label)
        set((s) =>
          patchActive(s, (p) => ({
            ...p,
            objects: p.objects.map((o) =>
              o.id === id ? { ...o, transform, keys: [...(o.keys ?? []).filter((k) => k.frame !== frame), { frame, transform }].sort((a, b) => a.frame - b.frame) } : o,
            ),
          })),
        )
      },
      removeObjectKey: (id, frame) => {
        get().checkpoint('Delete Keyframe')
        set((s) => patchActive(s, (p) => ({ ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, keys: (o.keys ?? []).filter((k) => k.frame !== frame) } : o)) })))
      },
      setObjectKeys: (id, keys) => {
        get().checkpoint('Keyframes')
        set((s) => patchActive(s, (p) => ({ ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, keys } : o)) })))
      },
      updateAnimation: (patch) => set((s) => patchActive(s, (p) => ({ ...p, animation: { ...p.animation, ...patch } }))),
      setKey: (frame, pose) =>
        set((s) =>
          patchActive(s, (p) => ({
            ...p,
            animation: { ...p.animation, keys: [...p.animation.keys.filter((k) => k.frame !== frame), { frame, pose }].sort((a, b) => a.frame - b.frame) },
          })),
        ),
      removeKey: (frame) => set((s) => patchActive(s, (p) => ({ ...p, animation: { ...p.animation, keys: p.animation.keys.filter((k) => k.frame !== frame) } }))),
      setFrame: (frame) => set({ frame }),
      setPlaying: (playing) => set({ playing }),
      setCameraView: (cameraView) => set({ cameraView }),
      setRenderJob: (renderJob) => set({ renderJob }),

      editPlan: (label, fn) => {
        if (label) get().checkpoint(label)
        set((s) =>
          patchActive(s, (p) => {
            const next = { ...p, ...fn(planOf(p)) }
            // Walls that moved or thickened push the furniture they ran into.
            if (next.walls === p.walls && next.openings === p.openings && next.levels === p.levels) return next
            return { ...next, objects: next.objects.map((o) => clear(next, o)) }
          }),
        )
      },
      setActiveLevel: (activeLevelId) => set((s) => ({ ...patchActive(s, (p) => ({ ...p, activeLevelId })), planSel: null, selectedId: null })),
      setView: (view) => set({ view }),
      setPlanTool: (planTool) =>
        set((s) => {
          // The Door and Window tools each keep to their own kinds of opening.
          const door = ['door', 'double-door', 'sliding-door', 'archway'].includes(s.openingKind)
          const openingKind = planTool === 'door' && !door ? 'door' : planTool === 'window' && door ? 'window' : s.openingKind
          return { planTool, placing: null, openingKind }
        }),
      selectPlan: (planSel) => set({ planSel, selectedId: null }),
      setPlacing: (placing) => set({ placing, planTool: 'select' }),
      setOpeningKind: (openingKind) => set({ openingKind }),
      setUseTour: (useTour) => set((s) => patchActive(s, (p) => ({ ...p, useTour }))),
      setUnderlay: (underlay) => set((s) => patchActive(s, (p) => ({ ...p, underlay }))),
      loadTemplate: (t) => {
        get().checkpoint('Template')
        set((s) => ({
          ...patchActive(s, (p) => ({
            ...p,
            name: t.name,
            levels: t.levels,
            activeLevelId: t.levels[0].id,
            walls: t.walls,
            openings: t.openings,
            rooms: t.rooms,
            tour: t.tour,
            useTour: t.tour.points.length > 1,
            camera: null,
            objects: t.objects.map((o) => clear(t, { ...o, id: uid() })),
          })),
          selectedId: null,
          planSel: null,
        }))
      },
    }),
    {
      name: 'workspace',
      version: 6,
      migrate: (persisted, version) => {
        const p = persisted as { settings?: Partial<Settings> & Record<string, unknown>; shading?: ShadingMode }
        // v4: keys are memory-only by default. Anyone who already had a saved key keeps it saved.
        if (version < 4 && p.settings) p.settings.rememberKeys = !!(p.settings.hfToken || p.settings.anthropicKey)
        // v5: SAM 3D replaces the earlier backends; their settings are dropped.
        if (version < 5 && p.settings) {
          for (const k of ['providerId', 'spaceId', 'workerUrl', 'photogrammetryUrl', 'anthropicKey', 'claudeModel', 'claudeSelfCheck', 'removeBackground']) delete p.settings[k]
        }
        // v6: Photo → 3D (SAM 3D) is gone; its settings are dropped.
        if (version < 6 && p.settings) {
          for (const k of ['sam3dServer', 'hfToken', 'quality', 'seed', 'level', 'autoParts', 'refOpacity', 'rememberKeys']) delete p.settings[k]
        }
        return p as never
      },
      merge: (persisted, current) => {
        const p = persisted as { settings?: Partial<Settings>; shading?: ShadingMode } | undefined
        return { ...current, ...p, settings: { ...current.settings, ...p?.settings } }
      },
      // Preferences only; projects and meshes persist to IndexedDB (lib/persistence.ts).
      partialize: (s) => ({
        // The OpenAI key is written only if you chose "Remember on this device".
        settings: s.settings.rememberKeys ? s.settings : { ...s.settings, openaiKey: '' },
        shading: s.shading === 'rendered' ? 'material' : s.shading,
        view: s.view,
      }),
    },
  ),
)

export const activeProject = (s: Pick<WorkspaceState, 'projects' | 'activeProjectId'>) =>
  s.projects.find((p) => p.id === s.activeProjectId) ?? s.projects[0]

export const useActiveProject = () => useWorkspace(activeProject)
