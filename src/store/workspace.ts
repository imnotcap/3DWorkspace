import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GenerateProgress, Quality, ViewTag } from '@/generation/types'

export type ShadingMode = 'wireframe' | 'solid' | 'material' | 'rendered'
export type Tool = 'select' | 'translate' | 'rotate' | 'scale'
export type PropertyTab = 'generate' | 'object' | 'render' | null
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

/** Real-world size in metres; any axis may be left out. */
export type RealSize = { x?: number; y?: number; z?: number }

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

export interface SceneObject {
  id: string
  name: string
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
  /** Scale to this real size once the mesh has loaded (from the project's spec dimensions). */
  fitSize?: RealSize | null
  error?: string
}

/** One part of the Front photo, as SAM 3 split it (or as you clicked it). */
export interface Segment {
  id: string
  name: string
  /** Folder name for repeated parts (Leg 1…4 → "Leg"). */
  group?: string | null
  color: string
  /** PNG, white = part, same size as the photo sent to the server. */
  mask: Blob
  area: number
  /** [x0, y0, x1, y1] in photo pixels */
  bbox: [number, number, number, number]
  enabled: boolean
}

export interface Segmentation {
  /** The Front image these masks belong to. */
  imageId: string
  width: number
  height: number
  objectLabel: string
  segments: Segment[]
  /** What SAM 3 was asked for; if you change it before generating, the parts are found again… */
  prompt: PartPrompt & { auto: boolean }
  /** …unless you edited the parts by hand (then your edits are kept). */
  edited: boolean
}

/** What to look for in the Front photo. */
export interface PartPrompt {
  /** The object, e.g. "office chair". */
  object: string
  /** Its parts, comma-separated, e.g. "seat, backrest, armrest, wheel". Empty = find them automatically. */
  parts: string
}

export interface InputImage {
  id: string
  file: File
  url: string
  view: ViewTag
}

export interface Project {
  id: string
  name: string
  objects: SceneObject[]
  images: InputImage[]
  /** null = automatic product framing */
  camera: CameraPose | null
  /** Spec-sheet dimensions applied to every mesh generated in this project. */
  realSize: RealSize | null
  /** Default render angle (radians), e.g. the Front photo's camera. */
  autoAngles?: { azimuth: number; polar: number } | null
  animation: Animation
  prompt: PartPrompt
  segmentation: Segmentation | null
}

export type RenderJob = { kind: 'image' | 'video'; done: number; total: number; message: string } | null

export type JobState =
  | { status: 'idle' }
  | ({ status: 'running'; startedAt: number } & GenerateProgress)
  | { status: 'error'; message: string; hint?: string }
  | { status: 'done'; message: string }

/** How a SAM 3D model is stood upright: by its main part's own up axis, or by the photo's horizon. */
export type LevelMode = 'part' | 'camera'

export interface Settings {
  /** Where the SAM 3D server runs: a URL (http://localhost:7860) or a Hugging Face Space id (user/space). */
  sam3dServer: string
  hfToken: string
  quality: Quality
  seed: number | null
  level: LevelMode
  /** With no part names, let SAM 3 find the parts (else the whole object is one part). */
  autoParts: boolean
  showGrid: boolean
  showStats: boolean
  exposure: number
  envIntensity: number
  renderWidth: number
  renderHeight: number
  transparent: boolean
  refOpacity: number
  showTimeline: boolean
  /** Keep API keys in this browser's storage. Off = keys live in memory until the tab closes. */
  rememberKeys: boolean
}

/** Undo entry: the active project's object list before a change. */
interface Snapshot {
  projectId: string
  label: string
  objects: SceneObject[]
}

interface WorkspaceState {
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

  // projects
  addProject: () => void
  closeProject: (id: string) => void
  setActiveProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  replaceProjects: (projects: Project[], activeId: string) => void
  // objects
  addObject: (obj: { name: string; blob?: Blob; primitive?: Primitive; source: string; fitSize?: RealSize | null; exact?: boolean; spec?: unknown; transform?: Transform; material?: MaterialOverride | null }, projectId?: string) => string
  /** One undo step: a whole hierarchy (model → groups → parts). `parent` indexes into `nodes`; returns the new ids. */
  addTree: (nodes: TreeNode[], projectId?: string) => string[]
  /** Move an object into another parent (or to the top level with null), keeping it where it is on screen. */
  reparent: (id: string, parentId: string | null, transform: Transform) => void
  /** One undo step: remove `id` and add `objects` in its place (Separate into parts). */
  replaceObject: (id: string, objects: Omit<SceneObject, 'id'>[]) => void
  duplicateObject: (id: string) => string | null
  setAutoAngles: (angles: { azimuth: number; polar: number } | null, projectId?: string) => void
  /** Silent update (stats, live scrubbing). Use `commit` for undoable edits. */
  updateObject: (id: string, patch: Partial<SceneObject>) => void
  /** Undoable update. */
  commit: (label: string, id: string, patch: Partial<SceneObject>) => void
  removeObject: (id: string) => void
  select: (id: string | null) => void
  checkpoint: (label: string) => void
  undo: () => void
  redo: () => void
  // images
  addImages: (files: File[]) => void
  setImageView: (id: string, view: ViewTag) => void
  removeImage: (id: string) => void
  clearImages: () => void
  // segmentation (active project)
  setPrompt: (patch: Partial<PartPrompt>) => void
  setSegmentation: (seg: Segmentation | null, projectId?: string) => void
  updateSegment: (id: string, patch: Partial<Segment>) => void
  // ui
  setShading: (m: ShadingMode) => void
  setTool: (t: Tool) => void
  setPropertyTab: (t: PropertyTab) => void
  setJob: (j: JobState) => void
  updateSettings: (patch: Partial<Settings>) => void
  forgetKeys: () => void
  // camera + animation (active project)
  setCamera: (pose: CameraPose | null) => void
  setRealSize: (size: RealSize | null) => void
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
}

/** A new object in `addTree`; `parent` is the index of its parent in the same list. */
export type TreeNode = Omit<SceneObject, 'id' | 'parentId'> & { parent?: number }

const HISTORY_LIMIT = 64

export const uid = () => Math.random().toString(36).slice(2, 10)
export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
export const DEFAULT_ANIMATION: Animation = { fps: 30, start: 0, end: 120, interpolation: 'ease', keys: [] }
export const DEFAULT_PROMPT: PartPrompt = { object: '', parts: '' }
const newProject = (name: string): Project => ({ id: uid(), name, objects: [], images: [], camera: null, realSize: null, animation: DEFAULT_ANIMATION, prompt: DEFAULT_PROMPT, segmentation: null })

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

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
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
      settings: {
        sam3dServer: 'http://localhost:7860',
        hfToken: '',
        quality: 'high',
        seed: null,
        level: 'part',
        autoParts: true,
        showGrid: true,
        showStats: true,
        exposure: 1,
        envIntensity: 1,
        renderWidth: 3840,
        renderHeight: 2160,
        transparent: false,
        refOpacity: 0,
        showTimeline: true,
        rememberKeys: false,
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
          closing?.images.forEach((i) => URL.revokeObjectURL(i.url))
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
      setActiveProject: (id) => set({ activeProjectId: id, selectedId: null }),
      renameProject: (id, name) => set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)) })),
      replaceProjects: (projects, activeProjectId) => set({ projects, activeProjectId, selectedId: null, past: [], future: [] }),

      checkpoint: (label) =>
        set((s) => {
          const p = activeProject(s)
          return { past: [...s.past, { projectId: p.id, label, objects: p.objects }].slice(-HISTORY_LIMIT), future: [] }
        }),

      setAutoAngles: (autoAngles, projectId) => set((s) => patchProject(s, projectId ?? s.activeProjectId, (p) => ({ ...p, autoAngles }))),
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
                url: o.blob ? URL.createObjectURL(o.blob) : undefined,
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
              return { ...n, id: ids[i], name, parentId: parent === undefined ? null : ids[parent], url: n.blob ? URL.createObjectURL(n.blob) : undefined }
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
      addObject: ({ name, blob, primitive, source, fitSize, exact, spec, transform, material }, projectId) => {
        const id = uid()
        const target = projectId ?? get().activeProjectId
        if (target === get().activeProjectId) get().checkpoint('Add')
        set((s) => ({
          ...patchProject(s, target, (p) => ({
            ...p,
            objects: [
              ...p.objects,
              {
                id,
                name: uniqueName(name, p.objects.map((o) => o.name)),
                blob,
                url: blob ? URL.createObjectURL(blob) : undefined,
                primitive,
                source,
                visible: true,
                renderable: true,
                transform: transform ?? IDENTITY,
                // Primitives already have correct normals; Auto Smooth is for generated meshes.
                shade: primitive ? 'original' : 'auto',
                material: material ?? null,
                fitSize: fitSize ?? null,
                exact,
                spec,
              },
            ],
          })),
          selectedId: target === s.activeProjectId ? id : s.selectedId,
        }))
        return id
      },
      updateObject: (id, patch) =>
        set((s) => patchActive(s, (p) => ({ ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }))),
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
      select: (id) => set({ selectedId: id }),

      undo: () =>
        set((s) => {
          const entry = s.past.at(-1)
          if (!entry) return {}
          const current = s.projects.find((p) => p.id === entry.projectId)
          if (!current) return { past: s.past.slice(0, -1) }
          const ids = new Set(entry.objects.map((o) => o.id))
          return {
            ...patchProject(s, entry.projectId, (p) => ({ ...p, objects: entry.objects })),
            activeProjectId: entry.projectId,
            selectedId: s.selectedId && ids.has(s.selectedId) ? s.selectedId : null,
            past: s.past.slice(0, -1),
            future: [...s.future, { ...entry, objects: current.objects }],
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
            ...patchProject(s, entry.projectId, (p) => ({ ...p, objects: entry.objects })),
            activeProjectId: entry.projectId,
            selectedId: s.selectedId && ids.has(s.selectedId) ? s.selectedId : null,
            future: s.future.slice(0, -1),
            past: [...s.past, { ...entry, objects: current.objects }],
          }
        }),

      // First image becomes Front; the rest default to Detail until the user tags them as a side view.
      addImages: (files) =>
        set((s) =>
          patchActive(s, (p) => {
            let hasFront = p.images.some((i) => i.view === 'front')
            const added = files
              .filter((f) => f.type.startsWith('image/'))
              .map((file) => {
                const view: ViewTag = hasFront ? 'detail' : 'front'
                hasFront = true
                return { id: uid(), file, url: URL.createObjectURL(file), view }
              })
            return { ...p, images: [...p.images, ...added] }
          }),
        ),
      // A geometry view can only be held by one image; the previous holder becomes Detail.
      setImageView: (id, view) =>
        set((s) =>
          patchActive(s, (p) => {
            const images = p.images.map((i) => (i.id === id ? { ...i, view } : view !== 'detail' && i.view === view ? { ...i, view: 'detail' as ViewTag } : i))
            return { ...p, images, segmentation: keepSegmentation(p.segmentation, images) }
          }),
        ),
      removeImage: (id) =>
        set((s) =>
          patchActive(s, (p) => {
            const img = p.images.find((i) => i.id === id)
            if (img) URL.revokeObjectURL(img.url)
            const images = p.images.filter((i) => i.id !== id)
            return { ...p, images, segmentation: keepSegmentation(p.segmentation, images) }
          }),
        ),
      clearImages: () =>
        set((s) =>
          patchActive(s, (p) => {
            p.images.forEach((i) => URL.revokeObjectURL(i.url))
            return { ...p, images: [], segmentation: null }
          }),
        ),

      setPrompt: (patch) => set((s) => patchActive(s, (p) => ({ ...p, prompt: { ...p.prompt, ...patch } }))),
      setSegmentation: (segmentation, projectId) => set((s) => patchProject(s, projectId ?? s.activeProjectId, (p) => ({ ...p, segmentation }))),
      updateSegment: (id, patch) =>
        set((s) =>
          patchActive(s, (p) =>
            p.segmentation ? { ...p, segmentation: { ...p.segmentation, edited: true, segments: p.segmentation.segments.map((g) => (g.id === id ? { ...g, ...patch } : g)) } } : p,
          ),
        ),

      setShading: (shading) => set({ shading }),
      setTool: (tool) => set({ tool }),
      setPropertyTab: (propertyTab) => set({ propertyTab }),
      setJob: (job) => set({ job }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      forgetKeys: () => set((s) => ({ settings: { ...s.settings, hfToken: '', rememberKeys: false } })),

      setCamera: (camera) => set((s) => patchActive(s, (p) => ({ ...p, camera }))),
      setRealSize: (realSize) => set((s) => patchActive(s, (p) => ({ ...p, realSize }))),
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
    }),
    {
      name: 'workspace',
      version: 5,
      migrate: (persisted, version) => {
        const p = persisted as { settings?: Partial<Settings> & Record<string, unknown>; shading?: ShadingMode }
        // v4: keys are memory-only by default. Anyone who already had a saved key keeps it saved.
        if (version < 4 && p.settings) p.settings.rememberKeys = !!(p.settings.hfToken || p.settings.anthropicKey)
        // v5: SAM 3D replaces the earlier backends; their settings are dropped.
        if (version < 5 && p.settings) {
          for (const k of ['providerId', 'spaceId', 'workerUrl', 'photogrammetryUrl', 'anthropicKey', 'claudeModel', 'claudeSelfCheck', 'removeBackground']) delete p.settings[k]
        }
        return p as never
      },
      merge: (persisted, current) => {
        const p = persisted as { settings?: Partial<Settings>; shading?: ShadingMode } | undefined
        return { ...current, ...p, settings: { ...current.settings, ...p?.settings } }
      },
      // Preferences only; projects and meshes persist to IndexedDB (lib/persistence.ts).
      // API keys are written only if the user chose "Remember on this device".
      partialize: (s) => ({
        settings: s.settings.rememberKeys ? s.settings : { ...s.settings, hfToken: '' },
        shading: s.shading,
      }),
    },
  ),
)

/** Masks stay valid only while their photo is still the Front image. */
function keepSegmentation(seg: Segmentation | null, images: InputImage[]) {
  return seg && images.some((i) => i.id === seg.imageId && i.view === 'front') ? seg : null
}

export const activeProject = (s: Pick<WorkspaceState, 'projects' | 'activeProjectId'>) =>
  s.projects.find((p) => p.id === s.activeProjectId) ?? s.projects[0]

export const useActiveProject = () => useWorkspace(activeProject)

/** Scale that makes a box of `base` size match `target`. Missing axes follow the given ones proportionally. */
export function scaleForSize(base: Vec3, target: RealSize, current: Vec3): Vec3 {
  const axes = (['x', 'y', 'z'] as const).map((k, i) => (target[k] && base[i] > 0 ? target[k]! / base[i] : null))
  const given = axes.filter((v): v is number => v !== null)
  if (!given.length) return current
  const mean = given.reduce((a, b) => a + b, 0) / given.length
  return axes.map((v) => v ?? mean) as Vec3
}
