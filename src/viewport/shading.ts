import { BufferAttribute, BufferGeometry, MathUtils, MeshPhysicalMaterial, MeshStandardMaterial, type InterleavedBufferAttribute, type Material, type Texture } from 'three'
import { detailTexture } from './detailTextures'
import { presetById } from './materialPresets'
import { pbrSet } from './pbrTextures'
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

/**
 * Surface material for one material slot: the generated material, or the user's override.
 * Library presets get physical properties at once, a procedural texture as a placeholder,
 * and the real ambientCG maps as soon as they have loaded (`onUpgrade` re-renders).
 */
export function surfaceFor(original: Material, o: MaterialOverride | null, opts: { metric?: boolean; onUpgrade?: () => void } = {}): Material {
  if (!o) return original
  const preset = presetById(o.preset)
  const base = original as MeshStandardMaterial
  const physical = !!(preset?.clearcoat || preset?.transmission || preset?.sheen)
  const m: MeshStandardMaterial | MeshPhysicalMaterial = physical ? new MeshPhysicalMaterial() : base.isMeshStandardMaterial ? (base.clone() as MeshStandardMaterial) : new MeshStandardMaterial()
  if (physical && base.isMeshStandardMaterial && o.keepTexture) m.map = base.map
  m.name = preset?.name ?? base.name
  m.color.set(o.color)
  m.roughness = o.roughness
  m.metalness = o.metalness
  if (!o.keepTexture || preset?.texture) {
    m.map = null
    m.normalMap = null
    m.roughnessMap = null
    m.metalnessMap = null
    m.aoMap = null
    m.vertexColors = false
  }
  if (m instanceof MeshPhysicalMaterial && preset) {
    m.clearcoat = preset.clearcoat ?? 0
    m.clearcoatRoughness = 0.08
    m.transmission = preset.transmission ?? 0
    m.ior = preset.ior ?? 1.5
    m.thickness = preset.transmission ? 0.01 : 0
    m.sheen = preset.sheen ?? 0
    m.sheenRoughness = 0.8
    m.sheenColor.set(o.color)
  }
  // Metric UVs (Claude parts): one repeat per `tile` metres. Other meshes: one repeat per UV unit.
  const repeat = (tile: number) => (opts.metric ? 1 / tile : 1)
  if (preset?.texture) {
    const t = detailTexture(preset.texture).clone()
    t.repeat.setScalar(repeat(1))
    m.map = t
    void pbrSet(preset.id).then((set) => {
      if (!set) return
      const r = repeat(set.tile)
      const tex = (x?: Texture) => {
        if (!x) return null
        const c = x.clone()
        c.repeat.setScalar(r)
        return c
      }
      m.map = tex(set.map)
      m.normalMap = tex(set.normalMap)
      m.roughnessMap = tex(set.roughnessMap)
      m.metalnessMap = tex(set.metalnessMap)
      m.aoMap = tex(set.aoMap)
      // Real colour maps already carry their colour: show them untinted unless the user picked a colour.
      if (o.color.toLowerCase() === preset.color.toLowerCase()) m.color.set('#ffffff')
      m.needsUpdate = true
      opts.onUpgrade?.()
    })
  }
  m.needsUpdate = true
  m.userData.override = true
  return m
}
