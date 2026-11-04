import { AgXToneMapping, Box3, DirectionalLight, MathUtils, Mesh as ThreeMesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, Sphere, SphereGeometry, Vector3, WebGLRenderer, type Material, type Mesh, type Object3D } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildFurniture } from '@/furniture/build'
import type { CatalogItem } from '@/furniture/catalog'
import { slotOverrides } from '@/plan/place'
import { modelUrl } from '@/store/workspace'
import { surfaceFor } from './shading'
import { pbrSet } from './pbrTextures'
import { floorPreview, loadWood, woodReady } from './floorTextures'
import { presetById } from './materialPresets'

/**
 * Catalog previews: each piece rendered once, three-quarter view, in its default finishes, on a
 * small offscreen renderer. Cached for the session (and in localStorage between visits).
 */
const SIZE = 256
const VERSION = 'thumb-v3'
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

/**
 * Material previews for the galleries: wood floors as a piece of the floor itself; other materials
 * as a ball (models) or a lit tile (walls), rendered with the real material. Cached like the catalog.
 */
export function materialThumb(presetId: string, shape: 'ball' | 'tile' = 'ball'): Promise<string> {
  const preset = presetById(presetId)
  if (!preset) return Promise.reject(new Error('unknown material'))
  const key = `${VERSION}:mat:${presetId}:${preset.floor ? 'floor' : shape}`
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
    await new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 30)))
    let url: string
    let keep = true
    if (preset.floor) {
      // The photographed floor if there is one (about 1.2 m of it), else boards cut from wood photos.
      const set = await pbrSet(preset.id).catch(() => null)
      const img = set?.map?.image as HTMLImageElement | undefined
      if (img) {
        const c = document.createElement('canvas')
        c.width = c.height = 256
        const g = c.getContext('2d')!
        const part = Math.min(1, 1.2 / set!.tile)
        g.drawImage(img, 0, 0, img.width * part, img.height * part, 0, 0, 256, 256)
        url = c.toDataURL('image/jpeg', 0.88)
      } else {
        await loadWood()
        url = floorPreview(preset.id, preset.floor, 256)
        // Drawn-grain previews aren't kept: next time the photos may be there.
        keep = woodReady()
      }
    }
    else {
      const base = new MeshStandardMaterial()
      const mat = surfaceFor(base, { color: preset.color, roughness: preset.roughness, metalness: preset.metalness, keepTexture: false, preset: preset.id }, { metric: true })
      // Metric UVs on the preview shapes, so textures show at a believable scale.
      const geo = shape === 'ball' ? new SphereGeometry(0.25, 64, 48) : new PlaneGeometry(0.8, 0.8)
      const uv = geo.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (shape === 'ball' ? 1.6 : 0.8), uv.getY(i) * (shape === 'ball' ? 0.8 : 0.8))
      const mesh = new ThreeMesh(geo, mat)
      if (shape === 'tile') mesh.rotation.x = -0.35
      url = shoot(mesh)
    }
    scheduleRelease()
    try {
      if (keep) localStorage.setItem(key, url)
    } catch {
      /* full or unavailable */
    }
    return url
  })) as Promise<string>
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  return p
}
