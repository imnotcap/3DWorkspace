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
}

export interface Transform {
  position: Vec3
  /** Euler XYZ, radians */
  rotation: Vec3
  scale: Vec3
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
  stats?: MeshStats
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
}

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
  quality: Quality
  removeBackground: boolean
  seed: number | null
  showGrid: boolean
  showStats: boolean
  exposure: number
  envIntensity: number
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

  // projects
  addProject: () => void
  closeProject: (id: string) => void
  setActiveProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  replaceProjects: (projects: Project[], activeId: string) => void
  // objects
  addObject: (obj: { name: string; blob: Blob; source: string }, projectId?: string) => string
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
}

const HISTORY_LIMIT = 64

export const uid = () => Math.random().toString(36).slice(2, 10)
export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
const newProject = (name: string): Project => ({ id: uid(), name, objects: [], images: [] })

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
      settings: {
        providerId: 'hf-space',
        spaceId: 'tencent/Hunyuan3D-2mv',
        hfToken: '',
        workerUrl: 'http://localhost:8000',
        quality: 'standard',
        removeBackground: true,
        seed: null,
        showGrid: true,
        showStats: true,
        exposure: 1,
        envIntensity: 1,
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

      addObject: ({ name, blob, source }, projectId) => {
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

      addImages: (files) =>
        set((s) =>
          patchActive(s, (p) => ({
            ...p,
            images: [
              ...p.images,
              ...files.filter((f) => f.type.startsWith('image/')).map((file) => ({ id: uid(), file, url: URL.createObjectURL(file), view: 'auto' as ViewTag })),
            ],
          })),
        ),
      setImageView: (id, view) =>
        set((s) => patchActive(s, (p) => ({ ...p, images: p.images.map((i) => (i.id === id ? { ...i, view } : i)) }))),
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
    }),
    {
      name: 'workspace',
      version: 1,
      // Preferences only; projects and meshes persist to IndexedDB (lib/persistence.ts).
      partialize: (s) => ({ settings: s.settings, shading: s.shading }),
    },
  ),
)

export const activeProject = (s: Pick<WorkspaceState, 'projects' | 'activeProjectId'>) =>
  s.projects.find((p) => p.id === s.activeProjectId) ?? s.projects[0]

export const useActiveProject = () => useWorkspace(activeProject)
