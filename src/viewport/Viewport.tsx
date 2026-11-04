import { ContactShadows, GizmoHelper, GizmoViewport, Grid, OrbitControls, TransformControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AgXToneMapping,
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  MOUSE,
  PMREMGenerator,
  Sphere,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useActiveProject, useWorkspace, type ShadingMode, type Vec3 } from '@/store/workspace'
import { viewport } from './bridge'
import { Model, withOriginalMaterials } from './Model'
import { CameraView, RenderBridge } from './RenderSystem'

const AXIS_X = '#e5484d'
const AXIS_Z = '#3e63dd'

/** Per shading mode: environment, fill and key light strengths. */
const LIGHTING: Record<ShadingMode, { env: number; fill: number; key: number }> = {
  wireframe: { env: 0.4, fill: 0.9, key: 1.0 },
  solid: { env: 0.35, fill: 0.9, key: 1.2 },
  material: { env: 0.9, fill: 0, key: 0.4 },
  rendered: { env: 0.55, fill: 0, key: 2.4 },
}

function StudioEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const shading = useWorkspace((s) => s.shading)
  const intensity = useWorkspace((s) => s.settings.envIntensity) * LIGHTING[shading].env
  const exposure = useWorkspace((s) => s.settings.exposure)

  // Procedural room env: no network fetch, ~1ms to bake.
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  useEffect(() => {
    scene.environmentIntensity = intensity
    gl.toneMappingExposure = exposure
    viewport.invalidate()
  }, [gl, scene, intensity, exposure])
  return null
}

function FloorAxes() {
  const lines = useMemo(() => {
    const g = new BufferGeometry()
    // Short segments instead of one huge line: some GPUs/drivers mis-clip
    // a single segment that crosses behind the camera.
    const pos: number[] = []
    const col: number[] = []
    const x = hex(AXIS_X, 0.6)
    const z = hex(AXIS_Z, 0.6)
    const EXTENT = 200
    const STEP = 2
    for (let i = -EXTENT; i < EXTENT; i += STEP) {
      pos.push(i, 0.0005, 0, i + STEP, 0.0005, 0, 0, 0.0005, i, 0, 0.0005, i + STEP)
      col.push(...x, ...x, ...z, ...z)
    }
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(col, 3))
    // Opaque on purpose: drawn in the opaque pass, so the transparent grid can't cover it.
    const l = new LineSegments(g, new LineBasicMaterial({ vertexColors: true }))
    l.raycast = () => {}
    return l
  }, [])
  return <primitive object={lines} />
}
function hex(c: string, k = 1) {
  const n = parseInt(c.slice(1), 16)
  return [(((n >> 16) & 255) / 255) * k, (((n >> 8) & 255) / 255) * k, ((n & 255) / 255) * k]
}

/** Smooth camera framing, rendered on demand only while animating. */
function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const invalidate = useThree((s) => s.invalidate)
  const anim = useRef<{ fromPos: Vector3; toPos: Vector3; fromTarget: Vector3; toTarget: Vector3; t: number } | null>(null)

  useEffect(() => {
    const fit = (objects: Object3D[]) => {
      if (!controls) return
      const box = new Box3()
      objects.forEach((o) => o.visible && box.expandByObject(o))
      if (box.isEmpty()) box.set(new Vector3(-1, 0, -1), new Vector3(1, 2, 1))
      const sphere = box.getBoundingSphere(new Sphere())
      const fov = (camera.fov * Math.PI) / 180
      const dist = (sphere.radius / Math.sin(fov / 2)) * 1.45
      const dir = camera.position.clone().sub(controls.target).normalize()
      anim.current = {
        fromPos: camera.position.clone(),
        toPos: sphere.center.clone().addScaledVector(dir, dist),
        fromTarget: controls.target.clone(),
        toTarget: sphere.center.clone(),
        t: 0,
      }
      invalidate()
    }
    viewport.frameSelected = () => {
      useWorkspace.getState().setCameraView(false)
      const id = useWorkspace.getState().selectedId
      const o = id ? viewport.objects.get(id) : undefined
      fit(o ? [o] : [...viewport.objects.values()])
    }
    viewport.frameAll = () => {
      useWorkspace.getState().setCameraView(false)
      fit([...viewport.objects.values()])
    }
  }, [camera, controls, invalidate])

  useFrame((_, dt) => {
    const a = anim.current
    if (!a || !controls) return
    a.t = Math.min(1, a.t + dt / 0.32)
    const k = 1 - Math.pow(1 - a.t, 3) // easeOutCubic
    camera.position.lerpVectors(a.fromPos, a.toPos, k)
    controls.target.lerpVectors(a.fromTarget, a.toTarget, k)
    controls.update()
    if (a.t < 1) invalidate()
    else anim.current = null
  })
  return null
}

/** Registers export so menus and hotkeys can call it. */
function Bridge() {
  const { gl, scene, camera, invalidate } = useThree()
  useEffect(() => {
    viewport.invalidate = invalidate
    viewport.exportGlb = async (id) => {
      const target = viewport.objects.get(id)
      if (!target) return null
      const restore = withOriginalMaterials(target)
      const helpers: Object3D[] = []
      target.traverse((o) => o.name === '__selection' && o.visible && (helpers.push(o), (o.visible = false)))
      try {
        const out = await new GLTFExporter().parseAsync(target, { binary: true, onlyVisible: true })
        return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' })
      } finally {
        restore()
        helpers.forEach((o) => (o.visible = true))
        invalidate()
      }
    }
  }, [gl, scene, camera, invalidate])
  return null
}

const TOOL_LABEL = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' } as const

/** Gizmo release → one undoable store update. */
function commitTransform(o: Object3D, tool: keyof typeof TOOL_LABEL) {
  const id = o.userData.id as string
  useWorkspace.getState().commit(TOOL_LABEL[tool], id, {
    transform: {
      position: o.position.toArray() as Vec3,
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
      scale: o.scale.toArray() as Vec3,
    },
  })
}

function SceneContent() {
  const project = useActiveProject()
  const selectedId = useWorkspace((s) => s.selectedId)
  const shading = useWorkspace((s) => s.shading)
  const tool = useWorkspace((s) => s.tool)
  const showGrid = useWorkspace((s) => s.settings.showGrid)
  const invalidate = useThree((s) => s.invalidate)
  const [target, setTarget] = useState<Object3D | null>(null)
  const rendered = shading === 'rendered'
  const light = LIGHTING[shading]

  // Resolve the selected group after it mounts (it may still be suspending on load).
  useFrame(() => {
    const o = selectedId ? (viewport.objects.get(selectedId) ?? null) : null
    if (o !== target) setTarget(o)
  })

  return (
    <>
      <StudioEnvironment />
      <hemisphereLight args={['#ffffff', '#3a3a3a', light.fill]} />
      <directionalLight
        position={[4, 7, 3]}
        intensity={light.key}
        castShadow={rendered}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />

      {project.objects.map((o) => (
        <Model key={o.id} obj={o} selected={o.id === selectedId} shading={shading} />
      ))}

      {rendered && <ContactShadows position={[0, 0.001, 0]} opacity={0.55} scale={12} blur={2.4} far={4} resolution={512} />}

      <group name="__helpers">
        {showGrid && (
          <>
            <Grid
              raycast={() => {}}
              infiniteGrid
              cellSize={0.25}
              sectionSize={1}
              cellThickness={0.6}
              sectionThickness={1}
              cellColor="#232323"
              sectionColor="#323232"
              fadeDistance={45}
              fadeStrength={1.4}
            />
            <FloorAxes />
          </>
        )}
        {target && tool !== 'select' && (
          <TransformControls object={target} mode={tool} size={0.8} onChange={() => invalidate()} onMouseUp={() => commitTransform(target, tool)} />
        )}
      </group>
    </>
  )
}

export function Viewport() {
  const down = useRef({ x: 0, y: 0 })

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      shadows="percentage"
      camera={{ position: [4.2, 3, 5.4], fov: 38, near: 0.05, far: 2000 }}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: AgXToneMapping }}
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onPointerMissed={(e) => {
        if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 4) useWorkspace.getState().select(null)
      }}
      className="!absolute inset-0"
    >
      <color attach="background" args={['#141414']} />
      <SceneContent />
      <CameraRig />
      <Bridge />
      <RenderBridge />
      <CameraView />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        zoomToCursor
        target={[0, 0.8, 0]}
        mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }}
      />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={[AXIS_X, '#46a758', AXIS_Z]} labelColor="#0b0b0b" axisHeadScale={0.95} />
      </GizmoHelper>
    </Canvas>
  )
}
