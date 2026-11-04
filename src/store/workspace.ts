import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GenerateProgress, ProviderId, Quality, ViewTag } from '@/generation/types'

export type ShadingMode = 'wireframe' | 'solid' | 'material' | 'rendered'
export type Tool = 'select' | 'translate' | 'rotate' | 'scale'
export type PropertyTab = 'generate' | 'object' | 'render' | null

export interface MeshStats {
  vertices: number
  triangles: number
  meshes: number
}

export interface SceneObject {
  id: string
  name: string
  /** blob: URL of the GLB */
  url: string
  visible: boolean
  renderable: boolean
  source: string
  stats?: MeshStats
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

interface WorkspaceState {
  projects: Project[]
  activeProjectId: string
  selectedId: string | null
  shading: ShadingMode
  tool: Tool
  propertyTab: PropertyTab
  job: JobState
  settings: Settings

  // projects
  addProject: () => void
  closeProject: (id: string) => void
  setActiveProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  // objects
  addObject: (obj: Omit<SceneObject, 'id' | 'visible' | 'renderable'>) => string
  updateObject: (id: string, patch: Partial<SceneObject>) => void
  removeObject: (id: string) => void
  select: (id: string | null) => void
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

const uid = () => Math.random().toString(36).slice(2, 10)
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

const patchActive = (s: WorkspaceState, fn: (p: Project) => Project) => ({
  projects: s.projects.map((p) => (p.id === s.activeProjectId ? fn(p) : p)),
})

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
          return { projects, activeProjectId, selectedId: s.activeProjectId === id ? null : s.selectedId }
        }),
      setActiveProject: (id) => set({ activeProjectId: id, selectedId: null }),
      renameProject: (id, name) => set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)) })),

      addObject: (obj) => {
        const id = uid()
        set((s) =>
          patchActive(s, (p) => ({
            ...p,
            objects: [...p.objects, { ...obj, id, name: uniqueName(obj.name, p.objects.map((o) => o.name)), visible: true, renderable: true }],
          })),
        )
        set({ selectedId: id })
        return id
      },
      updateObject: (id, patch) =>
        set((s) => patchActive(s, (p) => ({ ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }))),
      removeObject: (id) => {
        const obj = activeProject(get()).objects.find((o) => o.id === id)
        if (obj) URL.revokeObjectURL(obj.url)
        set((s) => ({
          ...patchActive(s, (p) => ({ ...p, objects: p.objects.filter((o) => o.id !== id) })),
          selectedId: s.selectedId === id ? null : s.selectedId,
        }))
      },
      select: (id) => set({ selectedId: id }),

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
      // Blob URLs don't survive reloads, so only preferences persist.
      partialize: (s) => ({ settings: s.settings, shading: s.shading }),
    },
  ),
)

export const activeProject = (s: Pick<WorkspaceState, 'projects' | 'activeProjectId'>) =>
  s.projects.find((p) => p.id === s.activeProjectId) ?? s.projects[0]

export const useActiveProject = () => useWorkspace(activeProject)
