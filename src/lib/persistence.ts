import type { ViewTag } from '@/generation/types'
import { DEFAULT_ANIMATION, useWorkspace, type Animation, type CameraPose, type MaterialOverride, type Project, type SceneObject, type ShadeMode, type Transform } from '@/store/workspace'

/**
 * Projects, meshes and input photos survive reloads via IndexedDB.
 * Layout: `blobs` store (id → Blob) + one `state` record with the project tree.
 * Blobs are written once when they first appear; the tree is rewritten (debounced) on change.
 */

const DB_NAME = '3d-workspace'
const VERSION = 1

interface StoredObject {
  id: string
  name: string
  source: string
  visible: boolean
  renderable: boolean
  transform: Transform
  shade?: ShadeMode
  material?: MaterialOverride | null
}
interface StoredImage {
  id: string
  name: string
  type: string
  view: ViewTag
}
interface StoredState {
  activeProjectId: string
  projects: { id: string; name: string; objects: StoredObject[]; images: StoredImage[]; camera?: CameraPose | null; animation?: Animation }[]
}

let dbPromise: Promise<IDBDatabase> | null = null
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('blobs')
      req.result.createObjectStore('state')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode)
        const req = fn(t.objectStore(store))
        t.oncomplete = () => resolve(req ? req.result : undefined)
        t.onerror = () => reject(t.error)
      }),
  )
}

const written = new Set<string>()

async function save() {
  const { projects, activeProjectId } = useWorkspace.getState()
  const blobs: [string, Blob][] = []
  const state: StoredState = {
    activeProjectId,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      camera: p.camera,
      animation: p.animation,
      objects: p.objects.map((o) => {
        blobs.push([o.id, o.blob])
        return { id: o.id, name: o.name, source: o.source, visible: o.visible, renderable: o.renderable, transform: o.transform, shade: o.shade, material: o.material }
      }),
      images: p.images.map((i) => {
        blobs.push([i.id, i.file])
        return { id: i.id, name: i.file.name, type: i.file.type, view: i.view }
      }),
    })),
  }
  const fresh = blobs.filter(([id]) => !written.has(id))
  if (fresh.length) {
    await tx('blobs', 'readwrite', (s) => void fresh.forEach(([id, b]) => s.put(b, id)))
    fresh.forEach(([id]) => written.add(id))
  }
  await tx('state', 'readwrite', (s) => s.put(state, 'root'))
}

/** Drop blobs nothing references any more (runs once after load). */
async function collectGarbage(keep: Set<string>) {
  const keys = (await tx<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys())) ?? []
  const stale = keys.filter((k) => !keep.has(String(k)))
  if (stale.length) await tx('blobs', 'readwrite', (s) => void stale.forEach((k) => s.delete(k)))
}

async function load(): Promise<boolean> {
  const state = await tx<StoredState>('state', 'readonly', (s) => s.get('root'))
  if (!state?.projects?.length) return false
  const get = (id: string) => tx<Blob>('blobs', 'readonly', (s) => s.get(id))

  const projects: Project[] = await Promise.all(
    state.projects.map(async (p) => {
      const objects = (
        await Promise.all(
          p.objects.map(async (o): Promise<SceneObject | null> => {
            const blob = await get(o.id)
            if (!blob) return null
            written.add(o.id)
            return { ...o, shade: o.shade ?? 'auto', material: o.material ?? null, blob, url: URL.createObjectURL(blob) }
          }),
        )
      ).filter((o): o is SceneObject => !!o)
      // v1 used an 'auto' tag; it maps to front for the first image, detail for the rest.
      let hasFront = p.images.some((i) => i.view === 'front')
      const images = (
        await Promise.all(
          p.images.map(async (i) => {
            const blob = await get(i.id)
            if (!blob) return null
            written.add(i.id)
            const file = new File([blob], i.name, { type: i.type })
            return { id: i.id, file, url: URL.createObjectURL(file), view: i.view }
          }),
        )
      )
        .filter((i) => !!i)
        .map((i) => {
          if ((i.view as string) !== 'auto') return i
          const view = hasFront ? ('detail' as const) : ('front' as const)
          hasFront = true
          return { ...i, view }
        })
      return { id: p.id, name: p.name, objects, images, camera: p.camera ?? null, animation: { ...DEFAULT_ANIMATION, ...p.animation } }
    }),
  )

  // Don't clobber anything the user did while we were loading.
  const now = useWorkspace.getState()
  const untouched = now.projects.length === 1 && !now.projects[0].objects.length && !now.projects[0].images.length
  if (!untouched) return false
  const active = projects.some((p) => p.id === state.activeProjectId) ? state.activeProjectId : projects[0].id
  now.replaceProjects(projects, active)
  void collectGarbage(new Set(written))
  return true
}

export async function initPersistence() {
  if (typeof indexedDB === 'undefined') return
  try {
    await load()
  } catch (e) {
    console.warn('[persistence] load failed', e)
  }
  let timer = 0
  useWorkspace.subscribe((s, prev) => {
    if (s.projects === prev.projects && s.activeProjectId === prev.activeProjectId) return
    clearTimeout(timer)
    timer = window.setTimeout(() => save().catch((e) => console.warn('[persistence] save failed', e)), 400)
  })
}
