import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  BufferAttribute,
  type BufferGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { PartSpec } from './spec'

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const pos = (n: unknown) => ok(n) && n > 0

export function geometryFor(p: Pick<PartSpec, 'shape' | 'dims' | 'profile'>): BufferGeometry | string {
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
export function metricUVs(g: BufferGeometry) {
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

/** A user-made primitive object: one mesh, origin at the shape's centre (like Blender). */
export function primitiveGroup(p: { shape: PartSpec['shape']; dims: number[]; profile: number[][]; material: { name: string; color: string; roughness: number; metalness: number } }): Group {
  const g = geometryFor(p)
  const geometry = typeof g === 'string' ? new BoxGeometry(0.1, 0.1, 0.1) : g
  metricUVs(geometry)
  const mat = new MeshStandardMaterial({ name: p.material.name, color: p.material.color, roughness: p.material.roughness, metalness: p.material.metalness })
  const group = new Group()
  const mesh = new Mesh(geometry, mat)
  mesh.name = p.shape
  group.add(mesh)
  return group
}
