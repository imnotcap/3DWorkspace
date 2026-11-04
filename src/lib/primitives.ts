// Primitive shapes you can add yourself (three-free, for menus and panels).
import type { Primitive, PrimitiveShape } from '@/store/workspace'

const MATERIAL = { name: 'Material', color: '#bcbcbc', roughness: 0.5, metalness: 0 }

export const PRIMITIVES: { shape: PrimitiveShape; label: string; dims: number[]; profile?: number[][] }[] = [
  { shape: 'box', label: 'Box', dims: [0.5, 0.5, 0.5] },
  { shape: 'rounded_box', label: 'Rounded box', dims: [0.5, 0.5, 0.5, 0.04] },
  { shape: 'cylinder', label: 'Cylinder', dims: [0.25, 0.25, 0.5] },
  { shape: 'cylinder', label: 'Cone', dims: [0, 0.25, 0.5] },
  { shape: 'sphere', label: 'Sphere', dims: [0.25] },
  { shape: 'capsule', label: 'Capsule', dims: [0.15, 0.3] },
  { shape: 'torus', label: 'Torus', dims: [0.3, 0.08] },
]

export function newPrimitive(label: string): Primitive {
  const p = PRIMITIVES.find((x) => x.label === label) ?? PRIMITIVES[0]
  return { shape: p.shape, dims: [...p.dims], profile: p.profile ?? [], material: { ...MATERIAL } }
}

/** Half the primitive's height, so a new one rests on the grid instead of sinking into it. */
export function restingHeight(p: Primitive) {
  const d = p.dims
  switch (p.shape) {
    case 'box':
    case 'rounded_box':
      return d[1] / 2
    case 'cylinder':
      return d[2] / 2
    case 'sphere':
      return d[0]
    case 'capsule':
      return d[0] + d[1] / 2
    case 'torus':
      return d[0] + d[1] // ring stands upright, facing the camera
    default:
      return 0
  }
}

/** Editable parameters per shape, in the order of `dims`. Shown in cm. */
export const SHAPE_FIELDS: Record<PrimitiveShape, string[]> = {
  box: ['Width', 'Height', 'Depth'],
  rounded_box: ['Width', 'Height', 'Depth', 'Corner radius'],
  cylinder: ['Top radius', 'Bottom radius', 'Height'],
  sphere: ['Radius'],
  capsule: ['Radius', 'Straight length'],
  torus: ['Ring radius', 'Tube radius'],
  extrude: ['Depth', 'Bevel'],
  lathe: [],
}
