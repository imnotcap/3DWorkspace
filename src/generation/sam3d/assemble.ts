import { Box3, Euler, Matrix4, Quaternion, Vector3, type BufferAttribute, type Mesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { scaleForSize, type LevelMode, type RealSize, type Segment, type Transform, type TreeNode, type Vec3 } from '@/store/workspace'

/**
 * SAM 3D parts → one model you can take apart.
 *
 * Every part arrives with a matrix that puts its GLB into the photo's camera frame (OpenGL:
 * metres, camera at the origin looking down -Z). Because all parts share that camera and
 * its metric depth, the matrices already fit the parts together; this only has to:
 *   1. stand the model upright (level it),
 *   2. rest it on the floor, centred on the origin, using the exact vertices,
 *   3. express every part relative to its parent (model → folder → part),
 *   4. work out where the photo's camera was, for the default render angle.
 */

export interface PartResult {
  segment: Segment
  glb: Blob
  /** Row-major 4x4 from the server: GLB vertex → camera frame. */
  matrix: number[][]
}

export interface Assembly {
  nodes: TreeNode[]
  /** Spherical angles of the photo's camera around the model, for the default render camera. */
  cameraAngles: { azimuth: number; polar: number } | null
  size: Vec3
  warnings: string[]
}

interface Loaded {
  part: PartResult
  matrix: Matrix4
  /** Vertex positions in GLB space (node transforms applied), xyz… */
  points: Float32Array
  local: Box3
  vertices: number
  triangles: number
}

const loader = new GLTFLoader()

async function load(part: PartResult): Promise<Loaded> {
  const gltf = await loader.parseAsync(await part.glb.arrayBuffer(), '')
  gltf.scene.updateMatrixWorld(true)
  const chunks: Float32Array[] = []
  let vertices = 0
  let triangles = 0
  const v = new Vector3()
  gltf.scene.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    const pos = m.geometry.attributes.position as BufferAttribute
    const out = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
      out[i * 3] = v.x
      out[i * 3 + 1] = v.y
      out[i * 3 + 2] = v.z
    }
    chunks.push(out)
    vertices += pos.count
    triangles += (m.geometry.index ? m.geometry.index.count : pos.count) / 3
  })
  const points = new Float32Array(vertices * 3)
  let off = 0
  for (const c of chunks) {
    points.set(c, off)
    off += c.length
  }
  const local = new Box3()
  for (let i = 0; i < points.length; i += 3) local.expandByPoint(v.set(points[i], points[i + 1], points[i + 2]))
  const r = part.matrix
  if (r.length !== 4 || r.some((row) => row.length !== 4 || row.some((x) => !Number.isFinite(x)))) throw new Error(`Bad pose for ${part.segment.name}`)
  const matrix = new Matrix4().set(...(r.flat() as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
  return { part, matrix, points, local, vertices, triangles: Math.round(triangles) }
}

/** Exact bounds of the part's vertices under `m`. */
function boundsUnder(l: Loaded, m: Matrix4, box = new Box3()) {
  const e = m.elements
  const p = l.points
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]
    const y = p[i + 1]
    const z = p[i + 2]
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12]
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13]
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14]
    if (wx < box.min.x) box.min.x = wx
    if (wy < box.min.y) box.min.y = wy
    if (wz < box.min.z) box.min.z = wz
    if (wx > box.max.x) box.max.x = wx
    if (wy > box.max.y) box.max.y = wy
    if (wz > box.max.z) box.max.z = wz
  }
  return box
}

function toTransform(m: Matrix4): Transform {
  const p = new Vector3()
  const q = new Quaternion()
  const s = new Vector3()
  m.decompose(p, q, s)
  const e = new Euler().setFromQuaternion(q, 'XYZ')
  return { position: p.toArray() as Vec3, rotation: [e.x, e.y, e.z], scale: s.toArray() as Vec3 }
}

const UP = new Vector3(0, 1, 0)

export async function assemble(parts: PartResult[], opts: { name: string; level: LevelMode; realSize: RealSize | null; source: string }): Promise<Assembly> {
  const warnings: string[] = []
  const loaded: Loaded[] = []
  for (const p of parts) {
    try {
      const l = await load(p)
      if (!l.vertices) throw new Error('empty mesh')
      loaded.push(l)
    } catch (e) {
      warnings.push(`${p.segment.name}: ${(e as Error).message}`)
    }
  }
  if (!loaded.length) throw new Error('None of the parts could be read.')

  // 1. Level: the biggest part's own up axis becomes world up. SAM 3D builds each object in an
  //    upright canonical frame, so this undoes the camera's tilt exactly; "camera" keeps the photo's horizon.
  const volume = (l: Loaded) => {
    const s = l.local.getSize(new Vector3())
    return s.x * s.y * s.z * Math.abs(l.matrix.determinant())
  }
  const main = loaded.reduce((a, b) => (volume(b) > volume(a) ? b : a))
  const level = new Matrix4()
  if (opts.level === 'part') {
    const up = UP.clone().transformDirection(main.matrix) // normalised
    level.makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(up, UP))
  }

  // 2. Exact bounds after levelling → rest on the floor, centred.
  const world = loaded.map((l) => new Matrix4().multiplyMatrices(level, l.matrix))
  const box = new Box3()
  loaded.forEach((l, i) => boundsUnder(l, world[i], box))
  const centre = box.getCenter(new Vector3())
  const shift = new Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z)
  world.forEach((m) => m.premultiply(shift))
  const size = box.getSize(new Vector3()).toArray() as Vec3

  // 3. Hierarchy: model → folders for repeated parts (Leg 1…4) → parts. Folders pivot at their parts' centre.
  const nodes: TreeNode[] = []
  const rootScale = opts.realSize ? scaleForSize(size, opts.realSize, [1, 1, 1]) : ([1, 1, 1] as Vec3)
  nodes.push({
    name: opts.name,
    isGroup: true,
    source: opts.source,
    visible: true,
    renderable: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: rootScale },
    shade: 'original',
    material: null,
    exact: true,
    stats: { vertices: 0, triangles: 0, meshes: 0, size },
  })
  const folders = new Map<string, number[]>()
  loaded.forEach((l, i) => {
    const g = l.part.segment.group
    if (g) folders.set(g, [...(folders.get(g) ?? []), i])
  })
  const parentOf = new Map<number, { index: number; inverse: Matrix4 }>()
  for (const [name, members] of folders) {
    if (members.length < 2) continue
    const fb = new Box3()
    members.forEach((i) => boundsUnder(loaded[i], world[i], fb))
    const pivot = fb.getCenter(new Vector3())
    const index = nodes.length
    nodes.push({
      name,
      parent: 0,
      isGroup: true,
      source: opts.source,
      visible: true,
      renderable: true,
      transform: { position: pivot.toArray() as Vec3, rotation: [0, 0, 0], scale: [1, 1, 1] },
      shade: 'original',
      material: null,
      exact: true,
      stats: { vertices: 0, triangles: 0, meshes: 0, size: fb.getSize(new Vector3()).toArray() as Vec3 },
    })
    const inverse = new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)
    members.forEach((i) => parentOf.set(i, { index, inverse }))
  }
  loaded.forEach((l, i) => {
    const parent = parentOf.get(i)
    const m = parent ? new Matrix4().multiplyMatrices(parent.inverse, world[i]) : world[i]
    nodes.push({
      name: l.part.segment.name,
      parent: parent?.index ?? 0,
      blob: l.part.glb,
      source: opts.source,
      visible: true,
      renderable: true,
      transform: toTransform(m),
      shade: 'auto',
      material: null,
      exact: true,
      keepOrigin: true,
    })
  })

  // 4. The photo's camera sat at the camera-frame origin; where is that around the model?
  const cam = new Vector3(0, 0, 0).applyMatrix4(level).applyMatrix4(shift)
  const dir = cam.sub(new Vector3(0, size[1] / 2, 0))
  const r = dir.length()
  const cameraAngles = r > 1e-6 ? { azimuth: Math.atan2(dir.x, dir.z), polar: Math.acos(Math.min(1, Math.max(-1, dir.y / r))) } : null

  return { nodes, cameraAngles, size, warnings }
}
