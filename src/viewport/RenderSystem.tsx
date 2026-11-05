import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Color, MathUtils, PerspectiveCamera, Vector2, type Object3D } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { activeProject, useWorkspace, type CameraPose } from '@/store/workspace'
import { objectTransformAt } from '@/lib/anim'
import { viewport } from './bridge'
import { applyPose, evaluate, focalToFov, framePose, frameRect, orbitRadius, poseFromCamera, sceneBox } from './camera'
import { tourFrames, tourPath, tourPose } from '@/plan/tour'
import { getEngine } from './Renderer'
import { daylight } from './sky'
import { applyDoors, doorsAtFrame, doorsKey } from './doors'
import { INTERIOR_ENV } from './interior'
import { CUBE_FACES, equirect, tagPanorama, viewRotation, type CubeView } from './panorama'

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0))

function renderAspect() {
  const { renderWidth, renderHeight } = useWorkspace.getState().settings
  return renderWidth / renderHeight
}

/** Put every keyed object where it is at `frame` (offline renders don't go through React). */
function applyObjectsAt(frame: number) {
  const p = activeProject(useWorkspace.getState())
  for (const o of p.objects) {
    const g = viewport.objects.get(o.id)
    if (!g || !o.keys?.length) continue
    const t = objectTransformAt(o, frame)
    g.position.fromArray(t.position)
    g.rotation.set(...t.rotation)
    g.scale.fromArray(t.scale)
  }
}

/**
 * Automatic framing must not change while objects animate (the camera would pump in and out),
 * so it frames the union of the objects' bounds across the whole animation range. Cached until
 * the project or output aspect changes.
 */
let autoCache: { project: unknown; aspect: number; pose: CameraPose } | null = null
function autoPose(): CameraPose {
  const s = useWorkspace.getState()
  const p = activeProject(s)
  const aspect = renderAspect()
  if (autoCache && autoCache.project === p && autoCache.aspect === aspect) return autoCache.pose
  const objects = [...viewport.objects.values()]
  const box = sceneBox(objects)
  if (p.objects.some((o) => o.keys?.length)) {
    const { start, end } = p.animation
    const samples = Math.min(24, end - start + 1)
    for (let i = 0; i < samples; i++) {
      applyObjectsAt(start + ((end - start) * i) / Math.max(1, samples - 1))
      box.union(sceneBox(objects))
    }
    applyObjectsAt(s.frame)
  }
  const angles = { azimuth: MathUtils.degToRad(18), polar: MathUtils.degToRad(76) }
  const pose = framePose(box, { ...angles, focal: 50 }, aspect)
  autoCache = { project: p, aspect, pose }
  return pose
}

/** The walkthrough drives the camera when it is on and has a path. */
export const tourActive = (p: { useTour: boolean; tour: { points: unknown[] } }) => p.tour.points.length > 1

let pathCache: { key: unknown; levels: unknown; path: ReturnType<typeof tourPath> } | null = null
/** Render camera at `frame`: tour → keyframes → static camera → automatic product framing. */
function poseAt(frame: number): CameraPose {
  const p = activeProject(useWorkspace.getState())
  if (tourActive(p)) {
    if (pathCache?.key !== p.tour || pathCache.levels !== p.levels) pathCache = { key: p.tour, levels: p.levels, path: tourPath(p) }
    return tourPose(p, frame - p.animation.start, p.animation.fps, pathCache.path)
  }
  return evaluate(p.animation, frame, p.camera ?? autoPose())
}

export interface ShotOptions {
  width: number
  height: number
  transparent?: boolean
  /** Show ceilings (interiors) or not (dollhouse views). */
  ceilings: boolean
  /** Highest level index shown (null = all). */
  maxLevel: number | null
  background?: string
  /** Path-tracing samples (ignored by the real-time engine). */
  samples?: number
}

/** Offline draw: put the scene at `frame`, then render it through the final pipeline. */
type Draw = (pose: CameraPose, frame: number, o?: { samples?: number; rebuild?: boolean; onSample?: (n: number) => void; signal?: AbortSignal; doors?: boolean; aim?: (cam: PerspectiveCamera) => void }) => Promise<void>

/**
 * Offline renderer: resizes the drawing buffer to the output resolution, draws each
 * frame through the render camera and captures it synchronously. Output quality is
 * independent of viewport size or GPU speed.
 */
export function RenderBridge() {
  const { gl, scene, invalidate } = useThree()

  useEffect(() => {
    async function session<T>(opts: ShotOptions, fn: (draw: Draw, w: number, h: number) => Promise<T>) {
      const s = useWorkspace.getState()
      const w = opts.width
      const h = opts.height
      const ctx = gl.getContext()
      const max = ctx.getParameter(ctx.MAX_VIEWPORT_DIMS) as Int32Array
      const maxRb = ctx.getParameter(ctx.MAX_RENDERBUFFER_SIZE) as number
      if (w > Math.min(max[0], maxRb) || h > Math.min(max[1], maxRb)) throw new Error(`This GPU supports up to ${Math.min(max[0], maxRb)} px per side.`)

      // F12 always uses the final look, whatever the viewport shading is.
      const prevShading = s.shading
      if (prevShading !== 'rendered') {
        s.setShading('rendered')
        for (let i = 0; i < 3; i++) (invalidate(), await nextFrame())
      }

      const engine = getEngine()
      if (engine) engine.offline = true
      const hidden: Object3D[] = []
      const toggled: [Object3D, boolean][] = []
      scene.traverse((o) => {
        if (o.visible && (o.name.startsWith('__') || o.userData.renderable === false)) {
          o.visible = false
          hidden.push(o)
          return
        }
        // Ceilings and floors for this shot, whatever the viewport shows.
        const want = o.userData.ceiling ? opts.ceilings : typeof o.userData.levelIndex === 'number' ? opts.maxLevel === null || o.userData.levelIndex <= opts.maxLevel : null
        if (want !== null && o.visible !== want) {
          toggled.push([o, o.visible])
          o.visible = want
        }
      })
      const prevRatio = gl.getPixelRatio()
      const prevSize = gl.getSize(new Vector2())
      const prevBg = scene.background
      const prevClear = gl.getClearColor(new Color())
      const prevAlpha = gl.getClearAlpha()
      if (opts.transparent) {
        scene.background = null
        gl.setClearColor(0x000000, 0)
      } else if (opts.background) scene.background = new Color(opts.background)
      else if (opts.ceilings) scene.background = daylight(s.settings.ambience).background.clone() // the sky through the windows of interior shots
      gl.setPixelRatio(1)
      gl.setSize(w, h, false)
      const cam = new PerspectiveCamera()
      const pathtrace = s.settings.engine === 'pathtrace'
      // Interior shots in real time: daylight through the windows, the sky's ambient light turned down.
      // (The path tracer traces the real light and gets neither.)
      const prevEnv = scene.environmentIntensity
      const closed = opts.ceilings && !pathtrace
      scene.environmentIntensity = ((scene.userData.envBase as number | undefined) ?? prevEnv) * (closed ? INTERIOR_ENV : 1)
      const portals: [Object3D, boolean][] = []
      scene.traverse((o) => {
        if (o.userData.portal) {
          portals.push([o, o.visible])
          o.visible = closed
        }
      })
      let first = true
      const draw: Draw = async (pose, frame, o = {}) => {
        applyObjectsAt(frame)
        // Walkthrough frames: doors shut, opening as the camera comes up to them.
        const proj = activeProject(useWorkspace.getState())
        if (o.doors && tourActive(proj)) {
          const m = doorsAtFrame(proj, frame)
          applyDoors(scene, (id) => m.get(id) ?? 0)
        }
        applyPose(cam, pose, w / h)
        o.aim?.(cam)
        const rebuild = first || !!o.rebuild
        first = false
        if (engine) await engine.final(scene, cam, { pathtrace, samples: o.samples ?? opts.samples ?? useWorkspace.getState().settings.samples, rebuild, onSample: o.onSample, signal: o.signal })
        else gl.render(scene, cam)
      }
      try {
        return await fn(draw, w, h)
      } finally {
        applyObjectsAt(useWorkspace.getState().frame)
        // Doors back as the viewport shows them (the live view sets them again on its next frame).
        applyDoors(scene, () => null)
        gl.setPixelRatio(prevRatio)
        gl.setSize(prevSize.x, prevSize.y, false)
        scene.background = prevBg
        scene.environmentIntensity = prevEnv
        portals.forEach(([o, v]) => (o.visible = v))
        gl.setClearColor(prevClear, prevAlpha)
        hidden.forEach((o) => (o.visible = true))
        toggled.forEach(([o, v]) => (o.visible = v))
        if (engine) engine.offline = false
        if (prevShading !== 'rendered') useWorkspace.getState().setShading(prevShading)
        invalidate()
      }
    }

    viewport.renderPose = (frame) => poseAt(frame ?? useWorkspace.getState().frame)
    viewport.orbitRadius = (pose) => orbitRadius(sceneBox([...viewport.objects.values()]), pose, renderAspect())

    const current = (): ShotOptions => {
      const st = useWorkspace.getState()
      const p = activeProject(st)
      const walk = tourActive(p)
      const idx = p.levels.findIndex((l) => l.id === p.activeLevelId)
      return {
        width: st.settings.renderWidth,
        height: st.settings.renderHeight,
        transparent: st.settings.transparent,
        ceilings: walk ? p.tour.ceilings !== false : st.settings.showCeilings,
        maxLevel: walk || st.settings.showUpperLevels ? null : idx,
      }
    }

    viewport.renderShot = (pose, opts) =>
      session(opts, async (draw) => {
        await draw(pose, useWorkspace.getState().frame)
        return new Promise<Blob | null>((res) => gl.domElement.toBlob(res, opts.transparent ? 'image/png' : 'image/jpeg', 0.92))
      })

    viewport.renderStill = () =>
      session(current(), async (draw) => {
        const f = useWorkspace.getState().frame
        const samples = useWorkspace.getState().settings.samples
        const { renderWidth: rw, renderHeight: rh, engine: eng } = useWorkspace.getState().settings
        await draw(poseAt(f), f, {
          samples,
          doors: true,
          onSample: (n) => eng === 'pathtrace' && useWorkspace.getState().setRenderJob({ kind: 'image', done: Math.floor(n), total: samples, message: `${rw}×${rh} · sample ${Math.floor(n)} / ${samples}` }),
        })
        // toBlob snapshots the drawing buffer synchronously, before it's cleared.
        return new Promise<Blob | null>((res) => gl.domElement.toBlob(res, 'image/png'))
      })

    viewport.renderPanorama = ({ eye, heading, size, width, onFace, signal }) =>
      session({ width: size, height: size, ceilings: true, maxLevel: null }, async (draw) => {
        const f = useWorkspace.getState().frame
        const { samples, engine: eng } = useWorkspace.getState().settings
        const views: CubeView[] = []
        const grab = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })!
        for (const [k, face] of CUBE_FACES.entries()) {
          if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
          await draw(poseAt(f), f, {
            samples,
            signal,
            onSample: (n) => eng === 'pathtrace' && onFace(k + n / samples, CUBE_FACES.length),
            aim: (c) => {
              c.position.set(...eye)
              c.up.set(...face.up)
              c.lookAt(eye[0] + face.dir[0], eye[1] + face.dir[1], eye[2] + face.dir[2])
              c.fov = 90
              c.aspect = 1
              c.near = 0.05
              c.far = 500
              c.updateProjectionMatrix()
            },
          })
          grab.drawImage(gl.domElement, 0, 0)
          views.push({ data: grab.getImageData(0, 0, size, size).data, rot: viewRotation(face.dir, face.up) })
          onFace(k + 1, CUBE_FACES.length)
          await yieldToUi()
        }
        const px = equirect(views, size, width, heading)
        const out = new OffscreenCanvas(width, width / 2)
        out.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, width, width / 2), 0, 0)
        const jpeg = new Uint8Array(await (await out.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer())
        return new Blob([tagPanorama(jpeg, width, width / 2) as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })
      })

    viewport.renderVideo = (onFrame, signal) =>
      session({ ...current(), transparent: false }, async (draw, w, h) => {
        const mb = await import('mediabunny')
        const proj = activeProject(useWorkspace.getState())
        const anim = proj.animation
        const total = tourActive(proj) ? tourFrames(proj, anim.fps) : anim.end - anim.start + 1
        const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width: w, height: h })
        if (!codec) throw new Error('This browser cannot encode video. Use Chrome, Edge or Firefox 130+.')
        const webm = codec === 'vp8'
        const target = new mb.BufferTarget()
        const output = new mb.Output({ format: webm ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
        // Copy each frame into a 2D canvas right after drawing: the WebGL buffer is only valid until the task ends.
        const frameCanvas = new OffscreenCanvas(w, h)
        const ctx2d = frameCanvas.getContext('2d')!
        const source = new mb.CanvasSource(frameCanvas, { codec, bitrate: mb.QUALITY_VERY_HIGH, keyFrameInterval: 2 })
        output.addVideoTrack(source, { frameRate: anim.fps })
        await output.start()
        // Moving objects have to be re-baked for the path tracer every frame; a moving camera doesn't.
        const animated = proj.objects.some((o) => o.keys?.length)
        const samples = useWorkspace.getState().settings.videoSamples
        // Doors opening and closing on the walk: re-baked only on the frames where one moves.
        let doorKey = ''
        for (let i = 0; i < total; i++) {
          if (signal.aborted) {
            await output.cancel()
            throw new DOMException('Cancelled', 'AbortError')
          }
          const key = tourActive(proj) ? doorsKey(doorsAtFrame(proj, anim.start + i)) : ''
          const doorsMoved = key !== doorKey
          doorKey = key
          await draw(poseAt(anim.start + i), anim.start + i, { samples, rebuild: animated || doorsMoved, signal, doors: true })
          ctx2d.drawImage(gl.domElement, 0, 0)
          await source.add(i / anim.fps, 1 / anim.fps)
          onFrame(i + 1, total)
          await yieldToUi()
        }
        await output.finalize()
        return { blob: new Blob([target.buffer!], { type: output.format.mimeType }), extension: output.format.fileExtension }
      })
  }, [gl, scene, invalidate])

  return null
}

/**
 * Camera view (Numpad 0): the viewport looks through the render camera, with a
 * passepartout showing the output frame. Orbiting while in camera view moves the
 * render camera itself (Blender's "Lock Camera to View") when it isn't keyframed.
 */
export function CameraView() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const active = useWorkspace((s) => s.cameraView)
  const dragging = useRef(false)

  // What you see is what the next key or "camera from view" captures.
  useEffect(() => {
    viewport.viewPose = () => {
      if (!controls) return null
      const p = activeProject(useWorkspace.getState())
      const focal = p.camera?.focal ?? 50
      const prev = p.animation.keys.at(-1)?.pose.azimuth
      return poseFromCamera(camera, controls.target, focal, prev)
    }
  }, [camera, controls])

  // Save the free view on entry, restore it on exit.
  useEffect(() => {
    if (!active || !controls) return
    const saved = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov, damping: controls.enableDamping }
    controls.enableDamping = false
    return () => {
      controls.enableDamping = saved.damping
      camera.position.copy(saved.pos)
      camera.fov = saved.fov
      camera.updateProjectionMatrix()
      controls.target.copy(saved.target)
      controls.update()
      invalidate()
    }
  }, [active, camera, controls, invalidate])

  useEffect(() => {
    if (!active || !controls) return
    const apply = () => {
      if (dragging.current) return
      const pose = poseAt(useWorkspace.getState().frame)
      const rect = frameRect(size.width, size.height, renderAspect())
      // Widen the view so the render frame sits inside the viewport with a margin.
      const fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(focalToFov(pose.focal)) / 2) * (size.height / rect.h)))
      applyPose(camera, pose, size.width / size.height, fov)
      controls.target.fromArray(pose.target)
      invalidate()
    }
    apply()
    const unsub = useWorkspace.subscribe((s, prev) => {
      if (s.frame !== prev.frame || s.projects !== prev.projects || s.settings.renderWidth !== prev.settings.renderWidth || s.settings.renderHeight !== prev.settings.renderHeight) apply()
    })

    const onStart = () => (dragging.current = true)
    const onEnd = () => {
      dragging.current = false
      const s = useWorkspace.getState()
      const p = activeProject(s)
      if (p.animation.keys.length) return apply() // keyed cameras change only via Insert Keyframe
      const focal = p.camera?.focal ?? 50
      s.setCamera(poseFromCamera(camera, controls.target, focal))
    }
    controls.addEventListener('start', onStart)
    controls.addEventListener('end', onEnd)

    return () => {
      unsub()
      controls.removeEventListener('start', onStart)
      controls.removeEventListener('end', onEnd)
    }
  }, [active, camera, controls, size.width, size.height, invalidate])

  return null
}

