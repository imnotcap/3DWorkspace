import { BufferAttribute, BufferGeometry, MathUtils, MeshPhysicalMaterial, MeshStandardMaterial, type InterleavedBufferAttribute, type Material, type Mesh } from 'three'
import type { MaterialOverride, ShadeMode } from '@/store/workspace'
import type { PackedAttr, ShadeRequest, ShadeResponse } from './shade.worker'

/* ───────── Normals (off main thread) ───────── */

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: ShadeResponse) => void>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./shade.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<ShadeResponse>) => {
      pending.get(e.data.id)?.(e.data)
      pending.delete(e.data.id)
    }
  }
  return worker
}

function pack(attr: BufferAttribute | InterleavedBufferAttribute): PackedAttr {
  // Copy (de-interleaving if needed) so the original geometry stays untouched.
  const Ctor = attr.array.constructor as new (n: number) => PackedAttr['array']
  const out = new Ctor(attr.count * attr.itemSize)
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c)
  return { array: out, itemSize: attr.itemSize, normalized: attr.normalized }
}

const AUTO_SMOOTH_ANGLE = MathUtils.degToRad(30)

/** Build a re-shaded copy of `geometry` in the worker. */
export function reshade(geometry: BufferGeometry, mode: Exclude<ShadeMode, 'original'>): Promise<BufferGeometry> {
  const id = ++seq
  const attributes: Record<string, PackedAttr> = {}
  for (const [name, attr] of Object.entries(geometry.attributes)) attributes[name] = pack(attr)
  const index = geometry.index ? (geometry.index.array.slice() as Uint32Array | Uint16Array) : null
  const transfer = [...Object.values(attributes).map((a) => a.array.buffer), ...(index ? [index.buffer] : [])]
  return new Promise((resolve) => {
    pending.set(id, (r) => {
      const g = new BufferGeometry()
      for (const [name, a] of Object.entries(r.attributes)) g.setAttribute(name, new BufferAttribute(a.array, a.itemSize, a.normalized))
      if (r.index) g.setIndex(new BufferAttribute(r.index, 1))
      g.groups = geometry.groups.slice()
      g.computeBoundingBox()
      g.computeBoundingSphere()
      resolve(g)
    })
    getWorker().postMessage({ id, mode, angle: AUTO_SMOOTH_ANGLE, attributes, index } satisfies ShadeRequest, transfer as Transferable[])
  })
}

/* ───────── Material overrides ───────── */

/** Per-mesh surface material: the generated one, or a tinted/replaced copy. */
export function surfaceFor(original: Material, o: MaterialOverride | null): Material {
  if (!o) return original
  const base = original as MeshStandardMaterial
  const m = base.isMeshStandardMaterial ? (base.clone() as MeshStandardMaterial) : new MeshPhysicalMaterial()
  m.color.set(o.color)
  m.roughness = o.roughness
  m.metalness = o.metalness
  if (!o.keepTexture) {
    m.map = null
    m.roughnessMap = null
    m.metalnessMap = null
    m.vertexColors = false
  }
  m.needsUpdate = true
  m.userData.override = true
  return m
}

export function disposeSurface(mesh: Mesh) {
  const s = mesh.userData.surface as Material | undefined
  if (s?.userData.override) s.dispose()
}
