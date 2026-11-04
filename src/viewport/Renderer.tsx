import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { HalfFloatType, MeshBasicMaterial, type MeshStandardMaterial, PerspectiveCamera, Scene as ThreeScene, Vector2, WebGLRenderTarget, type Camera, type Material, type Mesh, type Object3D, type Scene, type WebGLRenderer, type Light } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { TexturePass } from 'three/examples/jsm/postprocessing/TexturePass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { DenoiseMaterial, WebGLPathTracer } from 'three-gpu-pathtracer'
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker'
import { useWorkspace } from '@/store/workspace'
import { viewport, type TraceProgress } from './bridge'

/**
 * Final image pipeline, Blender-style:
 * - Rendered view + path tracing: a GPU path tracer (three-gpu-pathtracer) refines the image
 *   progressively, like Cycles' viewport. While the camera moves or the scene changes it shows the
 *   real-time render, then picks up again.
 * - Material / Rendered real-time: the rasteriser, into an HDR buffer.
 * Both end in the same bloom (glare around lamps and bright windows), tone mapping and overlays.
 */

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** A cheap fingerprint of what the path tracer has baked (meshes, transforms, materials). */
function sceneSignature(world: Object3D) {
  let h = 17
  const mix = (v: number) => (h = (Math.imul(h, 31) + (v | 0)) | 0)
  world.traverseVisible((o) => {
    const m = o as Mesh
    if (!m.isMesh || o.name === '__selection') return
    mix(m.id)
    mix(m.geometry.id)
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Material[]
    for (const x of mats) {
      // Not `version`: three bumps it on some materials every frame. Identity, maps and colours.
      const std = x as MeshStandardMaterial
      mix(x.id)
      mix(std.map?.id ?? 0)
      mix(std.normalMap?.id ?? 0)
      mix(std.roughnessMap?.id ?? 0)
      mix(std.emissiveMap?.id ?? 0)
      mix(std.color?.getHex() ?? 0)
      mix(std.emissive?.getHex() ?? 0)
      mix(Math.round((std.emissiveIntensity ?? 0) * 100))
    }
    const e = m.matrixWorld.elements
    for (let i = 0; i < 16; i++) mix(Math.round(e[i] * 1e4))
  })
  return h
}

function lightSignature(world: Object3D) {
  let h = 7
  const mix = (v: number) => (h = (Math.imul(h, 31) + (v | 0)) | 0)
  world.traverseVisible((o) => {
    const l = o as Light
    if (!l.isLight) return
    mix(l.id)
    mix(l.color.getHex())
    mix(Math.round(l.intensity * 1e3))
    const e = l.matrixWorld.elements
    mix(Math.round(e[12] * 1e4))
    mix(Math.round(e[13] * 1e4))
    mix(Math.round(e[14] * 1e4))
  })
  return h
}

function cameraSignature(c: Camera) {
  let h = 3
  for (const v of [...c.matrixWorld.elements, ...c.projectionMatrix.elements]) h = (Math.imul(h, 31) + Math.round(v * 1e5)) | 0
  return h
}

class Engine {
  readonly composer: EffectComposer
  private renderPass: RenderPass
  private texturePass: TexturePass
  private bloom: UnrealBloomPass
  private pt: WebGLPathTracer | null = null
  private worker: GenerateMeshBVHWorker | null = null
  private denoise = new FullScreenQuad(new DenoiseMaterial({ sigma: 4.5, threshold: 0.035, kSigma: 1 }))
  private denoiseTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
  private depthOnly = new MeshBasicMaterial({ colorWrite: false })
  private size = new Vector2()

  // Path tracer state
  private built = false
  private building: Promise<void> | null = null
  private sig = { scene: 0, lights: 0, camera: 0, env: '' as unknown }
  private changedAt = 0
  /** Offline renders own the renderer; the viewport loop stands back. */
  offline = false
  failed = false

  constructor(private gl: WebGLRenderer) {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 })
    this.composer = new EffectComposer(gl, target)
    this.composer.setPixelRatio(1)
    this.renderPass = new RenderPass(new ThreeScene(), new PerspectiveCamera())
    this.texturePass = new TexturePass(null as never)
    // Only what is far brighter than paper white blooms: bulbs, the sun's glint, a bright sky.
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.32, 0.5, 2.2)
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.texturePass)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
  }

  private syncSize() {
    this.gl.getDrawingBufferSize(this.size)
    const { x, y } = this.size
    if (this.composer.renderTarget1.width !== x || this.composer.renderTarget1.height !== y) this.composer.setSize(x, y)
  }

  /** Real-time frame through the HDR pipeline (bloom, tone mapping) to the canvas. */
  raster(scene: Scene, camera: Camera, bloom = true) {
    this.syncSize()
    this.renderPass.enabled = true
    this.texturePass.enabled = false
    this.renderPass.scene = scene
    this.renderPass.camera = camera
    this.bloom.enabled = bloom
    this.composer.render()
  }

  /** The path-traced image (denoised if asked) through bloom and tone mapping to the canvas. */
  private presentTrace(denoise: boolean) {
    const pt = this.pt!
    this.syncSize()
    let tex = pt.target.texture
    if (denoise) {
      const { width, height } = pt.target
      if (this.denoiseTarget.width !== width || this.denoiseTarget.height !== height) this.denoiseTarget.setSize(width, height)
      ;(this.denoise.material as DenoiseMaterial).uniforms.map.value = tex
      const prev = this.gl.getRenderTarget()
      this.gl.setRenderTarget(this.denoiseTarget)
      this.denoise.render(this.gl)
      this.gl.setRenderTarget(prev)
      tex = this.denoiseTarget.texture
    }
    this.renderPass.enabled = false
    this.texturePass.enabled = true
    this.texturePass.map = tex
    this.bloom.enabled = true
    this.composer.render()
  }

  /** Grid, gizmo and selection outlines over a path-traced frame, hidden behind the scene's own depth. */
  overlays(scene: Scene, camera: Camera) {
    const world = scene.getObjectByName('__world')
    const helpers = scene.getObjectByName('__helpers')
    const gl = this.gl
    const auto = gl.autoClear
    const bg = scene.background
    gl.autoClear = false
    gl.clearDepth()
    scene.background = null
    if (helpers) helpers.visible = false
    scene.overrideMaterial = this.depthOnly
    gl.render(scene, camera)
    scene.overrideMaterial = null
    if (world) world.visible = false
    if (helpers) helpers.visible = true
    gl.render(scene, camera)
    if (world) world.visible = true
    const boxes: Object3D[] = []
    world?.traverseVisible((o) => o.name === '__selection' && boxes.push(o))
    for (const b of boxes) gl.render(b, camera)
    scene.background = bg
    gl.autoClear = auto
  }

  private tracer() {
    if (!this.pt) {
      const pt = new WebGLPathTracer(this.gl)
      pt.renderToCanvas = false
      pt.renderDelay = 0
      pt.minSamples = 1
      pt.fadeDuration = 0
      pt.rasterizeScene = false
      pt.filterGlossyFactor = 0.5
      pt.transmissiveBounces = 10
      pt.textureSize.set(1024, 1024)
      try {
        this.worker = new GenerateMeshBVHWorker()
        pt.setBVHWorker(this.worker as never)
      } catch {
        this.worker = null
      }
      this.pt = pt
    }
    return this.pt
  }

  /** Bake the scene (geometry, materials, lights, sky) for the path tracer. Helpers stay out. */
  private build(scene: Scene, camera: Camera): Promise<void> {
    const pt = this.tracer()
    const hidden: Object3D[] = []
    scene.traverse((o) => {
      if (o.visible && (o.name === '__helpers' || o.name === '__contact')) {
        o.visible = false
        hidden.push(o)
      }
    })
    const restore = () => hidden.forEach((o) => (o.visible = true))
    // The meshes are collected synchronously; only the BVH is built in the worker.
    try {
      const job = this.worker ? pt.setSceneAsync(scene, camera) : (pt.setScene(scene, camera), Promise.resolve())
      restore()
      return job.then(() => {
        this.built = true
      })
    } catch (e) {
      restore()
      return Promise.reject(e)
    }
  }

  private configure(viewportMode: boolean) {
    const s = useWorkspace.getState().settings
    const pt = this.tracer()
    // The live view is a preview: half resolution (a quarter of the pixels) and at most 3 bounces,
    // so it never saturates the GPU. Final renders use full resolution and every bounce.
    pt.bounces = viewportMode ? Math.min(3, s.bounces) : s.bounces
    pt.renderScale = viewportMode ? 0.5 / this.gl.getPixelRatio() : 1
  }

  private envKey(scene: Scene) {
    return `${scene.environment?.uuid}|${scene.environmentIntensity}|${(scene.background as { getHexString?: () => string } | null)?.getHexString?.()}`
  }

  /**
   * One viewport frame in Rendered + path tracing. Returns true while it still wants frames
   * (refining, or waiting for a rebuild).
   */
  viewportTrace(scene: Scene, camera: Camera): boolean {
    if (this.failed) {
      this.raster(scene, camera)
      return false
    }
    const st = useWorkspace.getState().settings
    const pt = this.tracer()
    const world = scene.getObjectByName('__world') ?? scene
    scene.updateMatrixWorld()
    const sceneSig = sceneSignature(world)
    const now = performance.now()
    if (sceneSig !== this.sig.scene) {
      this.sig.scene = sceneSig
      this.changedAt = now
      this.built = false
    }
    // Rebuild once the scene has been still for a moment (dragging shows the real-time view).
    if (!this.built && !this.building && now - this.changedAt > 140) {
      const at = this.sig.scene
      this.configure(true)
      this.building = this.build(scene, camera)
        .then(() => {
          this.sig.lights = lightSignature(world)
          this.sig.camera = cameraSignature(camera)
          this.sig.env = this.envKey(scene)
          if (at !== this.sig.scene) this.built = false
        })
        .catch((e) => {
          console.warn('[pathtracer] build failed', e)
          this.failed = true
        })
        .finally(() => {
          this.building = null
          viewport.invalidate()
        })
    }
    if (!this.built || this.building) {
      this.raster(scene, camera)
      this.overlays(scene, camera)
      this.report({ state: 'building', samples: 0, max: st.viewportSamples })
      return true
    }
    this.configure(true)
    const lights = lightSignature(world)
    if (lights !== this.sig.lights) {
      this.sig.lights = lights
      pt.updateLights()
    }
    const env = this.envKey(scene)
    if (env !== this.sig.env) {
      this.sig.env = env
      pt.updateEnvironment()
    }
    const cam = cameraSignature(camera)
    if (cam !== this.sig.camera) {
      this.sig.camera = cam
      pt.setCamera(camera)
    }
    pt.tiles.set(1, 1)
    const max = st.viewportSamples
    if (pt.samples < max) pt.renderSample()
    // The first couple of samples are mostly speckle: keep the real-time image until it reads.
    if (pt.samples < 3) this.raster(scene, camera)
    else this.presentTrace(st.denoise)
    this.overlays(scene, camera)
    this.report({ state: pt.samples >= max ? 'done' : 'sampling', samples: Math.floor(pt.samples), max })
    return pt.samples < max
  }

  private report(p: TraceProgress) {
    viewport.traceProgress = p
    viewport.onTraceProgress?.(p)
  }

  /** Viewport went back to real-time: forget what was baked (the next Rendered view rebuilds). */
  release() {
    if (viewport.traceProgress.state === 'off') return
    this.built = false
    this.sig.scene = 0
    this.report({ state: 'off', samples: 0, max: 0 })
  }

  /**
   * Offline frame for F12, videos and PDF pages, at the renderer's current size. Path traced to
   * `samples` (rebuilding the scene if anything moved) or rasterised. Ends with the finished image
   * on the canvas, in the same task, so the caller can capture it right away.
   */
  async final(scene: Scene, camera: Camera, opts: { pathtrace: boolean; samples: number; rebuild: boolean; onSample?: (done: number) => void; signal?: AbortSignal }) {
    const s = useWorkspace.getState().settings
    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
    if (!opts.pathtrace || this.failed) {
      this.raster(scene, camera)
      return
    }
    const pt = this.tracer()
    this.configure(false)
    if (opts.rebuild || !this.built) {
      await this.building
      await this.build(scene, camera)
      // Whatever the viewport had baked doesn't match any more.
      this.sig.scene = 0
    } else {
      pt.updateLights()
      pt.updateEnvironment()
    }
    pt.setCamera(camera)
    this.gl.getDrawingBufferSize(this.size)
    const px = this.size.x * this.size.y
    // Big frames in tiles, so a single GPU submission never runs long enough to time out.
    const t = px > 4e6 ? 4 : px > 1.5e6 ? 3 : px > 5e5 ? 2 : 1
    pt.tiles.set(t, t)
    let last = performance.now()
    while (pt.samples < opts.samples) {
      if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      pt.renderSample()
      opts.onSample?.(pt.samples)
      // Give the browser (and the GPU) a breath every so often.
      if (performance.now() - last > 60) {
        await nextFrame()
        last = performance.now()
      }
    }
    this.presentTrace(s.denoise)
    this.sig.camera = 0
  }

  dispose() {
    this.composer.dispose()
    this.pt?.dispose()
    this.worker?.dispose()
    this.denoiseTarget.dispose()
  }
}

let engine: Engine | null = null
let nextSample = 0
export const getEngine = () => engine

/**
 * Takes over drawing (render priority 1, so R3F's own render steps aside). The gizmo HUD draws on
 * top at priority 2.
 */
export function FinalRender() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    engine = new Engine(gl)
    if (import.meta.env.DEV) (window as unknown as { __engine: Engine }).__engine = engine
    return () => {
      engine?.dispose()
      engine = null
    }
  }, [gl])

  useFrame(({ gl, scene, camera, invalidate }) => {
    const e = engine
    if (!e) return gl.render(scene, camera)
    if (e.offline) return
    const s = useWorkspace.getState()
    if (s.shading === 'rendered' && s.settings.engine === 'pathtrace') {
      // One sample per ~40 ms at most: the GPU gets breathing room, so the rest of the
      // computer (and the UI) stays responsive while the image refines.
      if (e.viewportTrace(scene, camera)) {
        clearTimeout(nextSample)
        nextSample = window.setTimeout(() => invalidate(), 40)
      }
      return
    }
    e.release()
    if (s.shading === 'wireframe' || s.shading === 'solid') gl.render(scene, camera)
    else e.raster(scene, camera, s.shading === 'rendered')
  }, 1)
  return null
}
