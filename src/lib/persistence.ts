import { DEFAULT_ANIMATION, DEFAULT_TOUR, modelUrl, newLevel, useWorkspace, type FurnitureSpec, type PlanData, type Animation, type CameraPose, type LightSettings, type Primitive, type Interpolation, type ObjectKey, type MaterialOverride, type Project, type SceneObject, type ShadeMode, type Transform } from '@/store/workspace'

/**
 * Projects and meshes survive reloads via IndexedDB.
 * Layout: `blobs` store (id → Blob) + one `state` record with the project tree.
 * Blobs are written once when they first appear; the tree is rewritten (debounced) on change.
 */

const DB_NAME = '3d-workspace'
const VERSION = 1

interface StoredObject {
  id: string
  name: string
  levelId?: string
  furniture?: FurnitureSpec
  modelFile?: string
  parentId?: string | null
  isGroup?: boolean
  keepOrigin?: boolean
  stats?: SceneObject['stats']
  source: string
  visible: boolean
  renderable: boolean
  transform: Transform
  shade?: ShadeMode
  material?: MaterialOverride | null
  light?: LightSettings
  keys?: ObjectKey[]
  interpolation?: Interpolation
  surfaces?: Record<string, MaterialOverride>
  primitive?: Primitive
  exact?: boolean
  spec?: unknown
}
interface StoredState {
  activeProjectId: string
  projects: {
    id: string
    name: string
    objects: StoredObject[]
    underlay?: { x: number; y: number; w: number; h: number; opacity: number } | null
    camera?: CameraPose | null
    animation?: Animation
    plan?: PlanData
    activeLevelId?: string
    useTour?: boolean
  }[]
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
      underlay: p.underlay ? (blobs.push([`underlay-${p.id}`, p.underlay.blob]), { x: p.underlay.x, y: p.underlay.y, w: p.underlay.w, h: p.underlay.h, opacity: p.underlay.opacity }) : null,
      plan: { levels: p.levels, walls: p.walls, openings: p.openings, rooms: p.rooms, tour: p.tour },
      activeLevelId: p.activeLevelId,
      useTour: p.useTour,
      objects: p.objects.map((o) => {
        if (o.blob) blobs.push([o.id, o.blob])
        return {
          primitive: o.primitive,
          id: o.id,
          name: o.name,
          levelId: o.levelId,
          furniture: o.furniture,
          modelFile: o.modelFile,
          parentId: o.parentId ?? null,
          isGroup: o.isGroup,
          keepOrigin: o.keepOrigin,
          // A group's size comes from its parts when it was made; keep it for the Size field.
          stats: o.isGroup ? o.stats : undefined,
          source: o.source,
          visible: o.visible,
          renderable: o.renderable,
          transform: o.transform,
          shade: o.shade,
          material: o.material,
          light: o.light,
          keys: o.keys,
          interpolation: o.interpolation,
          surfaces: o.surfaces,
          exact: o.exact,
          spec: o.spec,
        }
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
            if (o.isGroup) return { ...o, shade: o.shade ?? 'original', material: o.material ?? null }
            if (o.primitive || o.furniture) return { ...o, stats: undefined, shade: o.shade ?? 'original', material: o.material ?? null }
            if (o.modelFile) return { ...o, stats: undefined, shade: o.shade ?? 'original', material: o.material ?? null, url: modelUrl(o.modelFile) }
            const blob = await get(o.id)
            if (!blob) return null
            written.add(o.id)
            return { ...o, stats: undefined, shade: o.shade ?? 'auto', material: o.material ?? null, blob, url: URL.createObjectURL(blob) }
          }),
        )
      ).filter((o): o is SceneObject => !!o)
      // A part whose model is gone (a missing blob) moves to the top level instead of vanishing.
      const present = new Set(objects.map((o) => o.id))
      for (const o of objects) if (o.parentId && !present.has(o.parentId)) o.parentId = null
      let underlay: Project['underlay'] = null
      if (p.underlay) {
        const blob = await get(`underlay-${p.id}`)
        if (blob) {
          written.add(`underlay-${p.id}`)
          underlay = { ...p.underlay, blob, url: URL.createObjectURL(blob) }
        }
      }
      // Projects saved before levels existed get one floor.
      const levels = p.plan?.levels?.length ? p.plan.levels : [newLevel('Ground floor')]
      return {
        id: p.id,
        name: p.name,
        levels,
        activeLevelId: levels.some((l) => l.id === p.activeLevelId) ? p.activeLevelId! : levels[0].id,
        walls: p.plan?.walls ?? [],
        openings: p.plan?.openings ?? [],
        rooms: p.plan?.rooms ?? [],
        tour: { ...DEFAULT_TOUR, ...p.plan?.tour },
        useTour: !!p.useTour,
        objects,
        underlay,
        camera: p.camera ?? null,
        animation: { ...DEFAULT_ANIMATION, ...p.animation },
      }
    }),
  )

  // Don't clobber anything the user did while we were loading.
  const now = useWorkspace.getState()
  const untouched = now.projects.length === 1 && !now.projects[0].objects.length
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
