import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GenerateProgress, ProviderId, Quality, ViewTag } from '@/generation/types'

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

export interface SceneObject {
  id: string
  name: string
  /** GLB bytes; persisted to IndexedDB */
  blob: Blob
  /** blob: URL for the loader, derived from `blob` */
  url: string
  visible: boolean
  renderable: boolean
  source: string
  transform: Transform
  shade: ShadeMode
  material: MaterialOverride | null
  stats?: MeshStats
  /** Transform keyframes; when present they drive the object instead of `transform`. */
  keys?: ObjectKey[]
  /** How this object's keys blend (default: smooth). */
  interpolation?: Interpolation
  /** Scale to this real size once the mesh has loaded (from the project's spec dimensions). */
  fitSize?: RealSize | null
  error?: string
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
  animation: Animation
}

export type RenderJob = { kind: 'image' | 'video'; done: number; total: number; message: string } | null

export type JobState =
  | { status: 'idle' }
  | ({ status: 'running'; startedAt: number } & GenerateProgress)
  | { status: 'error'; message: string; hint?: string }
  | { status: 'done'; message: string }

export interface Settings {
  providerId: ProviderId
  spaceId: string
  hfToken: string
  workerUrl: string
  photogrammetryUrl: string
  quality: Quality
  removeBackground: boolean
  seed: number | null
  showGrid: boolean
  showStats: boolean
  exposure: number
  envIntensity: number
  renderWidth: number
  renderHeight: number
  transparent: boolean
  refOpacity: number
  showTimeline: boolean
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
  addObject: (obj: { name: string; blob: Blob; source: string; fitSize?: RealSize | null }, projectId?: string) => string
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
  // ui
  setShading: (m: ShadingMode) => void
  setTool: (t: Tool) => void
  setPropertyTab: (t: PropertyTab) => void
  setJob: (j: JobState) => void
  updateSettings: (patch: Partial<Settings>) => void
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

const HISTORY_LIMIT = 64

export const uid = () => Math.random().toString(36).slice(2, 10)
export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
export const DEFAULT_ANIMATION: Animation = { fps: 30, start: 0, end: 120, interpolation: 'ease', keys: [] }
const newProject = (name: string): Project => ({ id: uid(), name, objects: [], images: [], camera: null, realSize: null, animation: DEFAULT_ANIMATION })

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
        providerId: 'hf-space',
        spaceId: 'microsoft/TRELLIS.2',
        hfToken: '',
        workerUrl: 'http://localhost:8000',
        photogrammetryUrl: 'http://localhost:8001',
        quality: 'high',
        removeBackground: true,
        seed: null,
        showGrid: true,
        showStats: true,
        exposure: 1,
        envIntensity: 1,
        renderWidth: 3840,
        renderHeight: 2160,
        transparent: false,
        refOpacity: 0,
        showTimeline: true,
      },

      addProject: () =>
        set((s) => {
          const p = newProject(uniqueName('Untitled', s.projects.map((x) => x.name)))
          return { projects: [...s.projects, p], activeProjectId: p.id, selectedId: null }
        }),
      closeProject: (id) =>
        set((s) => {
          const closing = s.projects.find((p) => p.id === id)
          closing?.objects.forEach((o) => URL.revokeObjectURL(o.url))
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

      addObject: ({ name, blob, source, fitSize }, projectId) => {
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
                url: URL.createObjectURL(blob),
                source,
                visible: true,
                renderable: true,
                transform: IDENTITY,
                shade: 'auto',
                material: null,
                fitSize: fitSize ?? null,
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
      removeObject: (id) => {
        get().checkpoint('Delete')
        set((s) => ({
          ...patchActive(s, (p) => ({ ...p, objects: p.objects.filter((o) => o.id !== id) })),
          selectedId: s.selectedId === id ? null : s.selectedId,
        }))
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
          patchActive(s, (p) => ({
            ...p,
            images: p.images.map((i) => (i.id === id ? { ...i, view } : view !== 'detail' && i.view === view ? { ...i, view: 'detail' as ViewTag } : i)),
          })),
        ),
      removeImage: (id) =>
        set((s) =>
          patchActive(s, (p) => {
            const img = p.images.find((i) => i.id === id)
            if (img) URL.revokeObjectURL(img.url)
            return { ...p, images: p.images.filter((i) => i.id !== id) }
          }),
        ),
      clearImages: () =>
        set((s) =>
          patchActive(s, (p) => {
            p.images.forEach((i) => URL.revokeObjectURL(i.url))
            return { ...p, images: [] }
          }),
        ),

      setShading: (shading) => set({ shading }),
      setTool: (tool) => set({ tool }),
      setPropertyTab: (propertyTab) => set({ propertyTab }),
      setJob: (job) => set({ job }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

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
      version: 3,
      // v2: textured model replaces shape-only 2mv as default. v3: TRELLIS.2 replaces Hunyuan3D-2.1 as default.
      migrate: (persisted, version) => {
        const p = persisted as { settings?: Partial<Settings>; shading?: ShadingMode }
        if (version < 2 && p.settings) {
          if (p.settings.spaceId === 'tencent/Hunyuan3D-2mv') p.settings.spaceId = 'tencent/Hunyuan3D-2.1'
          if (p.settings.quality === 'standard') p.settings.quality = 'high'
        }
        if (version < 3 && p.settings?.spaceId === 'tencent/Hunyuan3D-2.1') p.settings.spaceId = 'microsoft/TRELLIS.2'
        return p as never
      },
      merge: (persisted, current) => {
        const p = persisted as { settings?: Partial<Settings>; shading?: ShadingMode } | undefined
        return { ...current, ...p, settings: { ...current.settings, ...p?.settings } }
      },
      // Preferences only; projects and meshes persist to IndexedDB (lib/persistence.ts).
      partialize: (s) => ({ settings: s.settings, shading: s.shading }),
    },
  ),
)

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
