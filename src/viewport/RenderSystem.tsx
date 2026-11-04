import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Color, MathUtils, PerspectiveCamera, Vector2, type Object3D } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { activeProject, useWorkspace, type CameraPose } from '@/store/workspace'
import { viewport } from './bridge'
import { applyPose, defaultPose, evaluate, focalToFov, frameRect, orbitRadius, poseFromCamera, sceneBox } from './camera'

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0))

function renderAspect() {
  const { renderWidth, renderHeight } = useWorkspace.getState().settings
  return renderWidth / renderHeight
}

/** Render camera at `frame`: keyframes → static camera → automatic product framing. */
function poseAt(frame: number): CameraPose {
  const s = useWorkspace.getState()
  const p = activeProject(s)
  const fallback = p.camera ?? defaultPose([...viewport.objects.values()], renderAspect())
  return evaluate(p.animation, frame, fallback)
}

/**
 * Offline renderer: resizes the drawing buffer to the output resolution, draws each
 * frame through the render camera and captures it synchronously. Output quality is
 * independent of viewport size or GPU speed.
 */
export function RenderBridge() {
  const { gl, scene, invalidate } = useThree()

  useEffect(() => {
    async function session<T>(opts: { transparent: boolean }, fn: (draw: (pose: CameraPose) => void, w: number, h: number) => Promise<T>) {
      const s = useWorkspace.getState()
      const w = s.settings.renderWidth
      const h = s.settings.renderHeight
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

      const hidden: Object3D[] = []
      scene.traverse((o) => {
        if (o.visible && (o.name.startsWith('__') || o.userData.renderable === false)) {
          o.visible = false
          hidden.push(o)
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
      }
      gl.setPixelRatio(1)
      gl.setSize(w, h, false)
      const cam = new PerspectiveCamera()
      const draw = (pose: CameraPose) => {
        applyPose(cam, pose, w / h)
        gl.render(scene, cam)
      }
      try {
        return await fn(draw, w, h)
      } finally {
        gl.setPixelRatio(prevRatio)
        gl.setSize(prevSize.x, prevSize.y, false)
        scene.background = prevBg
        gl.setClearColor(prevClear, prevAlpha)
        hidden.forEach((o) => (o.visible = true))
        if (prevShading !== 'rendered') useWorkspace.getState().setShading(prevShading)
        invalidate()
      }
    }

    viewport.renderPose = (frame) => poseAt(frame ?? useWorkspace.getState().frame)
    viewport.orbitRadius = (pose) => orbitRadius(sceneBox([...viewport.objects.values()]), pose, renderAspect())

    viewport.renderStill = () =>
      session({ transparent: useWorkspace.getState().settings.transparent }, async (draw) => {
        draw(poseAt(useWorkspace.getState().frame))
        // toBlob snapshots the drawing buffer synchronously, before it's cleared.
        return new Promise<Blob | null>((res) => gl.domElement.toBlob(res, 'image/png'))
      })

    viewport.renderVideo = (onFrame, signal) =>
      session({ transparent: false }, async (draw, w, h) => {
        const mb = await import('mediabunny')
        const anim = activeProject(useWorkspace.getState()).animation
        const total = anim.end - anim.start + 1
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
        for (let i = 0; i < total; i++) {
          if (signal.aborted) {
            await output.cancel()
            throw new DOMException('Cancelled', 'AbortError')
          }
          draw(poseAt(anim.start + i))
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

