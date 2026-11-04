/// <reference lib="webworker" />
import { BufferAttribute, BufferGeometry, type TypedArray } from 'three'
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface PackedAttr {
  array: TypedArray
  itemSize: number
  normalized: boolean
}
export interface ShadeRequest {
  id: number
  mode: 'smooth' | 'auto'
  angle: number
  attributes: Record<string, PackedAttr>
  index: Uint32Array | Uint16Array | null
}
export interface ShadeResponse {
  id: number
  attributes: Record<string, PackedAttr>
  index: Uint32Array | Uint16Array | null
}

self.onmessage = (e: MessageEvent<ShadeRequest>) => {
  const { id, mode, angle, attributes, index } = e.data
  const g = new BufferGeometry()
  for (const [name, a] of Object.entries(attributes)) g.setAttribute(name, new BufferAttribute(a.array, a.itemSize, a.normalized))
  if (index) g.setIndex(new BufferAttribute(index, 1))

  let out: BufferGeometry
  if (mode === 'auto') {
    // Smooth across faces below the crease angle, keep hard edges above it (Blender's Auto Smooth).
    out = toCreasedNormals(g, angle)
  } else {
    g.deleteAttribute('normal')
    out = mergeVertices(g, 1e-5)
    out.computeVertexNormals()
  }

  const outAttrs: Record<string, PackedAttr> = {}
  const transfer: Transferable[] = []
  for (const [name, a] of Object.entries(out.attributes)) {
    const attr = a as BufferAttribute
    outAttrs[name] = { array: attr.array, itemSize: attr.itemSize, normalized: attr.normalized }
    transfer.push(attr.array.buffer)
  }
  const outIndex = (out.index?.array as Uint32Array | Uint16Array | undefined) ?? null
  if (outIndex) transfer.push(outIndex.buffer)
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, attributes: outAttrs, index: outIndex } satisfies ShadeResponse, transfer)
}
