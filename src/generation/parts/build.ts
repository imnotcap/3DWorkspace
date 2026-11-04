import {
  AgXToneMapping,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
  BufferAttribute,
  type BufferGeometry,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { applyPose, framePose } from '@/viewport/camera'
import type { PartSpec, PartsSpec } from './spec'

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const pos = (n: unknown) => ok(n) && n > 0

function geometryFor(p: PartSpec): BufferGeometry | string {
  const d = p.dims
  switch (p.shape) {
    case 'box':
      return d.length >= 3 && d.slice(0, 3).every(pos) ? new BoxGeometry(d[0], d[1], d[2]) : 'box needs [w,h,d]'
    case 'rounded_box': {
      if (!(d.length >= 3 && d.slice(0, 3).every(pos))) return 'rounded_box needs [w,h,d,r]'
      const r = Math.min(Math.max(0, d[3] ?? 0), Math.min(d[0], d[1], d[2]) / 2 - 1e-5)
      return new RoundedBoxGeometry(d[0], d[1], d[2], 4, r)
    }
    case 'cylinder':
      return d.length >= 3 && ok(d[0]) && ok(d[1]) && pos(d[2]) && d[0] >= 0 && d[1] >= 0 ? new CylinderGeometry(d[0], d[1], d[2], 48) : 'cylinder needs [rTop,rBottom,h]'
    case 'sphere':
      return pos(d[0]) ? new SphereGeometry(d[0], 48, 32) : 'sphere needs [r]'
    case 'capsule':
      return pos(d[0]) && ok(d[1]) && d[1] >= 0 ? new CapsuleGeometry(d[0], d[1], 8, 32) : 'capsule needs [r,len]'
    case 'torus':
      return pos(d[0]) && pos(d[1]) ? new TorusGeometry(d[0], d[1], 24, 96) : 'torus needs [R,tube]'
    case 'extrude': {
      const pts = p.profile.filter((q) => ok(q[0]) && ok(q[1]))
      if (pts.length < 3 || !pos(d[0])) return 'extrude needs a 3+ point profile and [depth]'
      const shape = new Shape(pts.map(([x, y]) => new Vector2(x, y)))
      const bevel = Math.max(0, d[1] ?? 0)
      const g = new ExtrudeGeometry(shape, { depth: d[0], bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 24 })
      g.translate(0, 0, -d[0] / 2)
      return g
    }
    case 'lathe': {
      const pts = p.profile.filter((q) => ok(q[0]) && ok(q[1]) && q[0] >= 0)
      return pts.length >= 2 ? new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), 64) : 'lathe needs 2+ [r,y] points'
    }
  }
}

/**
 * Box-projected UVs in metres: each vertex takes the two coordinates across its dominant normal
 * axis. Textures then keep one real-world scale on every part (a 1 m wood tile is 1 m everywhere),
 * instead of stretching per face as primitive UVs do.
 */
function metricUVs(g: BufferGeometry) {
  if (!g.attributes.normal) g.computeVertexNormals()
  const p = g.attributes.position
  const n = g.attributes.normal
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i))
    const ay = Math.abs(n.getY(i))
    const az = Math.abs(n.getZ(i))
    const [u, v] = ax >= ay && ax >= az ? [p.getZ(i), p.getY(i)] : ay >= az ? [p.getX(i), p.getZ(i)] : [p.getX(i), p.getY(i)]
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2))
}

/** Spec → three.js group. Invalid parts are skipped and reported, never fatal. */
export function buildGroup(spec: PartsSpec): { group: Group; warnings: string[] } {
  const materials = new Map(
    spec.materials.map((m) => [
      m.id,
      new MeshStandardMaterial({
        name: m.name,
        color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#9a9a9a',
        roughness: MathUtils.clamp(ok(m.roughness) ? m.roughness : 0.5, 0, 1),
        metalness: MathUtils.clamp(ok(m.metalness) ? m.metalness : 0, 0, 1),
      }),
    ]),
  )
  const fallback = new MeshStandardMaterial({ name: 'Unassigned', color: '#9a9a9a', roughness: 0.5 })
  const group = new Group()
  group.name = spec.name
  const warnings: string[] = []
  for (const p of spec.parts) {
    const g = geometryFor(p)
    if (typeof g === 'string') {
      warnings.push(`${p.name}: ${g}`)
      continue
    }
    metricUVs(g)
    const mesh = new Mesh(g, materials.get(p.material) ?? fallback)
    mesh.name = p.name
    const [x = 0, y = 0, z = 0] = p.position
    const [rx = 0, ry = 0, rz = 0] = p.rotation_deg
    mesh.position.set(x, y, z)
    mesh.rotation.set(MathUtils.degToRad(rx), MathUtils.degToRad(ry), MathUtils.degToRad(rz))
    group.add(mesh)
  }
  if (!group.children.length) throw new Error('Claude returned no buildable parts.')
  return { group, warnings }
}

export async function toGlb(group: Group): Promise<Blob> {
  const out = await new GLTFExporter().parseAsync(group, { binary: true })
  return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' })
}

/** Render the spec from its estimated photo angle, for Claude's self-check. */
export async function renderPreview(group: Group, spec: PartsSpec, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  try {
    renderer.setSize(width, height, false)
    renderer.toneMapping = AgXToneMapping
    const scene = new Scene()
    scene.background = null
    renderer.setClearColor(0xffffff, 1) // product-photo white, like most reference shots
    const pmrem = new PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.add(new HemisphereLight('#ffffff', '#888888', 0.6))
    const sun = new DirectionalLight('#ffffff', 1.2)
    sun.position.set(2, 4, 3)
    scene.add(sun)
    scene.add(group)
    const box = new Box3().setFromObject(group)
    const az = MathUtils.degToRad(spec.photo_view?.azimuth_deg ?? 20)
    const el = MathUtils.degToRad(spec.photo_view?.elevation_deg ?? 15)
    const pose = framePose(box, { azimuth: az, polar: Math.PI / 2 - el, focal: 50 }, width / height)
    const cam = new PerspectiveCamera()
    applyPose(cam, pose, width / height)
    renderer.render(scene, cam)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    scene.remove(group)
    pmrem.dispose()
    if (!blob) throw new Error('Preview render failed.')
    return blob
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
