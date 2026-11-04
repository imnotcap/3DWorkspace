// Three.js-free animation helpers, shared by the viewport, renderer and UI.
import type { Animation, ObjectKey, SceneObject, Transform, Vec3 } from '@/store/workspace'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
export const smoothstep = (t: number) => t * t * (3 - 2 * t)

/**
 * Object transform at a frame. Rotation interpolates per Euler axis (like Blender),
 * so 0° → 360° is a full spin rather than no motion.
 */
export function transformAt(keys: ObjectKey[], frame: number, interpolation: Animation['interpolation']): Transform {
  if (frame <= keys[0].frame) return keys[0].transform
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return last.transform
  const i = keys.findIndex((k) => k.frame > frame)
  const a = keys[i - 1]
  const b = keys[i]
  const raw = (frame - a.frame) / (b.frame - a.frame)
  const t = interpolation === 'linear' ? raw : smoothstep(raw)
  return {
    position: lerp3(a.transform.position, b.transform.position, t),
    rotation: lerp3(a.transform.rotation, b.transform.rotation, t),
    scale: lerp3(a.transform.scale, b.transform.scale, t),
  }
}

/** What the object looks like at `frame`: animated if keyed, else its static transform. */
export function objectTransformAt(obj: Pick<SceneObject, 'keys' | 'transform'>, frame: number, interpolation: Animation['interpolation']): Transform {
  return obj.keys?.length ? transformAt(obj.keys, frame, interpolation) : obj.transform
}
