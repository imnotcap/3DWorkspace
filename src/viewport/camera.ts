import { Box3, MathUtils, PerspectiveCamera, Sphere, Spherical, Vector3, type Mesh, type Object3D } from 'three'
import type { Animation, CameraPose, Vec3 } from '@/store/workspace'
import { viewport } from './bridge'
export { frameRect } from '@/lib/frame'

/** Full-frame sensor, like Blender's default camera. */
const SENSOR_HEIGHT = 24

export const focalToFov = (mm: number) => MathUtils.radToDeg(2 * Math.atan(SENSOR_HEIGHT / 2 / mm))

const sph = new Spherical()
const v = new Vector3()

export function poseFromCamera(camera: PerspectiveCamera, target: Vector3, focal: number, prevAzimuth?: number): CameraPose {
  sph.setFromVector3(v.copy(camera.position).sub(target))
  let azimuth = sph.theta
  // Unwrap so consecutive keys take the short way round (and turntables can exceed 2π).
  if (prevAzimuth !== undefined) azimuth += Math.round((prevAzimuth - azimuth) / (Math.PI * 2)) * Math.PI * 2
  return { target: target.toArray() as Vec3, azimuth, polar: sph.phi, radius: sph.radius, focal }
}

export function applyPose(camera: PerspectiveCamera, pose: CameraPose, aspect: number, fovOverride?: number) {
  sph.set(pose.radius, pose.polar, pose.azimuth)
  camera.position.setFromSpherical(sph).add(v.fromArray(pose.target))
  camera.up.set(0, 1, 0)
  camera.lookAt(v.fromArray(pose.target))
  camera.fov = fovOverride ?? focalToFov(pose.focal)
  camera.aspect = aspect
  camera.near = Math.max(0.01, pose.radius / 200)
  camera.far = pose.radius * 200
  camera.updateProjectionMatrix()
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => t * t * (3 - 2 * t)

export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  return {
    target: [lerp(a.target[0], b.target[0], t), lerp(a.target[1], b.target[1], t), lerp(a.target[2], b.target[2], t)],
    azimuth: lerp(a.azimuth, b.azimuth, t),
    polar: lerp(a.polar, b.polar, t),
    // Interpolate distance geometrically so dolly moves feel even.
    radius: Math.exp(lerp(Math.log(a.radius), Math.log(b.radius), t)),
    focal: lerp(a.focal, b.focal, t),
  }
}

/** Camera pose at a (fractional) frame. No keys → the static camera. */
export function evaluate(anim: Animation, frame: number, fallback: CameraPose): CameraPose {
  const keys = anim.keys
  if (!keys.length) return fallback
  if (frame <= keys[0].frame) return keys[0].pose
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return last.pose
  const i = keys.findIndex((k) => k.frame > frame)
  const a = keys[i - 1]
  const b = keys[i]
  const t = (frame - a.frame) / (b.frame - a.frame)
  if (anim.interpolation === 'constant') return a.pose
  return lerpPose(a.pose, b.pose, anim.interpolation === 'linear' ? t : smooth(t))
}

const corners = Array.from({ length: 8 }, () => new Vector3())
const probe = new PerspectiveCamera()

/** Smallest distance at which every bbox corner sits inside the frame (with margin), by bisection. */
export function fitRadius(box: Box3, target: Vector3, azimuth: number, polar: number, focal: number, aspect: number, margin = 0.9) {
  const { min, max } = box
  corners.forEach((c, i) => c.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z))
  const fits = (r: number) => {
    applyPose(probe, { target: target.toArray() as Vec3, azimuth, polar, radius: r, focal }, aspect)
    probe.updateMatrixWorld()
    return corners.every((c) => {
      const p = v.copy(c).project(probe)
      return p.z < 1 && Math.abs(p.x) <= margin && Math.abs(p.y) <= margin
    })
  }
  let lo = 0.01
  let hi = box.getBoundingSphere(new Sphere()).radius * 20 + 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) hi = mid
    else lo = mid
  }
  return hi
}

export function framePose(box: Box3, angles: { azimuth: number; polar: number; focal: number }, aspect: number): CameraPose {
  const center = box.getCenter(new Vector3())
  const radius = fitRadius(box, center, angles.azimuth, angles.polar, angles.focal, aspect)
  return { target: center.toArray() as Vec3, ...angles, radius }
}

/** Radius that keeps the object in frame for a full 360° orbit. */
export function orbitRadius(box: Box3, pose: CameraPose, aspect: number) {
  const center = new Vector3().fromArray(pose.target)
  let r = 0
  for (let i = 0; i < 24; i++) r = Math.max(r, fitRadius(box, center, pose.azimuth + (i / 24) * Math.PI * 2, pose.polar, pose.focal, aspect))
  return r
}

/** Bounds of what you can see: hidden objects and parts, and selection boxes, don't count. */
export function visibleBox(o: Object3D, box = new Box3()) {
  if (!o.visible || o.name === '__selection') return box
  if ((o as Mesh).isMesh) box.expandByObject(o, false)
  else o.children.forEach((c) => visibleBox(c, box))
  return box
}

/** Visible including its parents (objects on a hidden floor aren't). */
export function shown(o: Object3D) {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false
  return true
}

/** Union over top-level objects (parts are inside their model, so they count once) and the house. */
export function sceneBox(objects: Object3D[]) {
  const box = new Box3()
  objects.forEach((o) => !o.userData.parentId && shown(o) && visibleBox(o, box))
  viewport.houses.forEach((h) => shown(h) && visibleBox(h, box))
  if (box.isEmpty()) box.set(new Vector3(-1, 0, -1), new Vector3(1, 2, 1))
  return box
}
