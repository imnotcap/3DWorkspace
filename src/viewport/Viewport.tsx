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
  Euler,
  Quaternion,
  type Mesh,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { PartsSpec } from '@/generation/parts/spec'
import { activeProject, useActiveProject, useWorkspace, type SceneObject, type ShadingMode, type Vec3 } from '@/store/workspace'
import { viewport } from './bridge'
import { sceneBox, visibleBox } from './camera'
import { Model, withOriginalMaterials, type Tree } from './Model'
import { CameraView, RenderBridge, tourActive } from './RenderSystem'
import { FinalRender } from './Renderer'
import { daylight } from './sky'
import { wallSafeTransform } from '@/plan/constrain'
import { HouseLevel } from './House'
import { levelElevations } from '@/plan/levels'

const AXIS_X = '#e5484d'
const AXIS_Z = '#3e63dd'

/** Per shading mode: environment, fill and key light strengths. */
const LIGHTING: Record<ShadingMode, { env: number; fill: number; key: number }> = {
  wireframe: { env: 0.4, fill: 0.9, key: 1.0 },
  solid: { env: 0.35, fill: 0.9, key: 1.2 },
  material: { env: 0.9, fill: 0, key: 0.4 },
  // Rendered: the sky's own brightness and the sun (see sky.ts).
  rendered: { env: 1, fill: 0, key: 0 },
}

/**
 * Editing modes are lit by a neutral studio (like Blender's Material Preview); Rendered uses the
 * scene's own light: the sky and sun for the time of day, plus the lamps.
 */
function StudioEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const shading = useWorkspace((s) => s.shading)
  const ambience = useWorkspace((s) => s.settings.ambience)
  const rendered = shading === 'rendered'
  const intensity = useWorkspace((s) => s.settings.envIntensity) * LIGHTING[shading].env
  const exposure = useWorkspace((s) => s.settings.exposure)

  // Procedural room env: no network fetch, ~1ms to bake.
  const studio = useMemo(() => {
    const pmrem = new PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    return env
  }, [gl])
  useEffect(() => () => studio.dispose(), [studio])

  useEffect(() => {
    scene.environment = rendered ? daylight(ambience).sky : studio
    viewport.invalidate()
    return () => void (scene.environment = null)
  }, [scene, rendered, ambience, studio])

  useEffect(() => {
    scene.environmentIntensity = intensity
    gl.toneMappingExposure = exposure
    viewport.invalidate()
  }, [gl, scene, intensity, exposure])
  return null
}

/** The sun of the time of day (Rendered), or a studio key light (editing modes). */
function SunLight() {
  const shading = useWorkspace((s) => s.shading)
  const ambience = useWorkspace((s) => s.settings.ambience)
  const rendered = shading === 'rendered'
  const day = daylight(ambience)
  const pos = rendered ? (day.sunDir.toArray().map((v) => v * 24) as Vec3) : ([8, 14, 6] as Vec3)
  return (
    <directionalLight
      position={pos}
      color={rendered ? day.sunColor : '#ffffff'}
      intensity={rendered ? day.sunIntensity : LIGHTING[shading].key}
      castShadow={rendered}
      shadow-mapSize={[4096, 4096]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.02}
      shadow-radius={3}
      shadow-camera-left={-20}
      shadow-camera-right={20}
      shadow-camera-top={20}
      shadow-camera-bottom={-20}
      shadow-camera-far={80}
    />
  )
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
    /** Frame these objects, or everything (house included) with null. */
    const fit = (objects: Object3D[] | null) => {
      if (!controls) return
      const box = objects ? new Box3() : sceneBox([...viewport.objects.values()])
      objects?.forEach((o) => visibleBox(o, box))
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
      fit(o ? [o] : null)
    }
    viewport.frameAll = () => {
      useWorkspace.getState().setCameraView(false)
      fit(null)
    }
  }, [camera, controls, invalidate])

  // Frame the house when the planner opens, the view opens, a project or template loads, or the first walls appear.
  useEffect(() => {
    const t = setTimeout(() => viewport.frameAll(), 300)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    const later = () => setTimeout(() => viewport.frameAll(), 120)
    return useWorkspace.subscribe((s, prev) => {
      const p = activeProject(s)
      const q = activeProject(prev)
      if (s.view !== prev.view && s.view !== 'plan') later()
      else if (s.activeProjectId !== prev.activeProjectId) later()
      else if (p.walls.length && (!q.walls.length || p.name !== q.name)) later()
    })
  }, [])

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

    /** Claude parts → one editable primitive object per part, each exactly where it is now. */
    viewport.separate = (id) => {
      const obj = activeProject(useWorkspace.getState()).objects.find((o) => o.id === id)
      const g = viewport.objects.get(id)
      const spec = obj?.spec as PartsSpec | undefined
      if (!obj || !g || !spec?.parts) return null
      g.updateMatrixWorld(true)
      const out: Omit<SceneObject, 'id'>[] = []
      let ordinal = 0
      g.traverse((o) => {
        const m = o as Mesh
        if (!m.isMesh || o.name === '__selection') return
        const part = spec.parts[(m.userData.partIndex as number | undefined) ?? ordinal]
        ordinal++
        if (!part) return
        const mat = spec.materials.find((x) => x.id === part.material)
        const pos = new Vector3()
        const q = new Quaternion()
        const sc = new Vector3()
        m.matrixWorld.decompose(pos, q, sc)
        const e = new Euler().setFromQuaternion(q, 'XYZ')
        out.push({
          name: part.name,
          source: 'Modelled',
          primitive: {
            shape: part.shape,
            dims: part.dims,
            profile: part.profile,
            material: { name: mat?.name ?? 'Material', color: mat?.color ?? '#bcbcbc', roughness: mat?.roughness ?? 0.5, metalness: mat?.metalness ?? 0 },
          },
          visible: obj.visible,
          renderable: obj.renderable,
          transform: { position: pos.toArray() as Vec3, rotation: [e.x, e.y, e.z], scale: sc.toArray() as Vec3 },
          shade: 'original',
          // Keep whatever material the user had chosen for that surface.
          material: obj.surfaces?.[m.userData.slot as string] ?? obj.material ?? null,
          exact: true,
        })
      })
      return out.length ? out : null
    }

    viewport.relativeTransform = (id, parentId) => {
      const o = viewport.objects.get(id)
      const parent = parentId ? viewport.objects.get(parentId) : null
      if (!o || (parentId && !parent)) return null
      o.updateWorldMatrix(true, false)
      const m = o.matrixWorld.clone()
      if (parent) {
        parent.updateWorldMatrix(true, false)
        m.premultiply(parent.matrixWorld.clone().invert())
      }
      const pos = new Vector3()
      const q = new Quaternion()
      const sc = new Vector3()
      m.decompose(pos, q, sc)
      const e = new Euler().setFromQuaternion(q, 'XYZ')
      return { position: pos.toArray() as Vec3, rotation: [e.x, e.y, e.z], scale: sc.toArray() as Vec3 }
    }

    /** Every visible object in one GLB, with the materials you assigned (models keep their part hierarchy). */
    viewport.exportScene = async () => {
      const objs = roots().filter((o) => o.visible)
      if (!objs.length) return null
      const restores = objs.map(withOriginalMaterials)
      const helpers: Object3D[] = []
      objs.forEach((t) => t.traverse((o) => o.name === '__selection' && o.visible && (helpers.push(o), (o.visible = false))))
      try {
        const out = await new GLTFExporter().parseAsync(objs, { binary: true, onlyVisible: true })
        return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' })
      } finally {
        restores.forEach((r) => r())
        helpers.forEach((o) => (o.visible = true))
        invalidate()
      }
    }

    viewport.exportGlb = async (id) => {
      const target = viewport.objects.get(id)
      if (!target) return null
      const restore = withOriginalMaterials(target)
      const helpers: Object3D[] = []
      target.traverse((o) => o.name === '__selection' && o.visible && (helpers.push(o), (o.visible = false)))
      // A part exports where it sits in the scene, not relative to its model: its world placement
      // is written into its own transform for the export, then put back.
      const saved = target.userData.parentId ? { p: target.position.clone(), q: target.quaternion.clone(), s: target.scale.clone() } : null
      if (saved) {
        target.updateWorldMatrix(true, false)
        target.matrixWorld.decompose(target.position, target.quaternion, target.scale)
        target.updateMatrix()
      }
      try {
        const out = await new GLTFExporter().parseAsync(target, { binary: true, onlyVisible: true })
        return new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' })
      } finally {
        if (saved) {
          target.position.copy(saved.p)
          target.quaternion.copy(saved.q)
          target.scale.copy(saved.s)
          target.updateMatrixWorld(true)
        }
        restore()
        helpers.forEach((o) => (o.visible = true))
        invalidate()
      }
    }
  }, [gl, scene, camera, invalidate])
  return null
}

/** Top-level objects; parts live inside their model's Object3D. */
const roots = () => [...viewport.objects.values()].filter((o) => !o.userData.parentId)

const TOOL_LABEL = { translate: 'Move', rotate: 'Rotate', scale: 'Scale' } as const

/** While the gizmo drags a piece, it slides along walls instead of going into them. */
function keepOutOfWalls(o: Object3D) {
  const s = useWorkspace.getState()
  const p = activeProject(s)
  const obj = p.objects.find((x) => x.id === o.userData.id)
  if (!obj) return
  const t = { position: o.position.toArray() as Vec3, rotation: [o.rotation.x, o.rotation.y, o.rotation.z] as Vec3, scale: o.scale.toArray() as Vec3 }
  const safe = wallSafeTransform(p, obj, t)
  if (safe !== t) o.position.fromArray(safe.position)
}

/** Gizmo release → one undoable store update. */
function commitTransform(o: Object3D, tool: keyof typeof TOOL_LABEL) {
  const id = o.userData.id as string
  const s = useWorkspace.getState()
  const transform = { position: o.position.toArray() as Vec3, rotation: [o.rotation.x, o.rotation.y, o.rotation.z] as Vec3, scale: o.scale.toArray() as Vec3 }
  const obj = activeProject(s).objects.find((x) => x.id === id)
  // Animated objects auto-key: the edit becomes a keyframe at the current frame.
  if (obj?.keys?.length) s.setObjectKey(id, s.frame, transform, TOOL_LABEL[tool])
  else s.commit(TOOL_LABEL[tool], id, { transform })
}

/** Dark studio while editing; the sky of the time of day when walking through the house. */
function Background() {
  const project = useActiveProject()
  const walking = useWorkspace((s) => s.cameraView) && tourActive(project)
  const ambience = useWorkspace((s) => s.settings.ambience)
  return <color attach="background" args={[walking ? `#${daylight(ambience).background.getHexString()}` : '#141414']} />
}

function SceneContent() {
  const project = useActiveProject()
  const selectedId = useWorkspace((s) => s.selectedId)
  const shading = useWorkspace((s) => s.shading)
  const tool = useWorkspace((s) => s.tool)
  const showGrid = useWorkspace((s) => s.settings.showGrid)
  const snap = useWorkspace((s) => s.settings.snap)
  const gridStep = useWorkspace((s) => s.settings.grid)
  const invalidate = useThree((s) => s.invalidate)
  const [target, setTarget] = useState<Object3D | null>(null)
  const cameraView = useWorkspace((s) => s.cameraView)
  // Looking through the tour camera: inside the house, so ceilings and every floor are on.
  const walking = cameraView && tourActive(project)
  const showCeilings = useWorkspace((s) => s.settings.showCeilings) || walking
  const showUpper = useWorkspace((s) => s.settings.showUpperLevels) || walking
  const elevations = useMemo(() => levelElevations(project.levels), [project.levels])
  const activeIndex = Math.max(0, project.levels.findIndex((l) => l.id === project.activeLevelId))
  // Top-level objects grouped by the floor they stand on (unknown floors → the first).
  const byLevel = useMemo(() => {
    const ids = new Set(project.levels.map((l) => l.id))
    const ok = new Set(project.objects.map((o) => o.id))
    const m = new Map<string, SceneObject[]>()
    for (const o of project.objects) {
      if (o.parentId && ok.has(o.parentId)) continue
      const l = o.levelId && ids.has(o.levelId) ? o.levelId : project.levels[0].id
      m.set(l, [...(m.get(l) ?? []), o])
    }
    return m
  }, [project.objects, project.levels])
  const tree = useMemo(() => {
    const t: Tree = new Map()
    const ids = new Set(project.objects.map((o) => o.id))
    for (const o of project.objects) {
      const key = o.parentId && ids.has(o.parentId) ? o.parentId : null
      t.set(key, [...(t.get(key) ?? []), o])
    }
    return t
  }, [project.objects])
  const rendered = shading === 'rendered'
  const raster = useWorkspace((s) => s.settings.engine === 'raster')
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

      {/* Everything that is part of the picture (the path tracer bakes this; helpers stay out). */}
      <group name="__world">
      <SunLight />
      {project.levels.map((level, i) => (
        <group
          key={level.id}
          name={`level:${level.id}`}
          position-y={elevations.get(level.id) ?? 0}
          visible={showUpper || i <= activeIndex}
          userData={{ levelIndex: i }}
        >
          <HouseLevel project={project} level={level} index={i} ceilings={showCeilings} />
          {(byLevel.get(level.id) ?? []).map((o) => (
            <Model key={o.id} obj={o} selectedId={selectedId} shading={shading} tree={tree} />
          ))}
        </group>
      ))}
      </group>

      {rendered && raster && <ContactShadows name="__contact" position={[0, 0.001, 0]} opacity={0.55} scale={12} blur={2.4} far={4} resolution={512} />}

      <group name="__helpers">
        {showGrid && !walking && (
          <>
            <Grid
              position={[0, -0.004, 0]}
              raycast={() => {}}
              infiniteGrid
              cellSize={0.1}
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
          <TransformControls object={target} mode={tool} size={0.8} translationSnap={snap ? gridStep : null} rotationSnap={snap ? Math.PI / 12 : null} scaleSnap={snap ? 0.05 : null} onChange={() => invalidate()} onObjectChange={() => keepOutOfWalls(target)} onMouseUp={() => commitTransform(target, tool)} />
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
      shadows="soft"
      camera={{ position: [4.2, 3, 5.4], fov: 38, near: 0.05, far: 2000 }}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: AgXToneMapping }}
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onPointerMissed={(e) => {
        if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 4) useWorkspace.getState().select(null)
      }}
      className="!absolute inset-0"
    >
      <Background />
      <SceneContent />
      <CameraRig />
      <Bridge />
      <RenderBridge />
      <FinalRender />
      <CameraView />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        zoomToCursor
        target={[0, 0.8, 0]}
        mouseButtons={{ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }}
      />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]} renderPriority={2}>
        <GizmoViewport axisColors={[AXIS_X, '#46a758', AXIS_Z]} labelColor="#0b0b0b" axisHeadScale={0.95} />
      </GizmoHelper>
    </Canvas>
  )
}
