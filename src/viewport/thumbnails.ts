import { AgXToneMapping, Box3, DirectionalLight, MathUtils, PerspectiveCamera, PMREMGenerator, Scene, Sphere, Vector3, WebGLRenderer, type Material, type Mesh, type Object3D } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildFurniture } from '@/furniture/build'
import type { CatalogItem } from '@/furniture/catalog'
import { slotOverrides } from '@/plan/place'
import { modelUrl } from '@/store/workspace'
import { surfaceFor } from './shading'

/**
 * Catalog previews: each piece rendered once, three-quarter view, in its default finishes, on a
 * small offscreen renderer. Cached for the session (and in localStorage between visits).
 */
const SIZE = 256
const VERSION = 'thumb-v1'
const cache = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()
let ctx: { gl: WebGLRenderer; scene: Scene; cam: PerspectiveCamera } | null = null
let idleTimer = 0

function stage() {
  if (ctx) return ctx
  const gl = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  gl.setSize(SIZE, SIZE, false)
  gl.toneMapping = AgXToneMapping
  const scene = new Scene()
  const pmrem = new PMREMGenerator(gl)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.9
  pmrem.dispose()
  const key = new DirectionalLight('#ffffff', 1.2)
  key.position.set(3, 5, 4)
  scene.add(key)
  ctx = { gl, scene, cam: new PerspectiveCamera(30, 1, 0.01, 100) }
  return ctx
}

/** Free the GPU context once the catalog has stopped asking for a while. */
function scheduleRelease() {
  clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => {
    ctx?.gl.dispose()
    ctx?.gl.forceContextLoss()
    ctx = null
  }, 8000)
}

async function build(item: CatalogItem): Promise<Object3D> {
  if (item.kind === 'model') {
    const gltf = await new GLTFLoader().loadAsync(modelUrl(item.model!.file))
    return gltf.scene
  }
  const g = buildFurniture(item.id, item.size)
  const overrides = slotOverrides(item) ?? {}
  g.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const mat = m.material as Material
    const o2 = overrides[mat.name]
    if (o2) m.material = surfaceFor(mat, o2, { metric: true })
  })
  return g
}

function shoot(obj: Object3D) {
  const { gl, scene, cam } = stage()
  scene.add(obj)
  const box = new Box3().setFromObject(obj)
  const sphere = box.getBoundingSphere(new Sphere())
  const dir = new Vector3(Math.sin(MathUtils.degToRad(35)), 0.55, Math.cos(MathUtils.degToRad(35))).normalize()
  const dist = sphere.radius / Math.sin(MathUtils.degToRad(cam.fov / 2)) * 1.05
  cam.position.copy(sphere.center).addScaledVector(dir, dist)
  cam.near = dist / 100
  cam.far = dist * 10
  cam.lookAt(sphere.center)
  cam.updateProjectionMatrix()
  gl.setClearColor(0x000000, 0)
  gl.render(scene, cam)
  const url = gl.domElement.toDataURL('image/webp', 0.85)
  scene.remove(obj)
  obj.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      // Free the textures too (GLB models carry 4K maps), not just the materials.
      ;(Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => {
        for (const v of Object.values(x)) if ((v as { isTexture?: boolean } | null)?.isTexture) (v as { dispose: () => void }).dispose()
        x.dispose()
      })
    }
  })
  return url
}

/** A data URL picture of the catalog piece (rendered on first ask, one at a time). */
export function thumbnail(item: CatalogItem): Promise<string> {
  const key = `${VERSION}:${item.id}`
  let p = cache.get(key)
  if (p) return p
  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      p = Promise.resolve(stored)
      cache.set(key, p)
      return p
    }
  } catch {
    /* storage unavailable */
  }
  p = (queue = queue.then(async () => {
    // Wait for an idle moment so previews never compete with the planner.
    await new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 50)))
    const url = shoot(await build(item))
    scheduleRelease()
    try {
      localStorage.setItem(key, url)
    } catch {
      /* full or unavailable: session cache only */
    }
    return url
  })) as Promise<string>
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  return p
}
