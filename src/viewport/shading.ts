import { BufferAttribute, BufferGeometry, CanvasTexture, Color, MathUtils, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Vector2, type InterleavedBufferAttribute, type Material, type Texture } from 'three'
import { detailTexture } from './detailTextures'
import { floorCanvases, loadWood, woodReady } from './floorTextures'
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
  // Copy (de-interleaving if needed) so the original geometry stays untouched. Raw values, not
  // getComponent(): that de-normalises (a vertex colour of 120/255 → 0.47), which a Uint8Array
  // would then truncate to 0, turning every vertex colour black.
  const Ctor = attr.array.constructor as new (n: number) => PackedAttr['array']
  const n = attr.itemSize
  const out = new Ctor(attr.count * n)
  if ((attr as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const ia = attr as InterleavedBufferAttribute
    const src = ia.data.array
    for (let i = 0; i < ia.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = src[i * ia.data.stride + ia.offset + c]
  } else {
    out.set((attr as BufferAttribute).array.subarray(0, attr.count * n))
  }
  return { array: out, itemSize: n, normalized: attr.normalized }
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

const averages = new WeakMap<object, Color>()

/** Mean colour of a texture's image (linear), from a 16 × 16 copy. */
function averageColour(tex: Texture | null | undefined): Color | null {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!img || !img.width || typeof document === 'undefined') return null
  const hit = averages.get(img)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, 16, 16)
  const d = ctx.getImageData(0, 0, 16, 16).data
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  let r = 0
  let g = 0
  let b = 0
  for (let i = 0; i < d.length; i += 4) {
    r += lin(d[i])
    g += lin(d[i + 1])
    b += lin(d[i + 2])
  }
  const n = d.length / 4
  const out = new Color().setRGB(r / n, g / n, b / n)
  averages.set(img, out)
  return out
}

/**
 * Recolour a textured material without losing its texture: the colour map is multiplied by
 * (target ÷ the map's mean colour), so on average the surface shows the chosen colour while the
 * grain, joints and veining keep their light and dark. The preset's own colour shows the map as is.
 */
export function tintTexture(m: MeshStandardMaterial, target: string, presetColor: string) {
  if (target.toLowerCase() === presetColor.toLowerCase()) {
    m.color.set('#ffffff')
    return
  }
  const avg = averageColour(m.map)
  const t = new Color(target)
  if (!avg) {
    m.color.copy(t)
    return
  }
  const k = (a: number, b: number) => Math.min(8, a / Math.max(b, 1e-3))
  m.color.setRGB(k(t.r, avg.r), k(t.g, avg.g), k(t.b, avg.b))
}

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
  if (preset?.floor) {
    // Wood floors: every board cut from a photographed wood (fetched at build time), with its
    // joints and grain as relief. Until the photos have loaded, drawn grain stands in.
    const spec = preset.floor
    const apply = () => {
      const t = floorTextures(preset.id, spec)
      const at = (x: Texture) => {
        const c = x.clone()
        c.repeat.set(opts.metric ? 1 / t.tileX : 1, opts.metric ? 1 / t.tileY : 1)
        return c
      }
      m.map = at(t.map)
      m.normalMap = at(t.normal)
      tintTexture(m, o.color, preset.color)
      m.needsUpdate = true
    }
    apply()
    let real = false
    // Best: a photographed floor of this kind (2K colour, normal, roughness), fetched at build time.
    void pbrSet(preset.id).then((set) => {
      if (!set?.map) return
      real = true
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
      m.aoMap = tex(set.aoMap)
      tintTexture(m, o.color, preset.color)
      m.needsUpdate = true
      opts.onUpgrade?.()
    })
    if (!woodReady())
      void loadWood().then(() => {
        if (!woodReady() || real) return
        apply()
        opts.onUpgrade?.()
      })
    m.normalScale = new Vector2(0.9, 0.9)
    m.needsUpdate = true
    m.userData.override = true
    return m
  }
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
      // Real colour maps already carry their colour: shown as they are, or recoloured keeping their texture.
      tintTexture(m, o.color, preset.color)
      m.needsUpdate = true
      opts.onUpgrade?.()
    })
  }
  m.needsUpdate = true
  m.userData.override = true
  return m
}

/* ───────── Wood floor textures ───────── */

const floorTex = new Map<string, { map: Texture; normal: Texture; tileX: number; tileY: number }>()

/** Colour map and a normal map (joints, grain) for a wood floor, from its drawn canvases. */
function floorTextures(id: string, spec: NonNullable<ReturnType<typeof presetById>>['floor'] & object) {
  const key = `${id}:${woodReady() ? 'photo' : 'drawn'}`
  let hit = floorTex.get(key)
  if (hit) return hit
  const c = floorCanvases(id, spec)
  const map = new CanvasTexture(c.color)
  map.colorSpace = SRGBColorSpace
  map.wrapS = map.wrapT = RepeatWrapping
  map.anisotropy = 8
  // Height → tangent-space normals (Sobel).
  const w = c.height.width
  const h = c.height.height
  const src = c.height.getContext('2d')!.getImageData(0, 0, w, h).data
  // With photographed wood, its own light and dark grain adds a little relief.
  const col = woodReady() ? c.color.getContext('2d')!.getImageData(0, 0, w, h).data : null
  const relief = spec.brushed ? 0.35 : 0.14
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const H = (x: number, y: number) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4
    const j = src[i] / 255
    return col ? j * (1 - relief + relief * ((col[i] + col[i + 1] + col[i + 2]) / 765)) : j
  }
  const k = 2.2
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * k
      const dy = (H(x, y + 1) - H(x, y - 1)) * k
      const l = Math.hypot(dx, dy, 1)
      const i = (y * w + x) * 4
      img.data[i] = (-dx / l) * 127.5 + 127.5
      img.data[i + 1] = (dy / l) * 127.5 + 127.5
      img.data[i + 2] = (1 / l) * 127.5 + 127.5
      img.data[i + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  const normal = new CanvasTexture(out)
  normal.wrapS = normal.wrapT = RepeatWrapping
  normal.anisotropy = 8
  hit = { map, normal, tileX: c.tileX, tileY: c.tileY }
  floorTex.set(key, hit)
  return hit
}
